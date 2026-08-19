import { describe, expect, it } from 'vitest'
import { createBlindComparison, revealComparison } from '../../src/evaluate/blind.js'
import * as publicApi from '../../src/index.js'

describe('blind comparison', () => {
  it('公共 core 入口提供匿名化与揭盲适配器', () => {
    const prepared = (publicApi as typeof import('../../src/evaluate/blind.js')).createBlindComparison({
      task: 'task',
      controlOutput: 'one',
      candidateOutput: 'two',
      seed: 'public-api',
      forbiddenIdentityValues: [],
    })
    const revealed = (publicApi as typeof import('../../src/evaluate/blind.js')).revealComparison(
      { anonymousWinner: 'tie', reasoning: 'equal', scores: { A: 1, B: 1 } },
      prepared.mapping,
    )

    expect(revealed.winner).toBe('tie')
  })

  it('seeded mapping 可复现且 comparator input 不含变体身份', () => {
    const first = createBlindComparison({
      task: 'produce result',
      controlOutput: 'old answer',
      candidateOutput: 'new answer',
      rubric: 'prefer correctness',
      seed: 'experiment/case/0',
      forbiddenIdentityValues: ['control-package@1.0.0', 'candidate-package@2.0.0', '0123456789abcdef'],
    })
    const second = createBlindComparison({
      task: 'produce result',
      controlOutput: 'old answer',
      candidateOutput: 'new answer',
      rubric: 'prefer correctness',
      seed: 'experiment/case/0',
      forbiddenIdentityValues: ['control-package@1.0.0', 'candidate-package@2.0.0', '0123456789abcdef'],
    })

    expect(first).toEqual(second)
    expect(JSON.stringify(first.input)).not.toMatch(/control|candidate|package@|0123456789abcdef/i)
    expect(first.mapping.A).not.toBe(first.mapping.B)
  })

  it('输出中含禁用身份时拒绝发送给 comparator', () => {
    expect(() =>
      createBlindComparison({
        task: 'task',
        controlOutput: 'built from /private/control/plugin',
        candidateOutput: 'clean',
        seed: 'seed',
        forbiddenIdentityValues: ['/private/control/plugin'],
      }),
    ).toThrow(/identity leak/i)
  })

  it('比较完成后才用独立 mapping 揭示匿名胜者', () => {
    const prepared = createBlindComparison({
      task: 'task',
      controlOutput: 'one',
      candidateOutput: 'two',
      seed: 'seed',
      forbiddenIdentityValues: [],
    })
    const result = revealComparison(
      { anonymousWinner: 'A', reasoning: 'A is better', scores: { A: 4, B: 2 } },
      prepared.mapping,
    )

    expect(result.anonymousWinner).toBe('A')
    expect(result.winner).toBe(prepared.mapping.A)
    expect(result.scores[prepared.mapping.A]).toBe(4)
  })
})
