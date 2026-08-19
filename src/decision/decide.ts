import type { PromotionDecision, PromotionPolicy } from '../domain/types.js'
import type { Comparison } from '../evaluate/metrics.js'
import { guardrailViolations, hardGateViolations, type PolicyViolation } from './policy.js'

function decision(
  outcome: PromotionDecision['outcome'],
  comparison: Comparison,
  violations: readonly PolicyViolation[],
): PromotionDecision {
  return {
    outcome,
    reasons: violations.map((violation) => violation.reason),
    triggeredRules: violations.map((violation) => violation.rule),
    validPairCount: comparison.validPairCount,
    invalidPairCount: comparison.invalidPairCount,
  }
}

export function decidePromotion(comparison: Comparison, policy: PromotionPolicy): PromotionDecision {
  const sufficiency: PolicyViolation[] = []
  if (comparison.validPairCount < policy.minimumValidPairs) {
    sufficiency.push({ rule: 'evidence.minimum_valid_pairs', reason: 'Too few valid pairs' })
  }
  if (comparison.integrityFailureCount > 0) {
    sufficiency.push({ rule: 'evidence.pair_integrity', reason: 'One or more pairs failed runtime integrity' })
  }
  if (comparison.exposureInsufficientCount > 0) {
    sufficiency.push({ rule: 'evidence.required_exposure', reason: 'Target plugin exposure was not verified' })
  }
  if (comparison.infrastructureFailureCount >= Math.max(1, comparison.validPairCount)) {
    sufficiency.push({
      rule: 'evidence.infrastructure_failures',
      reason: 'Infrastructure failures dominate the evidence',
    })
  }
  if (sufficiency.length > 0) return decision('INCONCLUSIVE', comparison, sufficiency)

  const hardGates = hardGateViolations(comparison, policy)
  if (hardGates.length > 0) return decision('REJECT', comparison, hardGates)

  const primaryPassed = comparison.quality.taskSuccessLift >= policy.minimumAbsoluteLift
  const guardrails = guardrailViolations(comparison, policy)
  const reviewConcerns = [
    ...guardrails,
    ...(comparison.highVariance === true
      ? [{ rule: 'review.high_variance', reason: 'Observed variance requires human review' }]
      : []),
  ]
  if (primaryPassed && reviewConcerns.length === 0) {
    return decision('PROMOTE', comparison, [
      { rule: 'primary.superiority', reason: 'Primary quality lift and all guardrails passed' },
    ])
  }
  if (comparison.quality.taskSuccessLift > 0 && reviewConcerns.length > 0) {
    return decision('REVIEW', comparison, reviewConcerns)
  }
  return decision('REJECT', comparison, [
    {
      rule: 'primary.minimum_absolute_lift',
      reason: `Task success lift ${comparison.quality.taskSuccessLift} is below ${policy.minimumAbsoluteLift}`,
    },
  ])
}
