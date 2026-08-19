import { describe, expect, it } from 'vitest'
import { PROTOCOL_IDENTIFIERS } from '../../src/domain/protocol.js'
import { PROJECT_IDENTITY } from '../../src/identity/generated.js'

describe('稳定协议身份', () => {
  it('不嵌入默认 public project identity', () => {
    const persisted = JSON.stringify(PROTOCOL_IDENTIFIERS).toLowerCase()
    for (const publicName of [
      PROJECT_IDENTITY.displayName,
      PROJECT_IDENTITY.shortName,
      PROJECT_IDENTITY.repoSlug,
      PROJECT_IDENTITY.npmName,
      PROJECT_IDENTITY.cliBin,
    ]) {
      expect(persisted).not.toContain(publicName.toLowerCase())
    }
  })

  it('固定中性协议、manifest、数据根、Cordis 和 telemetry 标识', () => {
    expect(PROTOCOL_IDENTIFIERS).toEqual({
      protocolNamespace: 'dsh.plugin-experiment',
      manifestSchema: 'urn:dsh:plugin-experiment:manifest:v1',
      defaultDataRoot: '$DSH_HOME/experiments',
      cordisEntryId: 'plugin-experiment-controller',
      telemetryNamespace: 'dsh.plugin_experiment',
      exposureEvent: 'dsh.plugin-experiment/exposure',
    })
  })
})
