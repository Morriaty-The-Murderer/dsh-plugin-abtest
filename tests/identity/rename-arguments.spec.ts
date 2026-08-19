import { describe, expect, it } from 'vitest'
import { parseRenameArguments } from '../../src/identity/rename-arguments.js'

describe('rename CLI arguments', () => {
  it('接受 pnpm 透传的独立分隔符', () => {
    expect(parseRenameArguments(['--', '--dry-run', '--display-name', 'Harness Pair Lab', '--json'])).toEqual({
      dryRun: true,
      json: true,
      values: { 'display-name': 'Harness Pair Lab' },
    })
  })

  it('拒绝缺少值的 identity 选项', () => {
    expect(() => parseRenameArguments(['--repo-slug'])).toThrow('--repo-slug 需要一个值')
  })
})
