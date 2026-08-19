import type { BlindComparison, Case, RunPair, VariantId } from '../domain/types.js'
import { type DeterministicContext, evaluateDeterministic } from './assertions.js'
import {
  type AnonymousComparison,
  type BlindComparatorInput,
  createBlindComparison,
  revealComparison,
  writeBlindMapping,
} from './blind.js'
import { bootAndActivationPass } from './lifecycle.js'

export type EvaluationStageName =
  | 'integrity'
  | 'boot_activation'
  | 'deterministic'
  | 'lifecycle_safety'
  | 'blind_comparison'
  | 'efficiency'
  | 'post_hoc'
  | 'decision'

export interface EvaluationStage {
  name: EvaluationStageName
  status: 'passed' | 'failed' | 'skipped'
  reason?: string
}

export interface BlindComparatorLike {
  compare(input: BlindComparatorInput): Promise<AnonymousComparison>
}

export interface EvaluatePairInput {
  pair: RunPair
  caseDef: Case
  contexts: Record<VariantId, DeterministicContext>
  comparator?: BlindComparatorLike | ((input: BlindComparatorInput) => Promise<AnonymousComparison>)
  blindSeed?: string
  forbiddenIdentityValues?: readonly string[]
  blindMappingPath?: string
}

export interface EvaluatedPairEvidence {
  pair: RunPair
  stages: EvaluationStage[]
  blindResult?: BlindComparison
}

const tailStages: EvaluationStageName[] = ['lifecycle_safety', 'blind_comparison', 'efficiency', 'post_hoc', 'decision']

function skipped(names: readonly EvaluationStageName[], reason: string): EvaluationStage[] {
  return names.map((name) => ({ name, status: 'skipped', reason }))
}

export async function evaluatePairEvidence(input: EvaluatePairInput): Promise<EvaluatedPairEvidence> {
  const stages: EvaluationStage[] = []
  if (!input.pair.integrity.valid) {
    stages.push({ name: 'integrity', status: 'failed', reason: 'pair_integrity_failure' })
    stages.push(...skipped(['boot_activation', 'deterministic', ...tailStages], 'integrity failed'))
    return { pair: input.pair, stages }
  }
  stages.push({ name: 'integrity', status: 'passed' })
  const bootPassed = bootAndActivationPass(input.pair.control) && bootAndActivationPass(input.pair.candidate)
  if (!bootPassed) {
    stages.push({ name: 'boot_activation', status: 'failed' })
    stages.push(...skipped(['deterministic', ...tailStages], 'boot or activation failed'))
    return { pair: input.pair, stages }
  }
  stages.push({ name: 'boot_activation', status: 'passed' })
  const [controlAssertions, candidateAssertions] = await Promise.all([
    evaluateDeterministic(input.pair.control, input.caseDef, input.contexts.control),
    evaluateDeterministic(input.pair.candidate, input.caseDef, input.contexts.candidate),
  ])
  input.pair.control.assertions = controlAssertions
  input.pair.candidate.assertions = candidateAssertions
  const criticalFailure = [...controlAssertions, ...candidateAssertions].some(
    (result) => result.critical && !result.passed,
  )
  if (criticalFailure) {
    stages.push({ name: 'deterministic', status: 'failed', reason: 'critical assertion failed' })
    stages.push(...skipped(tailStages, 'deterministic assertion failed'))
    return { pair: input.pair, stages }
  }
  stages.push({ name: 'deterministic', status: 'passed' })
  stages.push({ name: 'lifecycle_safety', status: 'passed' })
  let blindResult: BlindComparison | undefined
  if (input.comparator === undefined) {
    stages.push({ name: 'blind_comparison', status: 'skipped', reason: 'comparator not configured' })
  } else {
    const compare =
      typeof input.comparator === 'function' ? input.comparator : input.comparator.compare.bind(input.comparator)
    const prepared = createBlindComparison({
      task: input.caseDef.task,
      controlOutput: input.contexts.control.finalOutput ?? '',
      candidateOutput: input.contexts.candidate.finalOutput ?? '',
      seed: input.blindSeed ?? input.pair.id,
      forbiddenIdentityValues: input.forbiddenIdentityValues ?? [],
      ...(input.caseDef.rubric === undefined ? {} : { rubric: input.caseDef.rubric }),
    })
    const anonymous = await compare(prepared.input)
    if (input.blindMappingPath !== undefined) await writeBlindMapping(input.blindMappingPath, prepared.mapping)
    blindResult = revealComparison(anonymous, prepared.mapping)
    stages.push({ name: 'blind_comparison', status: 'passed' })
  }
  stages.push({ name: 'efficiency', status: 'passed' })
  stages.push({ name: 'post_hoc', status: 'skipped', reason: 'post-hoc analyzer not configured' })
  stages.push({ name: 'decision', status: 'skipped', reason: 'decision runs after aggregation' })
  return blindResult === undefined ? { pair: input.pair, stages } : { pair: input.pair, stages, blindResult }
}
