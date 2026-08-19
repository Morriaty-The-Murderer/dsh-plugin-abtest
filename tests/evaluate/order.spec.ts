import { describe, expect, it, vi } from 'vitest'
import type { Case, Run, RunPair } from '../../src/domain/types.js'
import { evaluatePairEvidence } from '../../src/evaluate/pipeline.js'

function run(variant: 'control' | 'candidate'): Run {
  return {
    id: variant,
    variant,
    caseId: 'case-a',
    repetition: 0,
    fingerprint: {} as Run['fingerprint'],
    evidence: {
      stdoutPath: '/tmp/stdout',
      stderrPath: '/tmp/stderr',
      processExitCode: 0,
      signal: null,
      durationMs: 1,
      startupMs: 1,
    },
    exposure: { state: 'exposed', detectors: [] },
    assertions: [],
  }
}

describe('evaluation order', () => {
  it('critical deterministic failure 时不调用 blind comparator', async () => {
    const pair: RunPair = {
      id: 'pair-a',
      caseId: 'case-a',
      repetition: 0,
      order: ['control', 'candidate'],
      control: run('control'),
      candidate: run('candidate'),
      integrity: { valid: true },
    }
    const caseDef: Case = {
      id: 'case-a',
      task: 'must contain marker',
      critical: true,
      assertions: [{ id: 'marker', kind: 'required_value', critical: true, config: { value: 'required' } }],
    }
    const comparator = vi.fn(async () => ({
      anonymousWinner: 'tie' as const,
      reasoning: 'unused',
      scores: { A: 0, B: 0 },
    }))

    const result = await evaluatePairEvidence({
      pair,
      caseDef,
      contexts: {
        control: {
          workspacePath: '/tmp',
          finalOutput: 'required',
          toolCalls: [],
          criticalSecurityViolations: 0,
          sessionReadable: true,
          ownedEffectsRemaining: 0,
        },
        candidate: {
          workspacePath: '/tmp',
          finalOutput: 'missing',
          toolCalls: [],
          criticalSecurityViolations: 0,
          sessionReadable: true,
          ownedEffectsRemaining: 0,
        },
      },
      comparator,
    })

    expect(comparator).not.toHaveBeenCalled()
    expect(result.stages.map((stage) => [stage.name, stage.status])).toEqual([
      ['integrity', 'passed'],
      ['boot_activation', 'passed'],
      ['deterministic', 'failed'],
      ['lifecycle_safety', 'skipped'],
      ['blind_comparison', 'skipped'],
      ['efficiency', 'skipped'],
      ['post_hoc', 'skipped'],
      ['decision', 'skipped'],
    ])
  })

  it('可选比较器接收随机化匿名输出并在完成后揭盲', async () => {
    const pair: RunPair = {
      id: 'pair-blind',
      caseId: 'case-blind',
      repetition: 0,
      order: ['control', 'candidate'],
      control: run('control'),
      candidate: run('candidate'),
      integrity: { valid: true },
    }
    const comparator = vi.fn(async () => ({
      anonymousWinner: 'A' as const,
      reasoning: 'A is more complete',
      scores: { A: 4, B: 2 },
    }))

    const result = await evaluatePairEvidence({
      pair,
      caseDef: { id: 'case-blind', task: 'compare outputs', critical: false, assertions: [] },
      contexts: {
        control: {
          workspacePath: '/tmp',
          finalOutput: 'old answer',
          toolCalls: [],
          criticalSecurityViolations: 0,
          sessionReadable: true,
          ownedEffectsRemaining: 0,
        },
        candidate: {
          workspacePath: '/tmp',
          finalOutput: 'new answer',
          toolCalls: [],
          criticalSecurityViolations: 0,
          sessionReadable: true,
          ownedEffectsRemaining: 0,
        },
      },
      comparator,
      blindSeed: 'blind-seed-2',
      forbiddenIdentityValues: [],
    } as Parameters<typeof evaluatePairEvidence>[0])

    expect(comparator).toHaveBeenCalledWith({
      task: 'compare outputs',
      outputA: 'new answer',
      outputB: 'old answer',
    })
    expect(result.blindResult).toMatchObject({ anonymousWinner: 'A', winner: 'candidate' })
  })
})
