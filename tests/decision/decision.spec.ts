import { describe, expect, it } from 'vitest'
import { decidePromotion } from '../../src/decision/decide.js'
import type { PromotionPolicy } from '../../src/domain/types.js'
import type { Comparison } from '../../src/evaluate/metrics.js'

const policy: PromotionPolicy = {
  minimumValidPairs: 6,
  minimumAbsoluteLift: 0.03,
  hardGates: {
    bootSuccess: true,
    activationSuccess: true,
    criticalSecurityViolations: 0,
    criticalCaseRegressions: 0,
  },
  guardrails: {
    medianTokenIncreasePct: 15,
    p95LatencyIncreasePct: 20,
    toolErrorRateIncreasePp: 1,
  },
}

function comparison(overrides: Partial<Comparison> = {}): Comparison {
  return {
    validPairCount: 8,
    invalidPairCount: 0,
    integrityFailureCount: 0,
    infrastructureFailureCount: 0,
    exposureInsufficientCount: 0,
    quality: {
      controlTaskSuccessRate: 0.7,
      candidateTaskSuccessRate: 0.8,
      taskSuccessLift: 0.1,
      pairedOutcomes: { wins: 1, losses: 0, ties: 7 },
      blindWinRate: null,
      criticalCaseRegressions: 0,
      candidateCriticalSecurityViolations: 0,
      bootSuccess: true,
      activationSuccess: true,
    },
    guardrails: {
      medianTokenIncreasePct: 10,
      p95LatencyIncreasePct: 10,
      toolErrorRateIncreasePp: 0,
    },
    pairDeltas: [],
    statistics: {
      taskSuccess: { count: 8, mean: 0.1, median: 0, sampleStandardDeviation: 0.2, significance: 'not_claimed' },
      assertionPassRate: { count: 8, mean: 0, median: 0, sampleStandardDeviation: 0, significance: 'not_claimed' },
      durationMs: { count: 8, mean: 0, median: 0, sampleStandardDeviation: 0, significance: 'not_claimed' },
      tokenTotal: { count: 8, mean: 0, median: 0, sampleStandardDeviation: 0, significance: 'not_claimed' },
    },
    ...overrides,
  }
}

describe('four-state promotion decision', () => {
  it('充分提升且所有 gate/guardrail 通过时 PROMOTE', () => {
    expect(decidePromotion(comparison(), policy).outcome).toBe('PROMOTE')
  })

  it('critical regression 优先得到 REJECT', () => {
    const input = comparison()
    input.quality.criticalCaseRegressions = 1
    const decision = decidePromotion(input, policy)
    expect(decision.outcome).toBe('REJECT')
    expect(decision.triggeredRules).toContain('hard_gate.critical_case_regressions')
  })

  it('有益但 token guardrail 超限时 REVIEW', () => {
    const input = comparison()
    input.guardrails.medianTokenIncreasePct = 16
    expect(decidePromotion(input, policy).outcome).toBe('REVIEW')
  })

  it('有益但高波动时 REVIEW', () => {
    const decision = decidePromotion(comparison({ highVariance: true }), policy)

    expect(decision.outcome).toBe('REVIEW')
    expect(decision.triggeredRules).toContain('review.high_variance')
  })

  it('有效证据不足、暴露不足或完整性失败时 INCONCLUSIVE', () => {
    expect(decidePromotion(comparison({ validPairCount: 5 }), policy).outcome).toBe('INCONCLUSIVE')
    expect(decidePromotion(comparison({ exposureInsufficientCount: 1 }), policy).outcome).toBe('INCONCLUSIVE')
    expect(decidePromotion(comparison({ integrityFailureCount: 1 }), policy).outcome).toBe('INCONCLUSIVE')
  })

  it('阈值等号算通过，零 baseline 的无限增长触发 REVIEW', () => {
    const exact = comparison()
    exact.quality.taskSuccessLift = 0.03
    exact.guardrails.medianTokenIncreasePct = 15
    exact.guardrails.p95LatencyIncreasePct = 20
    exact.guardrails.toolErrorRateIncreasePp = 1
    expect(decidePromotion(exact, policy).outcome).toBe('PROMOTE')

    const infinite = comparison()
    infinite.guardrails.medianTokenIncreasePct = Number.POSITIVE_INFINITY
    expect(decidePromotion(infinite, policy).outcome).toBe('REVIEW')
  })
})
