import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { createProfileStartupCommand } from '../../src/adapters/dsh/command.js'
import { freezeExperiment, initProject, runExperiment, validateExperiment } from '../../src/cli/workflow.js'
import type { FrozenArtifact } from '../../src/domain/types.js'
import { createRuntimeFingerprint } from '../../src/runtime/fingerprint.js'
import { createRuntimeFixture } from '../../src/runtime/fixture.js'
import { runPair } from '../../src/runtime/runner.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pinned DSH contract', () => {
  it('使用 0.1.0-rc.7 真实入口解析两套隔离 profile 与 patch', async () => {
    const dshPackage = JSON.parse(await readFile(resolve('node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
    expect(dshPackage.version).toBe('0.1.0-rc.7')
    const root = await mkdtemp(join(tmpdir(), 'dsh-contract-'))
    roots.push(root)
    const workspace = join(root, 'workspace-fixture')
    await cp(resolve('fixtures/plugins/control-v1'), workspace, { recursive: true })
    const fixture = await createRuntimeFixture({
      workspacePath: workspace,
      sandboxPolicy: 'isolated-workspace',
      environmentAllowlist: [],
    })
    const artifactRoot = join(root, 'bundle-artifact')
    await mkdir(artifactRoot)
    await Promise.all([
      writeFile(
        join(artifactRoot, 'package.json'),
        `${JSON.stringify({
          name: 'fixture-bundle-target',
          version: '1.0.0',
          type: 'module',
          main: './index.js',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
        })}\n`,
      ),
      writeFile(
        join(artifactRoot, 'index.js'),
        'export const name = "fixture-bundle-target"\nexport function apply() {}\n',
      ),
      writeFile(
        join(artifactRoot, 'cordis.patch.yml'),
        '- insert:\n    - id: fixture-bundle-target\n      name: fixture-bundle-target\n      config:\n        mode: bundle-default\n',
      ),
    ])
    const artifact: FrozenArtifact = {
      packageName: 'fixture-bundle-target',
      packageVersion: '1.0.0',
      sourceType: 'local-directory',
      artifactHash: 'artifact',
      pluginConfigHash: 'config',
      dependencyLockHash: 'lock',
      dshBundleHash: 'bundle',
      materializedPath: artifactRoot,
      usesDshBundle: true,
    }
    const makeFingerprint = (targetArtifactHash: string) =>
      createRuntimeFingerprint({
        dshVersion: '0.1.0-rc.7',
        nodeVersion: process.versions.node,
        os: process.platform,
        architecture: process.arch,
        orderedBundles: [
          { name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.7' },
          { name: '@deepseek-ai/dsh-headless', version: '0.1.0-rc.7' },
        ],
        composedProfile: { profile: 'experiment' },
        targetArtifactHash,
        targetConfig: {},
        nonTargetPlugins: {},
        model: { provider: 'mock', name: 'contract-only', parameters: {} },
        sandboxPolicyHash: fixture.sandboxPolicyHash,
        workspaceFixtureHash: fixture.workspaceHash,
        environmentAllowlistHash: fixture.environmentAllowlistHash,
      })
    const dshBin = resolve('node_modules/@deepseek-ai/dsh/lib/bin.js')
    const command = { executable: process.execPath, args: [dshBin, '--profile', 'experiment', '--dump-config'] }
    const pair = await runPair({
      outputRoot: join(root, 'output'),
      experimentId: 'contract',
      scheduled: { id: 'contract-0', caseId: 'contract', repetition: 0, order: ['control', 'candidate'] },
      fixture,
      targetPlugin: 'fixture-bundle-target',
      timeoutMs: 10_000,
      terminationGraceMs: 500,
      environment: {},
      model: {
        provider: 'deepseek-official',
        name: 'deepseek-v4-flash',
        parameters: { reasoningEffort: 'off', maxTokens: 2_048 },
      },
      arms: {
        control: {
          artifact,
          fingerprint: makeFingerprint('control'),
          command,
          startupCommand: createProfileStartupCommand(process.execPath, dshBin),
          pluginConfig: { mode: 'control' },
        },
        candidate: {
          artifact,
          fingerprint: makeFingerprint('candidate'),
          command,
          startupCommand: createProfileStartupCommand(process.execPath, dshBin),
          pluginConfig: { mode: 'candidate' },
        },
      },
    })

    expect(
      pair.control.evidence.startupCheck?.success,
      await readFile(pair.control.evidence.startupCheck?.stderrPath as string, 'utf8'),
    ).toBe(true)
    expect(
      pair.candidate.evidence.startupCheck?.success,
      await readFile(pair.candidate.evidence.startupCheck?.stderrPath as string, 'utf8'),
    ).toBe(true)
    expect(pair.control.evidence.processExitCode).toBe(0)
    expect(pair.candidate.evidence.processExitCode).toBe(0)
    expect(pair.control.evidence.stdoutPath).not.toBe(pair.candidate.evidence.stdoutPath)
    expect(await readFile(pair.control.evidence.stdoutPath, 'utf8')).toContain(
      'id: fixture-bundle-target\n  name: fixture-bundle-target\n  config:\n    mode: control',
    )
    expect(await readFile(pair.candidate.evidence.stdoutPath, 'utf8')).toContain(
      'id: fixture-bundle-target\n  name: fixture-bundle-target\n  config:\n    mode: candidate',
    )
    expect(await readFile(pair.control.evidence.stdoutPath, 'utf8')).toContain(
      "id: llm-deepseek\n  name: '@deepseek-ai/dsh-llm-deepseek'\n  config:\n    reasoningEffort: 'off'\n    maxTokens: 2048",
    )
  }, 20_000)

  it('真实 DSH startup audit 会捕获插件 activation 失败并跳过任务', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-startup-failure-contract-'))
    roots.push(root)
    const workspace = join(root, 'workspace-fixture')
    await mkdir(workspace)
    const fixture = await createRuntimeFixture({
      workspacePath: workspace,
      sandboxPolicy: 'isolated-workspace',
      environmentAllowlist: [],
    })
    const artifactRoot = join(root, 'failing-artifact')
    await mkdir(artifactRoot)
    await Promise.all([
      writeFile(
        join(artifactRoot, 'package.json'),
        `${JSON.stringify({
          name: 'dsh-startup-failure-fixture',
          version: '1.0.0',
          type: 'module',
          main: './index.js',
        })}\n`,
      ),
      writeFile(
        join(artifactRoot, 'index.js'),
        'export function apply() { throw new Error("startup-audit-fixture") }\n',
      ),
    ])
    const artifact: FrozenArtifact = {
      packageName: 'dsh-startup-failure-fixture',
      packageVersion: '1.0.0',
      sourceType: 'local-directory',
      artifactHash: 'failing-artifact',
      pluginConfigHash: 'config',
      dependencyLockHash: 'lock',
      dshBundleHash: 'bundle-none',
      materializedPath: artifactRoot,
    }
    const fingerprint = createRuntimeFingerprint({
      dshVersion: '0.1.0-rc.7',
      nodeVersion: process.versions.node,
      os: process.platform,
      architecture: process.arch,
      orderedBundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.7' },
        { name: '@deepseek-ai/dsh-headless', version: '0.1.0-rc.7' },
      ],
      composedProfile: { profile: 'experiment' },
      targetArtifactHash: artifact.artifactHash,
      targetConfig: {},
      nonTargetPlugins: {},
      model: { provider: 'mock', name: 'contract-only', parameters: {} },
      sandboxPolicyHash: fixture.sandboxPolicyHash,
      workspaceFixtureHash: fixture.workspaceHash,
      environmentAllowlistHash: fixture.environmentAllowlistHash,
    })
    const dshBin = resolve('node_modules/@deepseek-ai/dsh/lib/bin.js')
    const taskCommand = {
      executable: process.execPath,
      args: ['-e', 'require("node:fs").writeFileSync("task-ran.txt", "unexpected")'],
    }

    const pair = await runPair({
      outputRoot: join(root, 'output'),
      experimentId: 'startup-failure-contract',
      scheduled: { id: 'failure-0', caseId: 'failure', repetition: 0, order: ['control', 'candidate'] },
      fixture,
      targetPlugin: artifact.packageName,
      timeoutMs: 10_000,
      terminationGraceMs: 500,
      environment: {},
      arms: {
        control: {
          artifact,
          fingerprint,
          command: taskCommand,
          startupCommand: createProfileStartupCommand(process.execPath, dshBin),
        },
        candidate: {
          artifact,
          fingerprint,
          command: taskCommand,
          startupCommand: createProfileStartupCommand(process.execPath, dshBin),
        },
      },
    })

    expect(pair.control.evidence.startupCheck?.success).toBe(false)
    expect(pair.control.evidence.processExitCode).toBeNull()
    await expect(
      readFile(
        join(root, 'output', 'startup-failure-contract', 'pairs', 'failure-0', 'control', 'workspace', 'task-ran.txt'),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  }, 20_000)

  it.skipIf(process.env.DSH_PLUGIN_EXPERIMENT_LIVE !== '1')(
    'live smoke 在临时证据根运行显式提供的真实 DSH manifest',
    async () => {
      const manifest = process.env.DSH_PLUGIN_EXPERIMENT_LIVE_MANIFEST
      if (manifest === undefined || manifest.trim() === '') {
        throw new Error('DSH_PLUGIN_EXPERIMENT_LIVE_MANIFEST is required when live smoke is enabled')
      }
      const validated = await validateExperiment(manifest)
      expect(validated.manifest.runtime.model.provider).not.toBe('mock')
      const root = await mkdtemp(join(tmpdir(), 'dsh-live-smoke-'))
      roots.push(root)
      const output = join(root, 'evidence')

      await freezeExperiment(manifest, output)
      const result = await runExperiment(manifest, output)

      expect(result.pairs.length).toBeGreaterThan(0)
      expect(result.pairs.every((pair) => pair.control.evidence.sessionLogPath !== undefined)).toBe(true)
      expect(result.pairs.every((pair) => pair.candidate.evidence.sessionLogPath !== undefined)).toBe(true)
    },
    20 * 60_000,
  )

  it('非 mock 实验自动执行无模型 startup audit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-startup-audit-'))
    roots.push(root)
    const project = join(root, 'project')
    const output = join(root, 'evidence')
    const { manifest } = await initProject(project)
    const document = parse(await readFile(manifest, 'utf8'))
    document.runtime.model = {
      provider: 'deepseek-official',
      name: 'deepseek-v4-flash',
      parameters: { reasoningEffort: 'off', maxTokens: 2_048 },
    }
    document.suite.repetitions = 1
    document.decision.minimum_valid_pairs = 1
    document.decision.minimum_unique_cases = 1
    await writeFile(manifest, stringify(document))
    await Promise.all(
      ['control-v1', 'candidate-v2'].flatMap((directory, index) => [
        writeFile(
          join(project, 'plugins', directory, 'package.json'),
          `${JSON.stringify({
            name: 'fixture-plugin',
            version: index === 0 ? '1.0.0' : '2.0.0',
            type: 'module',
            main: './index.js',
          })}\n`,
        ),
        writeFile(join(project, 'plugins', directory, 'index.js'), 'export function apply() {}\n'),
      ]),
    )
    const casesPath = join(project, 'evals', 'cases.yml')
    const cases = parse(await readFile(casesPath, 'utf8'))
    cases.cases = [{ ...cases.cases[0], task: '--help' }]
    await writeFile(casesPath, stringify(cases))

    await freezeExperiment(manifest, output)
    const result = await runExperiment(manifest, output)

    expect(result.pairs).toHaveLength(1)
    expect(
      result.pairs[0]?.control.evidence.startupCheck?.success,
      await readFile(result.pairs[0]?.control.evidence.startupCheck?.stderrPath as string, 'utf8'),
    ).toBe(true)
    expect(
      result.pairs[0]?.candidate.evidence.startupCheck?.success,
      await readFile(result.pairs[0]?.candidate.evidence.startupCheck?.stderrPath as string, 'utf8'),
    ).toBe(true)
  }, 30_000)
})
