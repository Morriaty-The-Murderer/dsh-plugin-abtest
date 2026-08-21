import { cp, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prepareIsolatedProfile, prepareIsolatedStartupProfile } from '../adapters/dsh/profile.js'
import type { FrozenArtifact, Run, RunPair, RuntimeFingerprint, RuntimeFixture, VariantId } from '../domain/types.js'
import { compareFingerprints } from './integrity.js'
import { type ArmLayout, createPairLayout } from './layout.js'
import { type ChildProcessResult, executeChildProcess } from './process.js'
import type { ScheduledPair } from './scheduler.js'
import { snapshotWorkspace, writeWorkspaceDiff } from './workspace-diff.js'

export interface ArmCommand {
  executable: string
  args: readonly string[]
}

export interface RunnerArm {
  artifact: FrozenArtifact
  fingerprint: RuntimeFingerprint
  command: ArmCommand
  startupCommand?: ArmCommand
  pluginConfig?: unknown
}

export interface RunPairInput {
  outputRoot: string
  experimentId: string
  targetPlugin: string
  scheduled: ScheduledPair
  fixture: RuntimeFixture
  timeoutMs: number
  terminationGraceMs: number
  environment: Readonly<Record<string, string | undefined>>
  model?: { provider: string; name: string; parameters?: Readonly<Record<string, unknown>> }
  arms: Record<VariantId, RunnerArm>
}

export function freezeRuntimeEnvironment(
  allowlist: readonly string[],
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    [...new Set(allowlist)]
      .sort((left, right) => left.localeCompare(right, 'en'))
      .flatMap((name) => (source[name] === undefined ? [] : [[name, source[name] as string]])),
  )
}

async function prepareArm(
  layout: ArmLayout,
  fixture: RuntimeFixture,
  arm: RunnerArm,
  targetPlugin: string,
  model?: { provider: string; name: string; parameters?: Readonly<Record<string, unknown>> },
): Promise<void> {
  await mkdir(layout.root, { recursive: true })
  await Promise.all([
    cp(fixture.workspacePath, layout.workspace, { recursive: true, force: false, errorOnExist: true }),
    ...(arm.startupCommand === undefined
      ? []
      : [
          cp(fixture.workspacePath, layout.startupWorkspace, {
            recursive: true,
            force: false,
            errorOnExist: true,
          }),
        ]),
    cp(arm.artifact.materializedPath, layout.artifact, { recursive: true, force: false, errorOnExist: true }),
    mkdir(layout.sessionRoot, { recursive: true }),
  ])
  await prepareIsolatedProfile(layout, arm.artifact, {
    targetPlugin,
    ...(arm.pluginConfig === undefined ? {} : { pluginConfig: arm.pluginConfig }),
    ...(model === undefined ? {} : { model }),
  })
  if (arm.startupCommand !== undefined) {
    await prepareIsolatedStartupProfile(layout, arm.artifact, {
      targetPlugin,
      ...(arm.pluginConfig === undefined ? {} : { pluginConfig: arm.pluginConfig }),
    })
  }
}

function armEnvironment(base: Record<string, string>, layout: ArmLayout, variant: VariantId): Record<string, string> {
  return {
    ...base,
    DSH_HOME: layout.home,
    DSH_EXPERIMENT_PROFILE: layout.profile,
    DSH_EXPERIMENT_SESSION_ROOT: layout.sessionRoot,
    DSH_EXPERIMENT_ARTIFACT: layout.artifact,
    DSH_EXPERIMENT_VARIANT: variant,
  }
}

async function runArm(variant: VariantId, arm: RunnerArm, layout: ArmLayout, input: RunPairInput): Promise<Run> {
  const startupResult =
    arm.startupCommand === undefined
      ? undefined
      : await executeChildProcess({
          executable: arm.startupCommand.executable,
          args: arm.startupCommand.args,
          cwd: layout.startupWorkspace,
          environment: armEnvironment(
            freezeRuntimeEnvironment(input.fixture.environmentAllowlist, input.environment),
            layout,
            variant,
          ),
          stdoutPath: layout.startupStdout,
          stderrPath: layout.startupStderr,
          timeoutMs: input.timeoutMs,
          terminationGraceMs: input.terminationGraceMs,
        })
  const startupCheck =
    startupResult === undefined
      ? undefined
      : {
          stdoutPath: layout.startupStdout,
          stderrPath: layout.startupStderr,
          processExitCode: startupResult.exitCode,
          signal: startupResult.signal,
          durationMs: startupResult.durationMs,
          startupMs: startupResult.startupMs,
          success:
            startupResult.exitCode === 0 &&
            startupResult.signal === null &&
            startupResult.infrastructureError === undefined,
          ...(startupResult.infrastructureError === undefined
            ? startupResult.exitCode === 0 && startupResult.signal === null
              ? {}
              : { failureCode: 'process_exit_nonzero' as const }
            : { failureCode: startupResult.infrastructureError.code }),
        }
  const workspaceBefore = await snapshotWorkspace(layout.workspace)
  let result: ChildProcessResult
  if (startupCheck?.success === false) {
    await Promise.all([writeFile(layout.stdout, ''), writeFile(layout.stderr, '')])
    result = {
      exitCode: null,
      signal: null,
      durationMs: 0,
      startupMs: 0,
      timedOut: false,
    }
  } else {
    result = await executeChildProcess({
      executable: arm.command.executable,
      args: arm.command.args,
      cwd: layout.workspace,
      environment: armEnvironment(
        freezeRuntimeEnvironment(input.fixture.environmentAllowlist, input.environment),
        layout,
        variant,
      ),
      stdoutPath: layout.stdout,
      stderrPath: layout.stderr,
      timeoutMs: input.timeoutMs,
      terminationGraceMs: input.terminationGraceMs,
    })
  }
  const workspaceDiffPath = join(layout.root, 'workspace-diff.json')
  await writeWorkspaceDiff(workspaceDiffPath, workspaceBefore, await snapshotWorkspace(layout.workspace))
  const run: Run = {
    id: `${input.scheduled.id}-${variant}`,
    variant,
    caseId: input.scheduled.caseId,
    repetition: input.scheduled.repetition,
    fingerprint: arm.fingerprint,
    evidence: {
      stdoutPath: layout.stdout,
      stderrPath: layout.stderr,
      sessionLogPath: join(layout.sessionRoot, 'session.jsonl'),
      workspaceDiffPath,
      processExitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      startupMs: result.startupMs,
      ...(startupCheck === undefined ? {} : { startupCheck }),
    },
    exposure: { state: 'unknown', detectors: [] },
    assertions: [],
  }
  if (result.infrastructureError !== undefined) {
    run.infrastructureError = result.infrastructureError
  }
  return run
}

export async function runPair(input: RunPairInput): Promise<RunPair> {
  const layout = createPairLayout(
    input.outputRoot,
    input.experimentId,
    input.scheduled.caseId,
    input.scheduled.repetition,
  )
  await Promise.all([
    prepareArm(layout.control, input.fixture, input.arms.control, input.targetPlugin, input.model),
    prepareArm(layout.candidate, input.fixture, input.arms.candidate, input.targetPlugin, input.model),
  ])
  const runs = {} as Record<VariantId, Run>
  for (const variant of input.scheduled.order) {
    runs[variant] = await runArm(variant, input.arms[variant], layout[variant], input)
  }
  const compared = compareFingerprints(input.arms.control.fingerprint, input.arms.candidate.fingerprint)
  const pair: RunPair = {
    id: input.scheduled.id,
    caseId: input.scheduled.caseId,
    repetition: input.scheduled.repetition,
    order: input.scheduled.order,
    control: runs.control,
    candidate: runs.candidate,
    integrity: compared.valid
      ? { valid: true }
      : { valid: false, code: compared.failure.code, paths: compared.failure.paths },
  }
  const temporary = `${layout.pairFile}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(pair, undefined, 2)}\n`, { mode: 0o600 })
  await rename(temporary, layout.pairFile)
  return pair
}
