import { describe, expect, it } from 'vitest'
import { aggregatePairs, type PairMeasurement } from '../../src/evaluate/metrics.js'
import { mean, median, percentile, sampleStandardDeviation } from '../../src/evaluate/statistics.js'

function pair(
  id: string,
  control: Partial<PairMeasurement['control']>,
  candidate: Partial<PairMeasurement['candidate']>,
  identity: { caseId: string; repetition: number } = { caseId: id, repetition: 0 },
): PairMeasurement {
  const defaults = {
    taskSuccess: true,
    assertionPassRate: 1,
    durationMs: 100,
    startupMs: 10,
    tokenTotal: 100,
    cacheTokens: 10,
    stepCount: 1,
    toolCalls: 2,
    failedToolCalls: 0,
    repeatedToolCalls: 0,
    modelCalls: 1,
    subagents: 0,
    verificationCommandPresent: true,
    bootSuccess: true,
    activationSuccess: true,
    criticalSecurityViolations: 0,
  }
  return {
    pairId: id,
    caseId: identity.caseId,
    repetition: identity.repetition,
    valid: true,
    criticalCase: false,
    exposureVerified: true,
    control: { ...defaults, ...control },
    candidate: { ...defaults, ...candidate },
  }
}

describe('paired metrics', () => {
  it('先计算 per-pair delta 再聚合质量、延迟、token 和工具错误率', () => {
    const comparison = aggregatePairs([
      pair('one', { taskSuccess: false, durationMs: 100, tokenTotal: 100 }, { durationMs: 120, tokenTotal: 110 }),
      pair('two', { durationMs: 200, tokenTotal: 200 }, { durationMs: 220, tokenTotal: 240, failedToolCalls: 1 }),
    ])

    expect(comparison.validPairCount).toBe(2)
    expect(comparison.quality.taskSuccessLift).toBe(0.5)
    expect(comparison.guardrails.medianTokenIncreasePct).toBeCloseTo(15)
    expect(comparison.guardrails.p95LatencyIncreasePct).toBeCloseTo(19.5)
    expect(comparison.guardrails.toolErrorRateIncreasePp).toBe(25)
    expect(comparison.pairDeltas.map((delta) => delta.taskSuccess)).toEqual([1, 0])
    expect(comparison.quality.pairedOutcomes).toEqual({ wins: 1, losses: 0, ties: 1 })
    expect(comparison.statistics.taskSuccess.significance).toBe('not_claimed')
  })

  it('invalid pair 不进入聚合，并保留完整性与基础设施分类', () => {
    const invalidIntegrity: PairMeasurement = {
      ...pair('integrity', {}, {}),
      valid: false,
      invalidReason: 'pair_integrity_failure',
    }
    const invalidInfrastructure: PairMeasurement = {
      ...pair('infra', {}, {}),
      valid: false,
      invalidReason: 'infrastructure_error',
    }
    const comparison = aggregatePairs([pair('valid', {}, {}), invalidIntegrity, invalidInfrastructure])

    expect(comparison).toMatchObject({
      validPairCount: 1,
      invalidPairCount: 2,
      integrityFailureCount: 1,
      infrastructureFailureCount: 1,
    })
  })

  it('只按有效 measurement 的不同 case 计算 unique-case 数', () => {
    const repeated = [
      pair('case-a-0', {}, {}, { caseId: 'case-a', repetition: 0 }),
      pair('case-a-1', {}, {}, { caseId: 'case-a', repetition: 1 }),
    ]
    const invalid = {
      ...pair('case-b-0', {}, {}, { caseId: 'case-b', repetition: 0 }),
      valid: false,
      invalidReason: 'infrastructure_error' as const,
    }

    expect(aggregatePairs([...repeated, invalid]).validUniqueCaseCount).toBe(1)
  })

  it('拒绝缺少 canonical case identity 的旧 measurement', () => {
    const { caseId: _caseId, ...legacyMeasurement } = pair('legacy', {}, {})

    expect(() => aggregatePairs([legacyMeasurement as PairMeasurement])).toThrow(/measurement identity/i)
  })

  it('同一 case 的重复 task-success delta 冲突时标记为 unstable', () => {
    const comparison = aggregatePairs([
      pair('case-a-0', { taskSuccess: false }, { taskSuccess: true }, { caseId: 'case-a', repetition: 0 }),
      pair('case-a-1', { taskSuccess: true }, { taskSuccess: false }, { caseId: 'case-a', repetition: 1 }),
    ])

    expect(comparison.caseStability).toEqual({
      evaluableCaseCount: 1,
      unstableCaseCount: 1,
      status: 'unstable',
    })
  })

  it('blind result 排除 tie 后计算 Candidate 胜率，并保留完整 outcome 计数', () => {
    const comparison = aggregatePairs([
      { ...pair('candidate-win', {}, {}), blindWinner: 'candidate' },
      { ...pair('control-win', {}, {}), blindWinner: 'control' },
      { ...pair('tie', {}, {}), blindWinner: 'tie' },
      pair('missing', {}, {}),
    ])

    expect(comparison.quality.blindOutcomes).toEqual({
      candidateWins: 1,
      controlWins: 1,
      ties: 1,
      evaluatedPairs: 3,
    })
    expect(comparison.quality.blindWinRate).toBe(0.5)
  })

  it('没有 blind evidence 时胜率保持 null，不伪造零值', () => {
    const comparison = aggregatePairs([pair('missing', {}, {})])

    expect(comparison.quality.blindOutcomes).toEqual({
      candidateWins: 0,
      controlWins: 0,
      ties: 0,
      evaluatedPairs: 0,
    })
    expect(comparison.quality.blindWinRate).toBeNull()
  })

  it('统计函数处理偶数中位数、p95 和样本标准差', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(median([1, 4, 2, 3])).toBe(2.5)
    expect(percentile([10, 20, 30], 0.95)).toBe(29)
    expect(sampleStandardDeviation([1, 2, 3])).toBe(1)
  })
})
