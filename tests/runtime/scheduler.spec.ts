import { describe, expect, it } from 'vitest'
import { schedulePairs } from '../../src/runtime/scheduler.js'

describe('schedulePairs', () => {
  it('按全局 pair 序号交替执行 Control 与 Candidate', () => {
    expect(schedulePairs(['case-a', 'case-b'], 2)).toEqual([
      { id: 'case-a-0', caseId: 'case-a', repetition: 0, order: ['control', 'candidate'] },
      { id: 'case-a-1', caseId: 'case-a', repetition: 1, order: ['candidate', 'control'] },
      { id: 'case-b-0', caseId: 'case-b', repetition: 0, order: ['control', 'candidate'] },
      { id: 'case-b-1', caseId: 'case-b', repetition: 1, order: ['candidate', 'control'] },
    ])
  })

  it('拒绝重复或不安全的 case id', () => {
    expect(() => schedulePairs(['duplicate', 'duplicate'], 1)).toThrow(/duplicate/i)
    expect(() => schedulePairs(['../escape'], 1)).toThrow(/case id/i)
  })
})
