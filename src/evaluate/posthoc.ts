import type { PostHocAnalysis } from '../domain/types.js'

const causalLanguage = /\b(?:cause[ds]?|causing|because|therefore|due to|resulted in|led to)\b/i

function clean(values: readonly string[], label: string): string[] {
  return values.map((value) => {
    const normalized = value.trim()
    if (normalized === '') throw new Error(`${label} entries must not be empty`)
    return normalized
  })
}

export function createPostHocAnalysis(input: PostHocAnalysis): PostHocAnalysis {
  const observedEvidence = clean(input.observedEvidence, 'Observed evidence')
  if (observedEvidence.some((entry) => causalLanguage.test(entry))) {
    throw new Error('Observed evidence must not contain unproven causal language')
  }
  return {
    observedEvidence,
    likelyExplanations: clean(input.likelyExplanations, 'Likely explanation'),
    unprovenCausalClaims: clean(input.unprovenCausalClaims, 'Unproven causal claim'),
  }
}
