import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPairLayout } from '../../src/runtime/layout.js'

describe('createPairLayout', () => {
  it('为两臂生成互不重叠且位于实验根内的路径', () => {
    const root = resolve('/tmp/plugin-experiments')
    const layout = createPairLayout(root, 'experiment-1', 'case-a', 0)

    expect(layout.control.home).not.toBe(layout.candidate.home)
    expect(layout.control.profile).not.toBe(layout.candidate.profile)
    expect(layout.control.workspace).not.toBe(layout.candidate.workspace)
    expect(layout.control.sessionRoot).not.toBe(layout.candidate.sessionRoot)
    for (const path of Object.values(layout.control).concat(Object.values(layout.candidate))) {
      expect(path.startsWith(`${root}/experiment-1/`)).toBe(true)
    }
  })

  it('拒绝路径逃逸标识符和非法 repetition', () => {
    expect(() => createPairLayout('/tmp/output', '../escape', 'case-a', 0)).toThrow(/experiment id/i)
    expect(() => createPairLayout('/tmp/output', 'experiment', 'case/a', 0)).toThrow(/case id/i)
    expect(() => createPairLayout('/tmp/output', 'experiment', 'case-a', -1)).toThrow(/repetition/i)
  })
})
