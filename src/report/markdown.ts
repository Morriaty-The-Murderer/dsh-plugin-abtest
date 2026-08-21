export interface ReportView {
  experimentId: string
  comparison: {
    validPairCount: number
    validUniqueCaseCount: number
    invalidPairCount: number
    caseStability: {
      evaluableCaseCount: number
      unstableCaseCount: number
      status: 'not_evaluable' | 'stable' | 'unstable'
    }
    quality: {
      taskSuccessLift: number
      criticalCaseRegressions: number
      pairedOutcomes?: { wins: number; losses: number; ties: number }
      blindOutcomes: { candidateWins: number; controlWins: number; ties: number; evaluatedPairs: number }
      blindWinRate?: number | null
    }
    guardrails: {
      medianTokenIncreasePct: number | null
      p95LatencyIncreasePct: number | null
      toolErrorRateIncreasePp: number | null
    }
  }
  decision: { outcome: string; reasons: readonly string[]; triggeredRules: readonly string[] }
  exposureSummary: { exposed: number; unknown: number }
}

function percentage(value: number | null): string {
  return value === null ? 'unavailable' : `${value.toFixed(2)}%`
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function renderMarkdownReport(result: ReportView): string {
  const reasons =
    result.decision.reasons.length === 0 ? '- None' : result.decision.reasons.map((reason) => `- ${reason}`).join('\n')
  return `# Experiment ${escapeCell(result.experimentId)}

## Decision

**${escapeCell(result.decision.outcome)}**

${reasons}

## Evidence

| Measure | Value |
| --- | ---: |
| Valid pairs | ${result.comparison.validPairCount} |
| Valid unique cases | ${result.comparison.validUniqueCaseCount} |
| Invalid pairs | ${result.comparison.invalidPairCount} |
| Case stability | ${result.comparison.caseStability.status} (${result.comparison.caseStability.unstableCaseCount} / ${result.comparison.caseStability.evaluableCaseCount} unstable) |
| Exposure verified | ${result.exposureSummary.exposed} |
| Exposure unknown | ${result.exposureSummary.unknown} |
| Task success lift | ${percentage(result.comparison.quality.taskSuccessLift * 100)} |
| Paired wins / losses / ties | ${result.comparison.quality.pairedOutcomes === undefined ? 'unavailable' : `${result.comparison.quality.pairedOutcomes.wins} / ${result.comparison.quality.pairedOutcomes.losses} / ${result.comparison.quality.pairedOutcomes.ties}`} |
| Blind Candidate / Control / ties | ${result.comparison.quality.blindOutcomes.candidateWins} / ${result.comparison.quality.blindOutcomes.controlWins} / ${result.comparison.quality.blindOutcomes.ties} |
| Blind win rate | ${percentage((result.comparison.quality.blindWinRate ?? null) === null ? null : (result.comparison.quality.blindWinRate as number) * 100)} |
| Critical case regressions | ${result.comparison.quality.criticalCaseRegressions} |
| Median token increase | ${percentage(result.comparison.guardrails.medianTokenIncreasePct)} |
| P95 latency increase | ${percentage(result.comparison.guardrails.p95LatencyIncreasePct)} |
| Tool error-rate increase | ${percentage(result.comparison.guardrails.toolErrorRateIncreasePp)} |

## Triggered rules

${result.decision.triggeredRules.map((rule) => `- ${escapeCell(rule)}`).join('\n') || '- None'}

## Evidence boundary

The decision is produced by deterministic policy code. Blind comparison and post-hoc explanations cannot override hard gates.
`
}
