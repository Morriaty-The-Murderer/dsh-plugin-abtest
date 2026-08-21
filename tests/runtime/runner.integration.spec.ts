import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrozenArtifact } from '../../src/domain/types.js'
import { createRuntimeFingerprint } from '../../src/runtime/fingerprint.js'
import { createRuntimeFixture } from '../../src/runtime/fixture.js'
import { freezeRuntimeEnvironment, runPair } from '../../src/runtime/runner.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function fingerprint(targetArtifactHash: string, mode: string) {
  return createRuntimeFingerprint({
    dshVersion: '0.1.0-rc.7',
    nodeVersion: process.versions.node,
    os: process.platform,
    architecture: process.arch,
    orderedBundles: [{ name: 'headless', version: '0.1.0-rc.7' }],
    composedProfile: { stable: true },
    targetArtifactHash,
    targetConfig: { mode },
    nonTargetPlugins: {},
    model: { provider: 'mock', name: 'scripted', parameters: {} },
    sandboxPolicyHash: 'sandbox',
    workspaceFixtureHash: 'workspace',
    environmentAllowlistHash: 'environment',
  })
}

async function artifact(root: string, name: string, hash: string): Promise<FrozenArtifact> {
  const materializedPath = join(root, name)
  await mkdir(materializedPath, { recursive: true })
  await writeFile(join(materializedPath, 'package.json'), JSON.stringify({ name: `fixture-${name}`, version: '1.0.0' }))
  await writeFile(join(materializedPath, 'index.js'), `export const fixture = '${name}'\n`)
  return {
    packageName: `fixture-${name}`,
    packageVersion: '1.0.0',
    sourceType: 'local-directory',
    artifactHash: hash,
    pluginConfigHash: `${hash}-config`,
    dependencyLockHash: `${hash}-lock`,
    dshBundleHash: `${hash}-bundle`,
    materializedPath,
  }
}

describe('runPair', () => {
  it('在两套独立 home/profile/workspace/session 中运行双臂并保存证据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paired-runner-'))
    roots.push(root)
    const workspace = join(root, 'fixture-workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'input.txt'), 'same input')
    const fixture = await createRuntimeFixture({
      workspacePath: workspace,
      sandboxPolicy: 'isolated-workspace',
      environmentAllowlist: ['LANG'],
    })
    const controlArtifact = await artifact(root, 'control-plugin', 'control-hash')
    const candidateArtifact = await artifact(root, 'candidate-plugin', 'candidate-hash')
    const probe = [
      "const values = ['DSH_HOME','DSH_EXPERIMENT_PROFILE','DSH_EXPERIMENT_SESSION_ROOT','DSH_EXPERIMENT_ARTIFACT','DSH_EXPERIMENT_VARIANT']",
      "require('node:fs').writeFileSync('generated.txt', process.env.DSH_EXPERIMENT_VARIANT)",
      'process.stdout.write(JSON.stringify(Object.fromEntries(values.map((name) => [name, process.env[name]]))))',
    ].join(';')

    const pair = await runPair({
      outputRoot: join(root, 'output'),
      experimentId: 'experiment-a',
      targetPlugin: 'fixture-target',
      scheduled: { id: 'case-a-0', caseId: 'case-a', repetition: 0, order: ['control', 'candidate'] },
      fixture,
      timeoutMs: 5_000,
      terminationGraceMs: 100,
      environment: { LANG: 'C', SENTINEL_SECRET: 'must-not-leak' },
      arms: {
        control: {
          artifact: controlArtifact,
          fingerprint: fingerprint(controlArtifact.artifactHash, 'control'),
          command: { executable: process.execPath, args: ['-e', probe] },
        },
        candidate: {
          artifact: candidateArtifact,
          fingerprint: fingerprint(candidateArtifact.artifactHash, 'candidate'),
          command: { executable: process.execPath, args: ['-e', probe] },
        },
      },
    })

    expect(pair.integrity).toEqual({ valid: true })
    const controlObserved = JSON.parse(await readFile(pair.control.evidence.stdoutPath, 'utf8'))
    const candidateObserved = JSON.parse(await readFile(pair.candidate.evidence.stdoutPath, 'utf8'))
    for (const key of [
      'DSH_HOME',
      'DSH_EXPERIMENT_PROFILE',
      'DSH_EXPERIMENT_SESSION_ROOT',
      'DSH_EXPERIMENT_ARTIFACT',
    ]) {
      expect(controlObserved[key]).not.toBe(candidateObserved[key])
    }
    expect(controlObserved.DSH_EXPERIMENT_VARIANT).toBe('control')
    expect(candidateObserved.DSH_EXPERIMENT_VARIANT).toBe('candidate')
    expect(JSON.stringify(controlObserved)).not.toContain('must-not-leak')
    expect(await readFile(join(controlObserved.DSH_EXPERIMENT_PROFILE, 'package.json'), 'utf8')).toContain(
      'fixture-control-plugin',
    )
    expect(await readFile(join(candidateObserved.DSH_EXPERIMENT_PROFILE, 'package.json'), 'utf8')).toContain(
      'fixture-candidate-plugin',
    )
    expect(await readFile(join(controlObserved.DSH_HOME, '..', 'workspace', 'input.txt'), 'utf8')).toBe('same input')
    const controlDiff = JSON.parse(await readFile(pair.control.evidence.workspaceDiffPath as string, 'utf8'))
    const candidateDiff = JSON.parse(await readFile(pair.candidate.evidence.workspaceDiffPath as string, 'utf8'))
    expect(controlDiff).toMatchObject({ added: ['generated.txt'], modified: [], deleted: [] })
    expect(candidateDiff).toMatchObject({ added: ['generated.txt'], modified: [], deleted: [] })
  })

  it('环境冻结只复制 allowlist 中存在的名称', () => {
    expect(freezeRuntimeEnvironment(['LANG', 'MISSING'], { LANG: 'C', SECRET: 'raw' })).toEqual({ LANG: 'C' })
  })
})
