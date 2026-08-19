import { describe, expect, it } from 'vitest'
import { createRuntimeFingerprint } from '../../src/runtime/fingerprint.js'
import { compareFingerprints, TARGET_VARIANT_DIFFERENCES } from '../../src/runtime/integrity.js'

function fingerprint() {
  return createRuntimeFingerprint({
    dshVersion: '0.1.0-rc.7',
    nodeVersion: '24.19.0',
    os: 'darwin',
    architecture: 'arm64',
    orderedBundles: [{ name: 'base', version: '1.0.0' }],
    composedProfile: { stable: true },
    targetArtifactHash: 'control-artifact',
    targetConfig: { mode: 'control' },
    nonTargetPlugins: { memory: { version: '1.0.0', artifactHash: 'memory-hash' } },
    model: { provider: 'mock', name: 'scripted', parameters: { temperature: 0 } },
    systemPrompt: 'stable prompt',
    toolSchema: [{ name: 'read' }],
    skillCatalog: ['skill-a'],
    sandboxPolicyHash: 'sandbox-hash',
    workspaceFixtureHash: 'workspace-hash',
    environmentAllowlistHash: 'environment-hash',
  })
}

describe('pair fingerprint integrity', () => {
  it('只允许声明的目标 plugin 制品和配置差异', () => {
    const control = fingerprint()
    const candidate = structuredClone(control)
    candidate.targetArtifactHash = 'candidate-artifact'
    candidate.targetConfigHash = 'candidate-config'

    expect(compareFingerprints(control, candidate, TARGET_VARIANT_DIFFERENCES)).toEqual({ valid: true })
  })

  it('非目标 plugin 版本差异导致 pair_integrity_failure', () => {
    const control = fingerprint()
    const changedNonTarget = structuredClone(control)
    changedNonTarget.nonTargetPlugins.memory = { version: '1.1.0', artifactHash: 'memory-hash' }

    expect(compareFingerprints(control, changedNonTarget, TARGET_VARIANT_DIFFERENCES)).toEqual({
      valid: false,
      failure: {
        code: 'pair_integrity_failure',
        paths: ['nonTargetPlugins.memory.version'],
      },
    })
  })

  it('稳定排序并同时报告所有未允许差异', () => {
    const control = fingerprint()
    const candidate = structuredClone(control)
    candidate.nodeVersion = '25.0.0'
    candidate.model.name = 'different-model'

    expect(compareFingerprints(control, candidate, TARGET_VARIANT_DIFFERENCES)).toEqual({
      valid: false,
      failure: {
        code: 'pair_integrity_failure',
        paths: ['model.name', 'nodeVersion'],
      },
    })
  })
})
