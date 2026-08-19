import { describe, expect, it } from 'vitest'
import { canonicalHash, canonicalStringify } from '../../src/runtime/canonical.js'
import { createRuntimeFingerprint } from '../../src/runtime/fingerprint.js'

const baseInput = {
  dshVersion: '0.1.0-rc.7',
  nodeVersion: '24.19.0',
  os: 'darwin',
  architecture: 'arm64',
  orderedBundles: [
    { name: 'base', version: '1.0.0' },
    { name: 'target', version: '2.0.0' },
  ],
  composedProfile: { model: 'scripted', tools: ['read', 'write'] },
  targetArtifactHash: 'artifact-control',
  targetConfig: { mode: 'control' },
  nonTargetPlugins: {
    memory: { version: '1.0.0', artifactHash: 'memory-hash' },
  },
  model: { provider: 'mock', name: 'scripted-model', parameters: { temperature: 0 } },
  sandboxPolicyHash: 'sandbox-hash',
  workspaceFixtureHash: 'workspace-hash',
  environmentAllowlistHash: 'environment-hash',
} as const

describe('RuntimeFingerprint', () => {
  it('canonical JSON 对对象键顺序稳定且保留数组顺序', () => {
    expect(canonicalStringify({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}')
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }))
    expect(canonicalHash({ values: ['a', 'b'] })).not.toBe(canonicalHash({ values: ['b', 'a'] }))
  })

  it('规范化配置并为可观测字段生成摘要', () => {
    const fingerprint = createRuntimeFingerprint({
      ...baseInput,
      systemPrompt: 'You are a test agent.',
      toolSchema: [{ name: 'read', input: { path: 'string' } }],
      skillCatalog: ['alpha', 'beta'],
    })

    expect(fingerprint.schemaVersion).toBe(1)
    expect(fingerprint.composedProfileHash).toBe(canonicalHash(baseInput.composedProfile))
    expect(fingerprint.targetConfigHash).toBe(canonicalHash(baseInput.targetConfig))
    expect(fingerprint.model.parameterHash).toBe(canonicalHash(baseInput.model.parameters))
    expect(fingerprint.systemPrompt).toEqual({ state: 'known', hash: canonicalHash('You are a test agent.') })
  })

  it('不可观测字段使用 unknown 而不是空值摘要', () => {
    const fingerprint = createRuntimeFingerprint(baseInput)

    expect(fingerprint.systemPrompt).toEqual({ state: 'unknown' })
    expect(fingerprint.toolSchema).toEqual({ state: 'unknown' })
    expect(fingerprint.skillCatalog).toEqual({ state: 'unknown' })
  })
})
