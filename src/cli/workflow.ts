import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { freezeVariant } from '../artifacts/freeze.js'
import { hashBytes, hashDirectory } from '../artifacts/hash.js'
import { type CollectedRunEvidence, collectRunEvidence } from '../collect/collector.js'
import { decidePromotion } from '../decision/decide.js'
import { EXPOSURE_EVENT } from '../domain/protocol.js'
import type {
  Case,
  FrozenArtifact,
  PromotionDecision,
  PromotionPolicy,
  Run,
  RunPair,
  RuntimeFixture,
  Variant,
  VariantId,
} from '../domain/types.js'
import { loadCases } from '../evaluate/cases.js'
import { aggregatePairs, type Comparison, type PairMeasurement, type RunMeasurement } from '../evaluate/metrics.js'
import { type EvaluatePairInput, evaluatePairEvidence } from '../evaluate/pipeline.js'
import { detectExposure, validateRequiredExposure } from '../exposure/detectors.js'
import type { ExposureDetectorConfig } from '../exposure/types.js'
import { loadManifest } from '../manifest/load.js'
import type { ExperimentManifest } from '../manifest/schema.js'
import { validateManifestSemantics } from '../manifest/validate.js'
import { canonicalJson } from '../report/json.js'
import { writeExperimentReport } from '../report/write.js'
import { createRuntimeFingerprint } from '../runtime/fingerprint.js'
import { createRuntimeFixture } from '../runtime/fixture.js'
import { createPairLayout } from '../runtime/layout.js'
import { runPair } from '../runtime/runner.js'
import { schedulePairs } from '../runtime/scheduler.js'

export class ValidationFailure extends Error {}
export class ExecutionFailure extends Error {}

const MOCK_RUNNER = `
const fs = require('node:fs');
const path = require('node:path');
const artifact = JSON.parse(fs.readFileSync(path.join(process.env.DSH_EXPERIMENT_ARTIFACT, 'package.json'), 'utf8'));
const behavior = artifact.fixtureBehavior || {};
fs.mkdirSync(process.env.DSH_EXPERIMENT_SESSION_ROOT, { recursive: true });
if (behavior.hangMs) setTimeout(() => {}, behavior.hangMs);
const events = [
  { type: 'session', version: 0, id: process.env.DSH_EXPERIMENT_VARIANT, delegationDepth: 0 },
  { type: 'plugin/loaded', seq: 0, data: { name: artifact.name } },
];
if (behavior.bootFailure) {
  fs.writeFileSync(path.join(process.env.DSH_EXPERIMENT_SESSION_ROOT, 'session.jsonl'), events.map(JSON.stringify).join('\\n') + '\\n');
  process.exit(1);
}
events.push({ type: 'plugin/activated', seq: 1, data: { name: artifact.name } });
if (!behavior.unexposed) events.push({ type: '${EXPOSURE_EVENT}', seq: 2, data: { plugin: artifact.name } });
events.push({ type: 'tool/call', seq: 3, data: { name: 'fixture_tool', callId: 'call-1' } });
events.push({ type: 'tool/result', seq: 4, data: {
  message: { role: 'user', callId: 'call-1', content: [], isError: false },
} });
events.push({ type: 'assistant/message', seq: 5, data: {
  message: { role: 'assistant', content: [{ type: 'text', text: behavior.output || '' }] },
  usage: { inputTokens: behavior.inputTokens || 50, outputTokens: behavior.outputTokens || 50 },
} });
fs.writeFileSync(path.join(process.env.DSH_EXPERIMENT_SESSION_ROOT, 'session.jsonl'), events.map(JSON.stringify).join('\\n') + '\\n');
process.stdout.write(behavior.output || '');
`

const require = createRequire(import.meta.url)

function dshCommand(manifest: ExperimentManifest, task: string): { executable: string; args: string[] } {
  if (manifest.runtime.model.provider === 'mock') {
    return { executable: process.execPath, args: ['-e', MOCK_RUNNER] }
  }
  let packagePath: string
  try {
    packagePath = require.resolve('@deepseek-ai/dsh/package.json')
  } catch (error) {
    throw new ExecutionFailure('A non-mock experiment requires @deepseek-ai/dsh@0.1.0-rc.7', { cause: error })
  }
  return {
    executable: process.execPath,
    args: [join(dirname(packagePath), 'lib', 'bin.js'), '--profile', 'experiment', task],
  }
}

function environmentAllowlist(manifest: ExperimentManifest): string[] {
  const value = manifest.extensions?.environment_allowlist
  if (value === undefined) return ['LANG', 'TZ']
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new ValidationFailure('extensions.environment_allowlist must be an array of environment variable names')
  }
  return value
}

function exposureDetectors(manifest: ExperimentManifest, pluginName: string): ExposureDetectorConfig[] {
  const configured = manifest.execution.exposure_detectors
  if (configured === undefined) return [{ id: 'stable-receipt', kind: 'custom_receipt', plugin: pluginName }]
  return configured.map((detector): ExposureDetectorConfig => {
    switch (detector.kind) {
      case 'tool_name':
        return { id: detector.id, kind: detector.kind, toolName: detector.tool_name }
      case 'session_event':
        return { id: detector.id, kind: detector.kind, eventType: detector.event_type }
      case 'prompt_section':
        return { id: detector.id, kind: detector.kind, text: detector.text }
      case 'service_operation':
        return { id: detector.id, kind: detector.kind, operation: detector.operation }
      case 'otel_attribute':
        return {
          id: detector.id,
          kind: detector.kind,
          key: detector.key,
          ...(detector.value === undefined ? {} : { value: detector.value }),
        }
      case 'custom_receipt':
        return { id: detector.id, kind: detector.kind, plugin: detector.plugin ?? pluginName }
      case 'workspace_file_change':
        return {
          id: detector.id,
          kind: detector.kind,
          path: detector.path,
          change: detector.change,
          ...(detector.match === undefined ? {} : { match: detector.match }),
        }
    }
    detector satisfies never
    throw new ValidationFailure('Unsupported exposure detector')
  })
}

interface LoadedPluginConfig {
  value: unknown
  hash: string
}

async function pluginConfig(manifestPath: string, configPath: string | undefined): Promise<LoadedPluginConfig> {
  if (configPath === undefined) return { value: {}, hash: hashBytes('') }
  const content = await readFile(resolve(dirname(manifestPath), configPath))
  return { value: parseYaml(content.toString('utf8')), hash: hashBytes(content) }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function stateRoot(manifest: ExperimentManifest, outputRoot: string): string {
  return resolve(outputRoot, manifest.experiment.id)
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8'), (_key, value: unknown) => {
    if (value === 'Infinity') return Number.POSITIVE_INFINITY
    if (value === '-Infinity') return Number.NEGATIVE_INFINITY
    if (value === 'NaN') return Number.NaN
    return value
  }) as T
}

async function writeState(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, canonicalJson(value), { mode: 0o600 })
  await rename(temporary, path)
}

async function assertFrozenInputs(root: string, manifest: ExperimentManifest, cases?: readonly Case[]): Promise<void> {
  const manifestLockPath = join(root, 'manifest.lock.json')
  if (!(await exists(manifestLockPath))) throw new ExecutionFailure('Frozen manifest is missing; run freeze first')
  const manifestLock = await readJson<unknown>(manifestLockPath)
  if (canonicalJson(manifestLock) !== canonicalJson(manifest)) {
    throw new ExecutionFailure('Manifest changed after freeze; use a fresh output root and freeze again')
  }
  if (cases === undefined) return
  const casesLockPath = join(root, 'cases.lock.json')
  if (!(await exists(casesLockPath))) throw new ExecutionFailure('Frozen case suite is missing; run freeze first')
  const casesLock = await readJson<unknown>(casesLockPath)
  if (canonicalJson(casesLock) !== canonicalJson(cases)) {
    throw new ExecutionFailure('Case suite changed after freeze; use a fresh output root and freeze again')
  }
}

function variantFromManifest(id: VariantId, manifest: ExperimentManifest): Variant {
  const value = manifest.variants[id]
  return { id, source: value.source, ...(value.config === undefined ? {} : { configPath: value.config }) }
}

function promotionPolicy(manifest: ExperimentManifest): PromotionPolicy {
  return {
    minimumValidPairs: manifest.decision.minimum_valid_pairs,
    minimumUniqueCases: manifest.decision.minimum_unique_cases,
    minimumAbsoluteLift: manifest.decision.primary.minimum_absolute_lift,
    hardGates: {
      bootSuccess: manifest.decision.hard_gates.boot_success,
      activationSuccess: manifest.decision.hard_gates.activation_success,
      criticalSecurityViolations: manifest.decision.hard_gates.critical_security_violations,
      criticalCaseRegressions: manifest.decision.hard_gates.critical_case_regressions,
    },
    guardrails: {
      medianTokenIncreasePct: manifest.decision.guardrails.median_token_increase_pct,
      p95LatencyIncreasePct: manifest.decision.guardrails.p95_latency_increase_pct,
      toolErrorRateIncreasePp: manifest.decision.guardrails.tool_error_rate_increase_pp,
    },
  }
}

export async function initProject(root: string): Promise<{ manifest: string }> {
  const manifestPath = join(resolve(root), 'experiment.yml')
  if (await exists(manifestPath))
    throw new ValidationFailure(`Refusing to overwrite existing manifest: ${manifestPath}`)
  const files: Record<string, string> = {
    'experiment.yml': stringifyYaml({
      schema_version: 1,
      experiment: {
        id: 'example-plugin-improvement',
        name: 'Example plugin paired experiment',
        hypothesis: 'Candidate improves deterministic task success without material efficiency regressions.',
      },
      target: { plugin: 'fixture-plugin' },
      variants: {
        control: { source: 'local:plugins/control-v1', config: 'variants/control.yml' },
        candidate: { source: 'local:plugins/candidate-v2', config: 'variants/candidate.yml' },
      },
      runtime: {
        dsh_version: '0.1.0-rc.7',
        profile: 'headless',
        model: { provider: 'mock', name: 'scripted-model', parameters: { temperature: 0 } },
        workspace_fixture: 'fixtures/workspace',
        sandbox: 'isolated-workspace',
      },
      suite: { cases: 'evals/cases.yml', repetitions: 2 },
      execution: { order: 'counterbalanced', concurrency: 1, timeout_ms: 5_000, require_exposure: true },
      decision: {
        minimum_valid_pairs: 4,
        minimum_unique_cases: 2,
        hard_gates: {
          boot_success: true,
          activation_success: true,
          critical_security_violations: 0,
          critical_case_regressions: 0,
        },
        primary: { metric: 'task_success_rate', policy: 'superiority', minimum_absolute_lift: 0.03 },
        guardrails: {
          median_token_increase_pct: 15,
          p95_latency_increase_pct: 500,
          tool_error_rate_increase_pp: 1,
        },
      },
    }),
    'evals/cases.yml': stringifyYaml({
      schema_version: 1,
      cases: [
        {
          id: 'expected-output',
          task: 'Return the expected fixture value.',
          critical: false,
          assertions: [{ id: 'expected', kind: 'required_value', critical: false, config: { value: 'expected' } }],
        },
        {
          id: 'clean-process-exit',
          task: 'Complete the fixture task without a process failure.',
          critical: false,
          assertions: [{ id: 'process', kind: 'process_exit_success', critical: false, config: {} }],
        },
      ],
    }),
    'variants/control.yml': 'mode: control\n',
    'variants/candidate.yml': 'mode: candidate\n',
    'fixtures/workspace/input.txt': 'same deterministic input\n',
    'plugins/control-v1/package.json': `${JSON.stringify({
      name: 'fixture-plugin',
      version: '1.0.0',
      fixtureBehavior: { output: 'baseline', inputTokens: 50, outputTokens: 50 },
    })}\n`,
    'plugins/control-v1/index.js': "export const fixture = 'control'\n",
    'plugins/candidate-v2/package.json': `${JSON.stringify({
      name: 'fixture-plugin',
      version: '2.0.0',
      fixtureBehavior: { output: 'expected', inputTokens: 52, outputTokens: 52 },
    })}\n`,
    'plugins/candidate-v2/index.js': "export const fixture = 'candidate'\n",
  }
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const path = join(resolve(root), relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    }),
  )
  return { manifest: manifestPath }
}

export async function validateExperiment(
  manifestPath: string,
): Promise<{ manifest: ExperimentManifest; cases: Case[] }> {
  let manifest: ExperimentManifest
  try {
    manifest = await loadManifest(manifestPath)
  } catch (error) {
    throw new ValidationFailure((error as Error).message, { cause: error })
  }
  const baseDir = dirname(resolve(manifestPath))
  const issues = await validateManifestSemantics(manifest, baseDir)
  if (issues.length > 0)
    throw new ValidationFailure(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  try {
    return { manifest, cases: await loadCases(resolve(baseDir, manifest.suite.cases)) }
  } catch (error) {
    throw new ValidationFailure((error as Error).message, { cause: error })
  }
}

export async function freezeExperiment(manifestPath: string, outputRoot: string) {
  const { manifest, cases } = await validateExperiment(manifestPath)
  const baseDir = dirname(resolve(manifestPath))
  const root = stateRoot(manifest, outputRoot)
  if (await exists(join(root, 'pairs'))) {
    throw new ExecutionFailure('Refusing to re-freeze an output root that already contains pair evidence')
  }
  const cacheRoot = join(resolve(outputRoot), '.artifact-cache')
  const [control, candidate] = await Promise.all([
    freezeVariant(variantFromManifest('control', manifest), { baseDir, cacheRoot }),
    freezeVariant(variantFromManifest('candidate', manifest), { baseDir, cacheRoot }),
  ])
  await mkdir(root, { recursive: true })
  await Promise.all([
    writeState(join(root, 'manifest.lock.json'), manifest),
    writeState(join(root, 'cases.lock.json'), cases),
    writeState(join(root, 'control-artifact.json'), control),
    writeState(join(root, 'candidate-artifact.json'), candidate),
  ])
  return { manifest, artifacts: { control, candidate }, root }
}

function fingerprint(
  manifest: ExperimentManifest,
  artifact: FrozenArtifact,
  fixture: RuntimeFixture,
  targetConfig: unknown,
) {
  return createRuntimeFingerprint({
    dshVersion: manifest.runtime.dsh_version,
    nodeVersion: process.versions.node,
    os: process.platform,
    architecture: process.arch,
    orderedBundles: [
      { name: '@deepseek-ai/dsh-base', version: manifest.runtime.dsh_version },
      { name: '@deepseek-ai/dsh-headless', version: manifest.runtime.dsh_version },
    ],
    composedProfile: { profile: manifest.runtime.profile, sandbox: manifest.runtime.sandbox },
    targetArtifactHash: artifact.artifactHash,
    targetConfig,
    nonTargetPlugins: {},
    model: {
      provider: manifest.runtime.model.provider,
      name: manifest.runtime.model.name,
      parameters: manifest.runtime.model.parameters ?? {},
    },
    sandboxPolicyHash: fixture.sandboxPolicyHash,
    workspaceFixtureHash: fixture.workspaceHash,
    environmentAllowlistHash: fixture.environmentAllowlistHash,
  })
}

function measurement(
  pair: RunPair,
  caseDef: Case,
  collected: Partial<Record<VariantId, CollectedRunEvidence>>,
  valid: boolean,
  invalidReason: PairMeasurement['invalidReason'],
  blindWinner?: PairMeasurement['blindWinner'],
): PairMeasurement {
  function arm(run: Run, evidence: CollectedRunEvidence | undefined): RunMeasurement {
    const usage = run.evidence.tokenUsage
    const toolNameCounts = new Map<string, number>()
    for (const call of evidence?.toolCalls ?? []) {
      toolNameCounts.set(call.name, (toolNameCounts.get(call.name) ?? 0) + 1)
    }
    return {
      taskSuccess: run.assertions.every((assertion) => assertion.passed),
      assertionPassRate:
        run.assertions.length === 0
          ? 1
          : run.assertions.filter((assertion) => assertion.passed).length / run.assertions.length,
      durationMs: run.evidence.durationMs,
      startupMs: run.evidence.startupMs,
      ...(usage === undefined
        ? {}
        : {
            tokenTotal: usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite,
            cacheTokens: usage.cacheRead + usage.cacheWrite,
          }),
      stepCount:
        evidence?.session.events.filter((event) => event.type === 'step' || event.type === 'step/start').length ?? 0,
      toolCalls: evidence?.toolCalls.length ?? 0,
      failedToolCalls: evidence?.toolCalls.filter((call) => call.failed).length ?? 0,
      repeatedToolCalls: [...toolNameCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      modelCalls: evidence?.session.events.filter((event) => event.type === 'usage').length ?? 0,
      subagents:
        evidence?.session.events.filter((event) => event.type === 'subagent/start' || event.type === 'delegate/start')
          .length ?? 0,
      verificationCommandPresent: run.assertions.some((assertion) => assertion.assertionId === 'command_test'),
      bootSuccess: run.evidence.processExitCode === 0 && run.infrastructureError === undefined,
      activationSuccess: run.exposure.state === 'activated' || run.exposure.state === 'exposed',
      criticalSecurityViolations: 0,
    }
  }
  return {
    pairId: pair.id,
    caseId: pair.caseId,
    repetition: pair.repetition,
    ...(blindWinner === undefined ? {} : { blindWinner }),
    valid,
    ...(invalidReason === undefined ? {} : { invalidReason }),
    criticalCase: caseDef.critical,
    exposureVerified: pair.control.exposure.state === 'exposed' && pair.candidate.exposure.state === 'exposed',
    control: arm(pair.control, collected.control),
    candidate: arm(pair.candidate, collected.candidate),
  }
}

async function mapConcurrentOrdered<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

export interface RunExperimentOptions {
  comparator?: EvaluatePairInput['comparator']
}

export async function runExperiment(
  manifestPath: string,
  outputRoot: string,
  options: RunExperimentOptions = {},
): Promise<{ comparison: Comparison; pairs: RunPair[] }> {
  const { manifest, cases } = await validateExperiment(manifestPath)
  const root = stateRoot(manifest, outputRoot)
  if (!(await exists(join(root, 'control-artifact.json')))) await freezeExperiment(manifestPath, outputRoot)
  await assertFrozenInputs(root, manifest, cases)
  const artifacts = {
    control: await readJson<FrozenArtifact>(join(root, 'control-artifact.json')),
    candidate: await readJson<FrozenArtifact>(join(root, 'candidate-artifact.json')),
  }
  for (const variant of ['control', 'candidate'] as const) {
    if ((await hashDirectory(artifacts[variant].materializedPath)) !== artifacts[variant].artifactHash) {
      throw new ExecutionFailure(`${variant} artifact changed after freeze; use a fresh output root and freeze again`)
    }
  }
  const fixture = await createRuntimeFixture({
    workspacePath: resolve(dirname(manifestPath), manifest.runtime.workspace_fixture),
    sandboxPolicy: manifest.runtime.sandbox,
    environmentAllowlist: environmentAllowlist(manifest),
  })
  const pluginConfigs = {
    control: await pluginConfig(manifestPath, manifest.variants.control.config),
    candidate: await pluginConfig(manifestPath, manifest.variants.candidate.config),
  }
  for (const variant of ['control', 'candidate'] as const) {
    if (pluginConfigs[variant].hash !== artifacts[variant].pluginConfigHash) {
      throw new ExecutionFailure(
        `${variant} plugin config changed after freeze; use a fresh output root and freeze again`,
      )
    }
  }
  const caseById = new Map(cases.map((caseDef) => [caseDef.id, caseDef]))
  const scheduledPairs = schedulePairs(
    cases.map((caseDef) => caseDef.id),
    manifest.suite.repetitions,
  )
  const completed = await mapConcurrentOrdered(scheduledPairs, manifest.execution.concurrency, async (scheduled) => {
    const caseDef = caseById.get(scheduled.caseId) as Case
    const layout = createPairLayout(outputRoot, manifest.experiment.id, scheduled.caseId, scheduled.repetition)
    const measurementPath = join(layout.pairRoot, 'measurement.json')
    const pairExists = await exists(layout.pairFile)
    const measurementExists = await exists(measurementPath)
    if (pairExists && measurementExists) {
      return {
        pair: await readJson<RunPair>(layout.pairFile),
        measurement: await readJson<PairMeasurement>(measurementPath),
      }
    }
    if (!pairExists && measurementExists) {
      throw new ExecutionFailure(`Incomplete state: measurement exists without pair evidence for ${scheduled.id}`)
    }
    const command = dshCommand(manifest, caseDef.task)
    const pair = pairExists
      ? await readJson<RunPair>(layout.pairFile)
      : await runPair({
          outputRoot,
          experimentId: manifest.experiment.id,
          targetPlugin: manifest.target.plugin,
          scheduled,
          fixture,
          timeoutMs: manifest.execution.timeout_ms,
          terminationGraceMs: 1_000,
          environment: process.env,
          model: {
            provider: manifest.runtime.model.provider,
            name: manifest.runtime.model.name,
            parameters: manifest.runtime.model.parameters ?? {},
          },
          arms: {
            control: {
              artifact: artifacts.control,
              fingerprint: fingerprint(manifest, artifacts.control, fixture, pluginConfigs.control.value),
              command,
              pluginConfig: pluginConfigs.control.value,
            },
            candidate: {
              artifact: artifacts.candidate,
              fingerprint: fingerprint(manifest, artifacts.candidate, fixture, pluginConfigs.candidate.value),
              command,
              pluginConfig: pluginConfigs.candidate.value,
            },
          },
        })
    const collected: Partial<Record<VariantId, CollectedRunEvidence>> = {}
    for (const variant of ['control', 'candidate'] as const) {
      const armLayout = layout[variant]
      const run = pair[variant]
      try {
        collected[variant] = await collectRunEvidence({
          sessionRoot: armLayout.sessionRoot,
          stdoutPath: run.evidence.stdoutPath,
          stderrPath: run.evidence.stderrPath,
          processExitCode: run.evidence.processExitCode,
          signal: run.evidence.signal,
          durationMs: run.evidence.durationMs,
          startupMs: run.evidence.startupMs,
          ...(run.evidence.workspaceDiffPath === undefined
            ? {}
            : { workspaceDiffPath: run.evidence.workspaceDiffPath }),
        })
        run.evidence = collected[variant].runEvidence
        run.exposure = detectExposure(
          {
            events: collected[variant].session.events,
            ...(collected[variant].workspaceDiff === undefined
              ? {}
              : { workspaceDiff: collected[variant].workspaceDiff }),
          },
          exposureDetectors(manifest, artifacts[variant].packageName),
        )
      } catch (error) {
        run.exposure = { state: 'unknown', detectors: [] }
        if (run.infrastructureError === undefined) {
          run.infrastructureError = {
            code: 'session_collection_failure',
            message: `Session evidence could not be collected: ${(error as Error).message}`,
          }
        }
      }
    }
    const evaluated = await evaluatePairEvidence({
      pair,
      caseDef,
      contexts: {
        control: {
          workspacePath: layout.control.workspace,
          ...(collected.control?.finalOutput === undefined ? {} : { finalOutput: collected.control.finalOutput }),
          toolCalls: collected.control?.toolCalls ?? [],
          criticalSecurityViolations: 0,
          sessionReadable: collected.control !== undefined,
          ownedEffectsRemaining: 0,
        },
        candidate: {
          workspacePath: layout.candidate.workspace,
          ...(collected.candidate?.finalOutput === undefined ? {} : { finalOutput: collected.candidate.finalOutput }),
          toolCalls: collected.candidate?.toolCalls ?? [],
          criticalSecurityViolations: 0,
          sessionReadable: collected.candidate !== undefined,
          ownedEffectsRemaining: 0,
        },
      },
      ...(options.comparator === undefined ? {} : { comparator: options.comparator }),
    })
    let invalidReason: PairMeasurement['invalidReason']
    if (!pair.integrity.valid) invalidReason = 'pair_integrity_failure'
    else if (pair.control.infrastructureError !== undefined || pair.candidate.infrastructureError !== undefined)
      invalidReason = 'infrastructure_error'
    else if (
      pair.control.evidence.processExitCode === 0 &&
      pair.candidate.evidence.processExitCode === 0 &&
      (validateRequiredExposure(pair.control.exposure, manifest.execution.require_exposure) !== undefined ||
        validateRequiredExposure(pair.candidate.exposure, manifest.execution.require_exposure) !== undefined)
    )
      invalidReason = 'required_exposure_missing'
    const pairMeasurement = measurement(
      pair,
      caseDef,
      collected,
      invalidReason === undefined,
      invalidReason,
      evaluated.blindResult?.winner,
    )
    await Promise.all([writeState(layout.pairFile, pair), writeState(measurementPath, pairMeasurement)])
    return { pair, measurement: pairMeasurement }
  })
  const pairs = completed.map((result) => result.pair)
  const measurements = completed.map((result) => result.measurement)
  const comparison = aggregatePairs(measurements)
  await writeState(join(root, 'comparison.json'), comparison)
  return { comparison, pairs }
}

export async function statusExperiment(manifestPath: string, outputRoot: string) {
  const { manifest, cases } = await validateExperiment(manifestPath)
  const scheduled = schedulePairs(
    cases.map((caseDef) => caseDef.id),
    manifest.suite.repetitions,
  )
  let completed = 0
  let valid = 0
  let failed = 0
  const root = stateRoot(manifest, outputRoot)
  if (await exists(join(root, 'manifest.lock.json'))) await assertFrozenInputs(root, manifest, cases)
  for (const pair of scheduled) {
    const measurementPath = join(root, 'pairs', pair.id, 'measurement.json')
    if (await exists(measurementPath)) {
      completed += 1
      const measurement = await readJson<PairMeasurement>(measurementPath)
      if (measurement.valid) valid += 1
      else failed += 1
    }
  }
  return { total: scheduled.length, completed, valid, failed, pending: scheduled.length - completed }
}

export async function compareExperiment(manifestPath: string, outputRoot: string): Promise<Comparison> {
  const { manifest, cases } = await validateExperiment(manifestPath)
  const root = stateRoot(manifest, outputRoot)
  await assertFrozenInputs(root, manifest, cases)
  const measurements: PairMeasurement[] = []
  for (const scheduled of schedulePairs(
    cases.map((caseDef) => caseDef.id),
    manifest.suite.repetitions,
  )) {
    const path = join(root, 'pairs', scheduled.id, 'measurement.json')
    if (await exists(path)) measurements.push(await readJson<PairMeasurement>(path))
  }
  if (measurements.length === 0) throw new ExecutionFailure('No completed pair measurements are available')
  const comparison = aggregatePairs(measurements)
  await writeState(join(root, 'comparison.json'), comparison)
  return comparison
}

export async function decideExperiment(manifestPath: string, outputRoot: string): Promise<PromotionDecision> {
  const { manifest, cases } = await validateExperiment(manifestPath)
  const root = stateRoot(manifest, outputRoot)
  await assertFrozenInputs(root, manifest, cases)
  const comparisonPath = join(root, 'comparison.json')
  const comparison = (await exists(comparisonPath))
    ? await readJson<Comparison>(comparisonPath)
    : await compareExperiment(manifestPath, outputRoot)
  const result = decidePromotion(comparison, promotionPolicy(manifest))
  await writeState(join(root, 'decision.json'), result)
  return result
}

export async function reportExperiment(manifestPath: string, outputRoot: string) {
  const { manifest, cases } = await validateExperiment(manifestPath)
  const root = stateRoot(manifest, outputRoot)
  await assertFrozenInputs(root, manifest, cases)
  const decision = (await exists(join(root, 'decision.json')))
    ? await readJson<PromotionDecision>(join(root, 'decision.json'))
    : await decideExperiment(manifestPath, outputRoot)
  const comparison = await readJson<Comparison>(join(root, 'comparison.json'))
  const pairs: RunPair[] = []
  for (const scheduled of schedulePairs(
    cases.map((caseDef) => caseDef.id),
    manifest.suite.repetitions,
  )) {
    pairs.push(await readJson<RunPair>(join(root, 'pairs', scheduled.id, 'pair.json')))
  }
  const artifacts = {
    control: await readJson<FrozenArtifact>(join(root, 'control-artifact.json')),
    candidate: await readJson<FrozenArtifact>(join(root, 'candidate-artifact.json')),
  }
  const runs = pairs.flatMap((pair) => [pair.control, pair.candidate])
  return writeExperimentReport(
    {
      experimentId: manifest.experiment.id,
      manifestLock: manifest,
      artifacts,
      pairs,
      comparison,
      decision,
      exposureSummary: {
        exposed: runs.filter((run) => run.exposure.state === 'exposed').length,
        unknown: runs.filter((run) => run.exposure.state === 'unknown').length,
      },
    },
    outputRoot,
  )
}
