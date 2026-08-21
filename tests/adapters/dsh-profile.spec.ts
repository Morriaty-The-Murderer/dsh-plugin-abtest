import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { prepareIsolatedProfile, prepareIsolatedStartupProfile } from '../../src/adapters/dsh/profile.js'
import type { FrozenArtifact } from '../../src/domain/types.js'
import { createPairLayout } from '../../src/runtime/layout.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function artifact(root: string, usesDshBundle: boolean): Promise<FrozenArtifact> {
  const materializedPath = join(root, usesDshBundle ? 'bundle' : 'direct')
  await mkdir(materializedPath, { recursive: true })
  await writeFile(join(materializedPath, 'package.json'), '{}\n')
  return {
    packageName: usesDshBundle ? 'bundle-plugin' : 'direct-plugin',
    packageVersion: '1.0.0',
    sourceType: 'local-directory',
    artifactHash: 'artifact',
    pluginConfigHash: 'config',
    dependencyLockHash: 'lock',
    dshBundleHash: 'bundle',
    materializedPath,
    usesDshBundle,
  }
}

describe('DSH 隔离 profile', () => {
  it('bundle 制品组合自身 patch，普通 Cordis 插件仍使用显式 insert', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-profile-'))
    roots.push(root)
    const layout = createPairLayout(root, 'experiment', 'case', 0)
    const bundle = await artifact(root, true)
    const direct = await artifact(root, false)

    await prepareIsolatedProfile(layout.control, bundle, { targetPlugin: 'bundle-target', pluginConfig: { mode: 'a' } })
    await prepareIsolatedProfile(layout.candidate, direct, {
      targetPlugin: 'direct-target',
      pluginConfig: { mode: 'b' },
    })

    const bundlePackage = JSON.parse(await readFile(join(layout.control.profile, 'package.json'), 'utf8'))
    const directPackage = JSON.parse(await readFile(join(layout.candidate.profile, 'package.json'), 'utf8'))
    expect(bundlePackage.dsh.profile.bundles).toContain('bundle-plugin')
    expect(directPackage.dsh.profile.bundles).not.toContain('direct-plugin')

    expect(parse(await readFile(join(layout.control.profile, 'cordis.patch.yml'), 'utf8'))).toContainEqual({
      id: 'bundle-target',
      config: { mode: 'a' },
    })
    expect(parse(await readFile(join(layout.candidate.profile, 'cordis.patch.yml'), 'utf8'))).toContainEqual({
      insert: [{ id: 'direct-target', name: 'direct-plugin', config: { mode: 'b' } }],
    })
  })

  it('OpenAI-compatible 模型只把凭据引用写入 pi-ai profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-profile-openai-compatible-'))
    roots.push(root)
    const layout = createPairLayout(root, 'experiment', 'case', 0)
    const bundle = await artifact(root, true)

    await prepareIsolatedProfile(layout.control, bundle, {
      targetPlugin: 'bundle-target',
      model: {
        provider: 'openai-compatible',
        name: 'gateway-model-v1',
        parameters: {
          host: 'https://gateway.example/v1',
          apiKeyEnv: 'GATEWAY_API_KEY',
          contextWindow: 128_000,
          maxTokens: 2_048,
        },
      },
    })

    const patch = parse(await readFile(join(layout.control.profile, 'cordis.patch.yml'), 'utf8'))
    expect(patch).toContainEqual({
      id: 'llm-pi-ai',
      config: {
        providers: {
          'openai-compatible': {
            api: 'openai-completions',
            apiKeyEnv: 'GATEWAY_API_KEY',
            baseURL: 'https://gateway.example/v1',
            models: [
              {
                id: 'gateway-model-v1',
                contextWindow: 128_000,
                maxTokens: 2_048,
              },
            ],
          },
        },
      },
    })
    expect(patch).toContainEqual({
      id: 'agent-default-model',
      config: { provider: 'openai-compatible', model: 'gateway-model-v1' },
    })
    expect(JSON.stringify(patch)).not.toContain('api_key')
  })

  it('startup profile 保留目标插件但移除 headless 任务 runner 与模型覆盖', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-profile-startup-'))
    roots.push(root)
    const layout = createPairLayout(root, 'experiment', 'case', 0)
    const bundle = await artifact(root, true)

    await prepareIsolatedStartupProfile(layout.control, bundle, {
      targetPlugin: 'bundle-target',
      pluginConfig: { mode: 'audit' },
      model: { provider: 'deepseek-official', name: 'paid-model', parameters: { maxTokens: 2_048 } },
    })

    const manifest = JSON.parse(await readFile(join(layout.control.startupProfile, 'package.json'), 'utf8'))
    const patch = parse(await readFile(join(layout.control.startupProfile, 'cordis.patch.yml'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('@deepseek-ai/dsh-base')
    expect(manifest.dsh.profile.bundles).toContain('bundle-plugin')
    expect(manifest.dsh.profile.bundles).not.toContain('@deepseek-ai/dsh-headless')
    expect(patch).toContainEqual({ id: 'bundle-target', config: { mode: 'audit' } })
    expect(JSON.stringify(patch)).not.toContain('paid-model')
  })
})
