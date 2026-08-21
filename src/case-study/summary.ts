import { z } from 'zod'
import type { FrozenArtifact, PromotionDecision, Run, RunPair, VariantId } from '../domain/types.js'
import type { Comparison } from '../evaluate/metrics.js'

export interface PricingSnapshot {
  schemaVersion: 1
  asOf: string
  source: string
  currency: 'USD'
  model: string
  assumption: string
  perMillionTokens: {
    inputCacheHit: number
    inputCacheMiss: number
    output: number
  }
}

const pricingSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.url(),
  currency: z.literal('USD'),
  model: z.string().trim().min(1),
  assumption: z.string().trim().min(1),
  perMillionTokens: z.strictObject({
    inputCacheHit: z.number().nonnegative(),
    inputCacheMiss: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
})

export function parsePricingSnapshot(value: unknown): PricingSnapshot {
  const result = pricingSnapshotSchema.safeParse(value)
  if (!result.success) throw new Error(`Invalid pricing snapshot: ${result.error.message}`, { cause: result.error })
  return result.data
}

export interface CaseStudySummaryInput {
  experiment: {
    id: string
    dshVersion: string
    model: { provider: string; name: string; parameters: Readonly<Record<string, unknown>> }
  }
  artifacts: Record<VariantId, FrozenArtifact>
  pairs: readonly RunPair[]
  comparison: Comparison
  decision: PromotionDecision
  pricing: PricingSnapshot
}

interface UsageSummary {
  runs: number
  runsWithUsage: number
  inputCacheMiss: number
  inputCacheHit: number
  output: number
  reasoning: number
  cacheWrite: number
}

type FailureCategory =
  | 'startup_check_failed'
  | 'task_process_failed'
  | 'process_timeout'
  | 'process_spawn_failure'
  | 'session_collection_failure'
  | 'other_infrastructure_failure'

interface ExecutionSummary {
  runCount: number
  startupCheckedRunCount: number
  startupPassedRunCount: number
  taskExitSuccessCount: number
  taskExitFailureCount: number
  taskNotRunCount: number
  sessionCollectedRunCount: number
  failureCategoryCounts: Partial<Record<FailureCategory, number>>
}

function failureCategory(run: Run): FailureCategory | undefined {
  if (run.evidence.startupCheck?.success === false) return 'startup_check_failed'
  if (run.infrastructureError !== undefined) {
    switch (run.infrastructureError.code) {
      case 'process_timeout':
      case 'process_spawn_failure':
      case 'session_collection_failure':
        return run.infrastructureError.code
      default:
        return 'other_infrastructure_failure'
    }
  }
  return run.evidence.processExitCode === 0 && run.evidence.signal === null ? undefined : 'task_process_failed'
}

function summarizeExecution(runs: readonly Run[]): ExecutionSummary {
  const failureCategoryCounts: ExecutionSummary['failureCategoryCounts'] = {}
  for (const run of runs) {
    const category = failureCategory(run)
    if (category !== undefined) failureCategoryCounts[category] = (failureCategoryCounts[category] ?? 0) + 1
  }
  return {
    runCount: runs.length,
    startupCheckedRunCount: runs.filter((run) => run.evidence.startupCheck !== undefined).length,
    startupPassedRunCount: runs.filter((run) => run.evidence.startupCheck?.success === true).length,
    taskExitSuccessCount: runs.filter((run) => run.evidence.processExitCode === 0 && run.evidence.signal === null)
      .length,
    taskExitFailureCount: runs.filter(
      (run) =>
        run.evidence.startupCheck?.success !== false &&
        (run.evidence.processExitCode !== 0 || run.evidence.signal !== null),
    ).length,
    taskNotRunCount: runs.filter((run) => run.evidence.startupCheck?.success === false).length,
    sessionCollectedRunCount: runs.filter((run) => run.evidence.sessionCollected === true).length,
    failureCategoryCounts,
  }
}

function summarizeUsage(runs: readonly Run[]): UsageSummary {
  const summary: UsageSummary = {
    runs: 0,
    runsWithUsage: 0,
    inputCacheMiss: 0,
    inputCacheHit: 0,
    output: 0,
    reasoning: 0,
    cacheWrite: 0,
  }
  for (const run of runs) {
    summary.runs += 1
    const usage = run.evidence.tokenUsage
    if (usage === undefined) continue
    summary.runsWithUsage += 1
    summary.inputCacheMiss += usage.input
    summary.inputCacheHit += usage.cacheRead
    summary.output += usage.output
    summary.reasoning += usage.reasoning
    summary.cacheWrite += usage.cacheWrite
  }
  return summary
}

function estimatedUsd(usage: UsageSummary, pricing: PricingSnapshot): number {
  const rates = pricing.perMillionTokens
  return (
    (usage.inputCacheMiss * rates.inputCacheMiss +
      usage.inputCacheHit * rates.inputCacheHit +
      usage.output * rates.output) /
    1_000_000
  )
}

function artifactIdentity(artifact: FrozenArtifact) {
  return {
    packageName: artifact.packageName,
    packageVersion: artifact.packageVersion,
    sourceType: artifact.sourceType,
    ...(artifact.sourceCommit === undefined ? {} : { sourceCommit: artifact.sourceCommit }),
    artifactHash: artifact.artifactHash,
    pluginConfigHash: artifact.pluginConfigHash,
    dependencyLockHash: artifact.dependencyLockHash,
    dshBundleHash: artifact.dshBundleHash,
    usesDshBundle: artifact.usesDshBundle === true,
  }
}

export function createCaseStudySummary(input: CaseStudySummaryInput) {
  const runs = {
    control: input.pairs.map((pair) => pair.control),
    candidate: input.pairs.map((pair) => pair.candidate),
  }
  const usage = {
    control: summarizeUsage(runs.control),
    candidate: summarizeUsage(runs.candidate),
  }
  const cost = {
    control: { estimatedUsd: estimatedUsd(usage.control, input.pricing) },
    candidate: { estimatedUsd: estimatedUsd(usage.candidate, input.pricing) },
  }
  return {
    schemaVersion: 1 as const,
    experiment: input.experiment,
    artifacts: {
      control: artifactIdentity(input.artifacts.control),
      candidate: artifactIdentity(input.artifacts.candidate),
    },
    evidence: {
      pairCount: input.pairs.length,
      runCount: input.pairs.length * 2,
      validPairCount: input.comparison.validPairCount,
      validUniqueCaseCount: input.comparison.validUniqueCaseCount,
      invalidPairCount: input.comparison.invalidPairCount,
      exposedRunCount: [...runs.control, ...runs.candidate].filter((run) => run.exposure.state === 'exposed').length,
    },
    result: {
      decision: input.decision,
      taskSuccessLift: input.comparison.quality.taskSuccessLift,
      guardrails: input.comparison.guardrails,
    },
    execution: {
      control: summarizeExecution(runs.control),
      candidate: summarizeExecution(runs.candidate),
    },
    usage,
    cost: {
      ...cost,
      total: { estimatedUsd: cost.control.estimatedUsd + cost.candidate.estimatedUsd },
      formula: 'inputCacheMiss * missRate + inputCacheHit * hitRate + output * outputRate',
      reasoningHandling: 'reported separately and not added again to provider output tokens',
      complete:
        usage.control.runsWithUsage === usage.control.runs &&
        usage.candidate.runsWithUsage === usage.candidate.runs &&
        usage.control.cacheWrite === 0 &&
        usage.candidate.cacheWrite === 0,
    },
    pricing: input.pricing,
    evidenceBoundary: {
      rawSessionsPublished: false,
      rawToolOutputPublished: false,
      spillContentsPublished: false,
      absolutePathsPublished: false,
      credentialsPublished: false,
      statisticalSignificanceClaimed: false,
    },
  }
}

const forbiddenKeys = new Set([
  'materializedPath',
  'stdoutPath',
  'stderrPath',
  'sessionLogPath',
  'finalOutputPath',
  'workspaceDiffPath',
])

function assertNoForbiddenKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoForbiddenKeys(entry, `${path}[${index}]`)
    })
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key)) throw new Error(`Case-study summary contains forbidden key at ${path}.${key}`)
    assertNoForbiddenKeys(entry, `${path}.${key}`)
  }
}

export function assertSanitizedCaseStudySummary(summary: unknown, forbiddenValues: readonly string[] = []): void {
  assertNoForbiddenKeys(summary)
  const serialized = JSON.stringify(summary)
  const found = forbiddenValues.find((value) => value !== '' && serialized.includes(value))
  if (found !== undefined) throw new Error('Case-study summary contains forbidden value')
}
