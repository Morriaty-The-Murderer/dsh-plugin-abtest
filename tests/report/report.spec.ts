import { describe, expect, it } from 'vitest'
import { renderHtmlReport } from '../../src/report/html.js'
import { canonicalJson } from '../../src/report/json.js'
import { renderMarkdownReport } from '../../src/report/markdown.js'

const result = {
  experimentId: 'experiment-a',
  comparison: {
    validPairCount: 6,
    validUniqueCaseCount: 3,
    invalidPairCount: 1,
    caseStability: { evaluableCaseCount: 3, unstableCaseCount: 1, status: 'unstable' as const },
    quality: {
      taskSuccessLift: 0.1,
      criticalCaseRegressions: 0,
      blindOutcomes: { candidateWins: 2, controlWins: 1, ties: 1, evaluatedPairs: 4 },
      blindWinRate: 2 / 3,
    },
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
    expect(markdown).toContain('Valid unique cases | 3')
    expect(markdown).toContain('Case stability | unstable (1 / 3 unstable)')
    expect(markdown).toContain('Blind Candidate / Control / ties | 2 / 1 / 1')
    expect(markdown).toContain('Exposure verified | 6')
    expect(markdown).toContain('Task success lift | 10.00%')
  })

  it('HTML 不含可执行脚本并声明离线 CSP', () => {
    const html = renderHtmlReport(result)
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('PROMOTE')
    expect(html).toContain('Valid unique cases</th><td>3')
    expect(html).toContain('Case stability</th><td>unstable (1 / 3 unstable)')
    expect(html).toContain('Blind Candidate / Control / ties</th><td>2 / 1 / 1')
  })
})
