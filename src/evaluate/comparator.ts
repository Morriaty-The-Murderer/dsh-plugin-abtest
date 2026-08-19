import type { AnonymousComparison, BlindComparatorInput } from './blind.js'

export interface BlindComparator {
  compare(input: BlindComparatorInput): Promise<AnonymousComparison>
}

export class MockBlindComparator implements BlindComparator {
  readonly #compare: (input: BlindComparatorInput) => AnonymousComparison | Promise<AnonymousComparison>

  constructor(compare: (input: BlindComparatorInput) => AnonymousComparison | Promise<AnonymousComparison>) {
    this.#compare = compare
  }

  async compare(input: BlindComparatorInput): Promise<AnonymousComparison> {
    return this.#compare(input)
  }
}
