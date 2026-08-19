import { decidePromotion } from '../decision/decide.js'
import type { PromotionDecision, PromotionPolicy } from '../domain/types.js'
import { aggregatePairs, type Comparison, type PairMeasurement } from './metrics.js'
import { type EvaluatedPairEvidence, type EvaluatePairInput, evaluatePairEvidence } from './pipeline.js'

export interface EvalEngine {
  evaluatePair(input: EvaluatePairInput): Promise<EvaluatedPairEvidence>
  aggregate(pairs: readonly PairMeasurement[]): Comparison
  decide(comparison: Comparison, policy: PromotionPolicy): PromotionDecision
}

export class DeterministicEvalEngine implements EvalEngine {
  evaluatePair(input: EvaluatePairInput): Promise<EvaluatedPairEvidence> {
    return evaluatePairEvidence(input)
  }

  aggregate(pairs: readonly PairMeasurement[]): Comparison {
    return aggregatePairs(pairs)
  }

  decide(comparison: Comparison, policy: PromotionPolicy): PromotionDecision {
    return decidePromotion(comparison, policy)
  }
}
