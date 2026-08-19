import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BlindComparison, VariantId } from '../domain/types.js'

export interface BlindComparatorInput {
  task: string
  outputA: string
  outputB: string
  rubric?: string
  deterministicSummary?: string
}

export interface BlindMapping {
  id: string
  A: VariantId
  B: VariantId
}

export interface AnonymousComparison {
  anonymousWinner: 'A' | 'B' | 'tie'
  reasoning: string
  scores: { A: number; B: number }
}

export interface PrepareBlindInput {
  task: string
  controlOutput: string
  candidateOutput: string
  rubric?: string
  deterministicSummary?: string
  seed: string
  forbiddenIdentityValues: readonly string[]
}

function mappingForSeed(seed: string): BlindMapping {
  const digest = createHash('sha256').update(seed).digest()
  const controlFirst = (digest[0] ?? 0) % 2 === 0
  return {
    id: createHash('sha256').update(`mapping:${seed}`).digest('hex'),
    A: controlFirst ? 'control' : 'candidate',
    B: controlFirst ? 'candidate' : 'control',
  }
}

function assertNoIdentityLeak(input: BlindComparatorInput, forbiddenValues: readonly string[]): void {
  const serialized = JSON.stringify(input).toLocaleLowerCase('en')
  const leaked = forbiddenValues.find((value) => value !== '' && serialized.includes(value.toLocaleLowerCase('en')))
  if (leaked !== undefined) throw new Error(`Blind comparator identity leak detected for forbidden value: ${leaked}`)
}

export function createBlindComparison(input: PrepareBlindInput): {
  input: BlindComparatorInput
  mapping: BlindMapping
} {
  const mapping = mappingForSeed(input.seed)
  const outputs: Record<VariantId, string> = {
    control: input.controlOutput,
    candidate: input.candidateOutput,
  }
  const comparatorInput: BlindComparatorInput = {
    task: input.task,
    outputA: outputs[mapping.A],
    outputB: outputs[mapping.B],
  }
  if (input.rubric !== undefined) comparatorInput.rubric = input.rubric
  if (input.deterministicSummary !== undefined) comparatorInput.deterministicSummary = input.deterministicSummary
  assertNoIdentityLeak(comparatorInput, input.forbiddenIdentityValues)
  return { input: comparatorInput, mapping }
}

export async function writeBlindMapping(path: string, mapping: BlindMapping): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(mapping, undefined, 2)}\n`, { mode: 0o600 })
}

export function revealComparison(result: AnonymousComparison, mapping: BlindMapping): BlindComparison {
  const winner = result.anonymousWinner === 'tie' ? 'tie' : mapping[result.anonymousWinner]
  return {
    mappingId: mapping.id,
    winner,
    anonymousWinner: result.anonymousWinner,
    reasoning: result.reasoning,
    scores: {
      [mapping.A]: result.scores.A,
      [mapping.B]: result.scores.B,
    } as { control: number; candidate: number },
  }
}
