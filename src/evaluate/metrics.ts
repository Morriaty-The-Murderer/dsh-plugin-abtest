import { mean, median, percentile, sampleStandardDeviation } from './statistics.js'

export interface RunMeasurement {
  taskSuccess: boolean
  assertionPassRate: number
  durationMs: number
  startupMs: number
  tokenTotal?: number
  cacheTokens?: number
  estimatedCost?: number
  stepCount: number
  toolCalls: number
  failedToolCalls: number
  repeatedToolCalls: number
  modelCalls: number
  subagents: number
  verificationCommandPresent: boolean
  bootSuccess: boolean
  activationSuccess: boolean
  criticalSecurityViolations: number
}

export interface PairMeasurement {
  pairId: string
  valid: boolean
  invalidReason?: 'pair_integrity_failure' | 'infrastructure_error' | 'required_exposure_missing' | 'other'
  criticalCase: boolean
  exposureVerified: boolean
  control: RunMeasurement
  candidate: RunMeasurement
}

export interface PairDelta {
  pairId: string
  taskSuccess: number
  assertionPassRate: number
  durationMs: number
  latencyIncreasePct: number
  startupMs: number
  tokenTotal: number | null
  tokenIncreasePct: number | null
  cacheTokens: number | null
  estimatedCost: number | null
  stepCount: number
  toolCalls: number
  failedToolCalls: number
  repeatedToolCalls: number
  modelCalls: number
  subagents: number
  verificationCommandPresent: number
}

export interface MetricStatistics {
  count: number
  mean: number | null
  median: number | null
  sampleStandardDeviation: number | null
  significance: 'not_claimed'
}

export interface Comparison {
  validPairCount: number
  invalidPairCount: number
  integrityFailureCount: number
  infrastructureFailureCount: number
  exposureInsufficientCount: number
  quality: {
    controlTaskSuccessRate: number
    candidateTaskSuccessRate: number
    taskSuccessLift: number
    pairedOutcomes: { wins: number; losses: number; ties: number }
    blindWinRate: number | null
    criticalCaseRegressions: number
    candidateCriticalSecurityViolations: number
    bootSuccess: boolean
    activationSuccess: boolean
  }
  guardrails: {
    medianTokenIncreasePct: number | null
    p95LatencyIncreasePct: number | null
    toolErrorRateIncreasePp: number | null
  }
  pairDeltas: PairDelta[]
  statistics: {
    taskSuccess: MetricStatistics
    assertionPassRate: MetricStatistics
    durationMs: MetricStatistics
    tokenTotal: MetricStatistics
  }
  highVariance?: boolean
}

function percentageIncrease(control: number, candidate: number): number {
  if (control === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY
  return ((candidate - control) / control) * 100
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

export function aggregatePairs(pairs: readonly PairMeasurement[]): Comparison {
  const valid = pairs.filter((pair) => pair.valid)
  const deltas: PairDelta[] = valid.map((pair) => ({
    pairId: pair.pairId,
    taskSuccess: Number(pair.candidate.taskSuccess) - Number(pair.control.taskSuccess),
    assertionPassRate: pair.candidate.assertionPassRate - pair.control.assertionPassRate,
    durationMs: pair.candidate.durationMs - pair.control.durationMs,
    latencyIncreasePct: percentageIncrease(pair.control.durationMs, pair.candidate.durationMs),
    startupMs: pair.candidate.startupMs - pair.control.startupMs,
    tokenTotal:
      pair.control.tokenTotal === undefined || pair.candidate.tokenTotal === undefined
        ? null
        : pair.candidate.tokenTotal - pair.control.tokenTotal,
    tokenIncreasePct:
      pair.control.tokenTotal === undefined || pair.candidate.tokenTotal === undefined
        ? null
        : percentageIncrease(pair.control.tokenTotal, pair.candidate.tokenTotal),
    cacheTokens:
      pair.control.cacheTokens === undefined || pair.candidate.cacheTokens === undefined
        ? null
        : pair.candidate.cacheTokens - pair.control.cacheTokens,
    estimatedCost:
      pair.control.estimatedCost === undefined || pair.candidate.estimatedCost === undefined
        ? null
        : pair.candidate.estimatedCost - pair.control.estimatedCost,
    stepCount: pair.candidate.stepCount - pair.control.stepCount,
    toolCalls: pair.candidate.toolCalls - pair.control.toolCalls,
    failedToolCalls: pair.candidate.failedToolCalls - pair.control.failedToolCalls,
    repeatedToolCalls: pair.candidate.repeatedToolCalls - pair.control.repeatedToolCalls,
    modelCalls: pair.candidate.modelCalls - pair.control.modelCalls,
    subagents: pair.candidate.subagents - pair.control.subagents,
    verificationCommandPresent:
      Number(pair.candidate.verificationCommandPresent) - Number(pair.control.verificationCommandPresent),
  }))
  const controlSuccessRate = mean(valid.map((pair) => Number(pair.control.taskSuccess))) ?? 0
  const candidateSuccessRate = mean(valid.map((pair) => Number(pair.candidate.taskSuccess))) ?? 0
  const controlToolCalls = valid.reduce((sum, pair) => sum + pair.control.toolCalls, 0)
  const candidateToolCalls = valid.reduce((sum, pair) => sum + pair.candidate.toolCalls, 0)
  const controlToolErrorRate = rate(
    valid.reduce((sum, pair) => sum + pair.control.failedToolCalls, 0),
    controlToolCalls,
  )
  const candidateToolErrorRate = rate(
    valid.reduce((sum, pair) => sum + pair.candidate.failedToolCalls, 0),
    candidateToolCalls,
  )
  const taskDeltas = deltas.map((delta) => delta.taskSuccess)
  const statistic = (values: readonly number[]): MetricStatistics => ({
    count: values.length,
    mean: mean(values),
    median: median(values),
    sampleStandardDeviation: sampleStandardDeviation(values),
    significance: 'not_claimed',
  })
  return {
    validPairCount: valid.length,
    invalidPairCount: pairs.length - valid.length,
    integrityFailureCount: pairs.filter((pair) => !pair.valid && pair.invalidReason === 'pair_integrity_failure')
      .length,
    infrastructureFailureCount: pairs.filter((pair) => !pair.valid && pair.invalidReason === 'infrastructure_error')
      .length,
    exposureInsufficientCount: pairs.filter((pair) => !pair.valid && pair.invalidReason === 'required_exposure_missing')
      .length,
    quality: {
      controlTaskSuccessRate: controlSuccessRate,
      candidateTaskSuccessRate: candidateSuccessRate,
      taskSuccessLift: candidateSuccessRate - controlSuccessRate,
      pairedOutcomes: {
        wins: taskDeltas.filter((delta) => delta > 0).length,
        losses: taskDeltas.filter((delta) => delta < 0).length,
        ties: taskDeltas.filter((delta) => delta === 0).length,
      },
      blindWinRate: null,
      criticalCaseRegressions: valid.filter(
        (pair) => pair.criticalCase && pair.control.taskSuccess && !pair.candidate.taskSuccess,
      ).length,
      candidateCriticalSecurityViolations: valid.reduce(
        (sum, pair) => sum + pair.candidate.criticalSecurityViolations,
        0,
      ),
      bootSuccess: valid.every((pair) => pair.candidate.bootSuccess),
      activationSuccess: valid.every((pair) => pair.candidate.activationSuccess),
    },
    guardrails: {
      medianTokenIncreasePct: median(
        deltas.flatMap((delta) => (delta.tokenIncreasePct === null ? [] : [delta.tokenIncreasePct])),
      ),
      p95LatencyIncreasePct: percentile(
        deltas.map((delta) => delta.latencyIncreasePct),
        0.95,
      ),
      toolErrorRateIncreasePp:
        controlToolErrorRate === null || candidateToolErrorRate === null
          ? null
          : (candidateToolErrorRate - controlToolErrorRate) * 100,
    },
    pairDeltas: deltas,
    statistics: {
      taskSuccess: statistic(taskDeltas),
      assertionPassRate: statistic(deltas.map((delta) => delta.assertionPassRate)),
      durationMs: statistic(deltas.map((delta) => delta.durationMs)),
      tokenTotal: statistic(deltas.flatMap((delta) => (delta.tokenTotal === null ? [] : [delta.tokenTotal]))),
    },
  }
}
