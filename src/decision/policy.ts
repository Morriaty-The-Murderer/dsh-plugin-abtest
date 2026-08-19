import type { PromotionPolicy } from '../domain/types.js'
import type { Comparison } from '../evaluate/metrics.js'

export interface PolicyViolation {
  rule: string
  reason: string
}

export function hardGateViolations(comparison: Comparison, policy: PromotionPolicy): PolicyViolation[] {
  const violations: PolicyViolation[] = []
  if (policy.hardGates.bootSuccess && !comparison.quality.bootSuccess) {
    violations.push({
      rule: 'hard_gate.boot_success',
      reason: 'Candidate did not boot successfully in every valid pair',
    })
  }
  if (policy.hardGates.activationSuccess && !comparison.quality.activationSuccess) {
    violations.push({
      rule: 'hard_gate.activation_success',
      reason: 'Candidate did not activate successfully in every valid pair',
    })
  }
  if (comparison.quality.candidateCriticalSecurityViolations > policy.hardGates.criticalSecurityViolations) {
    violations.push({
      rule: 'hard_gate.critical_security_violations',
      reason: 'Candidate exceeded the critical security violation limit',
    })
  }
  if (comparison.quality.criticalCaseRegressions > policy.hardGates.criticalCaseRegressions) {
    violations.push({
      rule: 'hard_gate.critical_case_regressions',
      reason: 'Candidate exceeded the critical case regression limit',
    })
  }
  return violations
}

export function guardrailViolations(comparison: Comparison, policy: PromotionPolicy): PolicyViolation[] {
  const rules = [
    {
      rule: 'guardrail.median_token_increase_pct',
      value: comparison.guardrails.medianTokenIncreasePct,
      limit: policy.guardrails.medianTokenIncreasePct,
    },
    {
      rule: 'guardrail.p95_latency_increase_pct',
      value: comparison.guardrails.p95LatencyIncreasePct,
      limit: policy.guardrails.p95LatencyIncreasePct,
    },
    {
      rule: 'guardrail.tool_error_rate_increase_pp',
      value: comparison.guardrails.toolErrorRateIncreasePp,
      limit: policy.guardrails.toolErrorRateIncreasePp,
    },
  ]
  return rules.flatMap(({ rule, value, limit }) =>
    value === null || value > limit
      ? [
          {
            rule,
            reason: value === null ? 'Guardrail metric is unavailable' : `Guardrail value ${value} exceeds ${limit}`,
          },
        ]
      : [],
  )
}
