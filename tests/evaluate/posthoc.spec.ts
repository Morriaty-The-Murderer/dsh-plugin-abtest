import { describe, expect, it } from 'vitest'
import { createPostHocAnalysis } from '../../src/evaluate/posthoc.js'

describe('post-hoc analysis', () => {
  it('把事实、可能解释和未证因果声明保持为三层', () => {
    expect(
      createPostHocAnalysis({
        observedEvidence: ['Candidate called one fewer tool'],
        likelyExplanations: ['The new prompt may reduce retries'],
        unprovenCausalClaims: ['Trace correlation does not prove the plugin caused the change'],
      }),
    ).toEqual({
      observedEvidence: ['Candidate called one fewer tool'],
      likelyExplanations: ['The new prompt may reduce retries'],
      unprovenCausalClaims: ['Trace correlation does not prove the plugin caused the change'],
    })
  })

  it('拒绝把因果词写入 observed evidence', () => {
    expect(() =>
      createPostHocAnalysis({
        observedEvidence: ['The plugin caused the lower latency'],
        likelyExplanations: [],
        unprovenCausalClaims: [],
      }),
    ).toThrow(/observed evidence/i)
  })
})
