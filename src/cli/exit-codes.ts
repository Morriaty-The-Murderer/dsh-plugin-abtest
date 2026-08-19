import type { PromotionOutcome } from '../domain/types.js'

export const EXIT_CODES = {
  success: 0,
  validationError: 2,
  executionFailure: 3,
  inconclusive: 4,
  reject: 5,
  internalError: 10,
} as const

export function exitCodeForDecision(outcome: PromotionOutcome): number {
  if (outcome === 'INCONCLUSIVE') return EXIT_CODES.inconclusive
  if (outcome === 'REJECT') return EXIT_CODES.reject
  return EXIT_CODES.success
}
