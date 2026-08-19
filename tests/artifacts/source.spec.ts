import { describe, expect, it } from 'vitest'
import { parseArtifactSource } from '../../src/artifacts/source.js'

describe('制品来源解析', () => {
  it('解析精确 npm 版本和固定 GitHub commit', () => {
    expect(parseArtifactSource('npm:@example/plugin@1.2.3-rc.1', '/workspace')).toEqual({
      type: 'npm',
      packageSpec: '@example/plugin@1.2.3-rc.1',
    })
    expect(parseArtifactSource('github:owner/plugin#0123456789abcdef0123456789abcdef01234567', '/workspace')).toEqual({
      type: 'github',
      repository: 'owner/plugin',
      commit: '0123456789abcdef0123456789abcdef01234567',
    })
  })

  it('拒绝 npm dist-tag/range 和 mutable GitHub ref', () => {
    expect(() => parseArtifactSource('npm:plugin@latest', '/workspace')).toThrow(/exact version/i)
    expect(() => parseArtifactSource('npm:plugin@^1.2.3', '/workspace')).toThrow(/exact version/i)
    expect(() => parseArtifactSource('github:owner/plugin#main', '/workspace')).toThrow(/40-character-commit/i)
  })
})
