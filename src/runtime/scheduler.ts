import type { VariantId } from '../domain/types.js'

export interface ScheduledPair {
  id: string
  caseId: string
  repetition: number
  order: [VariantId, VariantId]
}

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function schedulePairs(caseIds: readonly string[], repetitions: number): ScheduledPair[] {
  if (!Number.isSafeInteger(repetitions) || repetitions <= 0) {
    throw new Error('Repetitions must be a positive safe integer')
  }
  const seen = new Set<string>()
  for (const caseId of caseIds) {
    if (!safeIdentifier.test(caseId)) {
      throw new Error(`Invalid case id: ${caseId}`)
    }
    if (seen.has(caseId)) {
      throw new Error(`Duplicate case id: ${caseId}`)
    }
    seen.add(caseId)
  }
  const pairs: ScheduledPair[] = []
  let pairIndex = 0
  for (const caseId of caseIds) {
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      pairs.push({
        id: `${caseId}-${repetition}`,
        caseId,
        repetition,
        order: pairIndex % 2 === 0 ? ['control', 'candidate'] : ['candidate', 'control'],
      })
      pairIndex += 1
    }
  }
  return pairs
}
