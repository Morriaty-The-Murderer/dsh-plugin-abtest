import { describe, expect, it } from 'vitest'
import { renderHtmlReport } from '../../src/report/html.js'
import { canonicalJson } from '../../src/report/json.js'
import { renderMarkdownReport } from '../../src/report/markdown.js'

const result = {
  experimentId: 'experiment-a',
  comparison: {
    validPairCount: 6,
    invalidPairCount: 1,
    quality: { taskSuccessLift: 0.1, criticalCaseRegressions: 0 },
    guardrails: { medianTokenIncreasePct: 10, p95LatencyIncreasePct: 12, toolErrorRateIncreasePp: 0 },
  },
  decision: {
    outcome: 'PROMOTE',
    reasons: ['Primary quality lift and all guardrails passed'],
    triggeredRules: ['primary.superiority'],
  },
  exposureSummary: { exposed: 6, unknown: 0 },
}

describe('reports', () => {
  it('canonical JSON 对键顺序稳定并以换行结束', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
  })

  it('Markdown 呈现有效性、暴露、质量、guardrail 和 outcome', () => {
    const markdown = renderMarkdownReport(result)
    expect(markdown).toContain('# Experiment experiment-a')
    expect(markdown).toContain('PROMOTE')
    expect(markdown).toContain('Valid pairs | 6')
    expect(markdown).toContain('Exposure verified | 6')
    expect(markdown).toContain('Task success lift | 10.00%')
  })

  it('HTML 不含可执行脚本并声明离线 CSP', () => {
    const html = renderHtmlReport(result)
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('PROMOTE')
  })
})
