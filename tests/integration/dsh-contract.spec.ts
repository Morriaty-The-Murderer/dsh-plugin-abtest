import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { freezeExperiment, runExperiment, validateExperiment } from '../../src/cli/workflow.js'
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
    const artifact: FrozenArtifact = {
      packageName: 'fixture-plugin',
      packageVersion: '1.0.0',
      sourceType: 'local-directory',
      artifactHash: 'artifact',
      pluginConfigHash: 'config',
      dependencyLockHash: 'lock',
      dshBundleHash: 'bundle',
      materializedPath: resolve('fixtures/plugins/control-v1'),
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
      timeoutMs: 10_000,
      terminationGraceMs: 500,
      environment: {},
      arms: {
        control: { artifact, fingerprint: makeFingerprint('control'), command },
        candidate: { artifact, fingerprint: makeFingerprint('candidate'), command },
      },
    })

    expect(pair.control.evidence.processExitCode).toBe(0)
    expect(pair.candidate.evidence.processExitCode).toBe(0)
    expect(pair.control.evidence.stdoutPath).not.toBe(pair.candidate.evidence.stdoutPath)
    expect(await readFile(pair.control.evidence.stdoutPath, 'utf8')).toContain('plugin-experiment-target')
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
})
