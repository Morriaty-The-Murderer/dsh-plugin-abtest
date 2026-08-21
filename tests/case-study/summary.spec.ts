import { describe, expect, it } from 'vitest'
import {
  assertSanitizedCaseStudySummary,
  createCaseStudySummary,
  parsePricingSnapshot,
} from '../../src/case-study/summary.js'
import type { FrozenArtifact, PromotionDecision, Run, RunPair } from '../../src/domain/types.js'
import type { Comparison } from '../../src/evaluate/metrics.js'

function artifact(configHash: string): FrozenArtifact {
  return {
    packageName: 'toolshrink',
    packageVersion: '0.1.0',
    sourceType: 'github',
    sourceCommit: '3d654ab491146dd685f0b47fef94e78a14590860',
    artifactHash: 'artifact-hash',
    pluginConfigHash: configHash,
    dependencyLockHash: 'lock-hash',
    dshBundleHash: 'bundle-hash',
    materializedPath: '/private/raw/artifact',
  }
}

function run(variant: 'control' | 'candidate', usage: NonNullable<Run['evidence']['tokenUsage']>): Run {
  return {
    id: `case-0-${variant}`,
    variant,
    caseId: 'case',
    repetition: 0,
    fingerprint: {} as Run['fingerprint'],
    evidence: {
      stdoutPath: '/private/raw/stdout.log',
      stderrPath: '/private/raw/stderr.log',
      processExitCode: 0,
      signal: null,
      durationMs: 100,
      startupMs: 10,
      tokenUsage: usage,
    },
    exposure: { state: 'exposed', detectors: [] },
    assertions: [],
  }
}

describe('真实案例脱敏摘要', () => {
  it('只汇总可发布身份、指标与峰值费率成本，不带原始路径或输出', () => {
    const pairs: RunPair[] = [
      {
        id: 'case-0',
        caseId: 'case',
        repetition: 0,
        order: ['control', 'candidate'],
        control: run('control', { input: 100, output: 10, reasoning: 3, cacheRead: 20, cacheWrite: 1 }),
        candidate: run('candidate', { input: 60, output: 8, reasoning: 2, cacheRead: 20, cacheWrite: 0 }),
        integrity: { valid: true },
      },
    ]
    const comparison = {
      validPairCount: 1,
      validUniqueCaseCount: 1,
      invalidPairCount: 0,
      quality: { taskSuccessLift: 0 },
      guardrails: {
        medianTokenIncreasePct: -25,
        p95LatencyIncreasePct: 5,
        toolErrorRateIncreasePp: 0,
      },
    } as Comparison
    const decision: PromotionDecision = {
      outcome: 'REJECT',
      reasons: ['Task success lift 0 is below 0.01'],
      triggeredRules: ['primary.minimum_absolute_lift'],
      validPairCount: 1,
      invalidPairCount: 0,
    }
    const summary = createCaseStudySummary({
      experiment: {
        id: 'toolshrink-context-budget',
        dshVersion: '0.1.0-rc.7',
        model: {
          provider: 'deepseek-official',
          name: 'deepseek-v4-flash',
          parameters: { reasoningEffort: 'off', maxTokens: 2_048 },
        },
      },
      artifacts: { control: artifact('control-config'), candidate: artifact('candidate-config') },
      pairs,
      comparison,
      decision,
      pricing: {
        schemaVersion: 1,
        asOf: '2026-08-21',
        source: 'https://api-docs.deepseek.com/quick_start/pricing/',
        currency: 'USD',
        model: 'deepseek-v4-flash',
        assumption: 'peak-rate-upper-bound',
        perMillionTokens: { inputCacheHit: 0.014, inputCacheMiss: 0.44, output: 1.32 },
      },
    })

    expect(summary.usage.control).toMatchObject({ inputCacheMiss: 100, inputCacheHit: 20, output: 10 })
    expect(summary.cost.control.estimatedUsd).toBeCloseTo(0.00005748, 12)
    expect(summary.cost.candidate.estimatedUsd).toBeCloseTo(0.00003724, 12)
    expect(summary.cost.complete).toBe(false)
    expect(JSON.stringify(summary)).not.toContain('/private/raw')
    expect(() => assertSanitizedCaseStudySummary(summary, ['secret-value'])).not.toThrow()
  })

  it('脱敏审计发现禁止值时拒绝发布', () => {
    expect(() => assertSanitizedCaseStudySummary({ note: 'contains secret-value' }, ['secret-value'])).toThrow(
      /forbidden value/i,
    )
  })

  it('拒绝负费率或缺字段的价格快照', () => {
    expect(() =>
      parsePricingSnapshot({
        schemaVersion: 1,
        asOf: '2026-08-21',
        source: 'https://api-docs.deepseek.com/quick_start/pricing/',
        currency: 'USD',
        model: 'deepseek-v4-flash',
        assumption: 'peak-rate-upper-bound',
        perMillionTokens: { inputCacheHit: -1, inputCacheMiss: 0.44, output: 1.32 },
      }),
    ).toThrow(/pricing snapshot/i)
  })
})
