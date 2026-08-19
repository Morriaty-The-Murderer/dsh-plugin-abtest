import type { ReportView } from './markdown.js'

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function row(label: string, value: unknown): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

export function renderHtmlReport(result: ReportView): string {
  const reasons = result.decision.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('') || '<li>None</li>'
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Experiment ${escapeHtml(result.experimentId)}</title>
  <style>body{font:16px system-ui;max-width:960px;margin:3rem auto;padding:0 1rem;color:#18202a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd3da;padding:.55rem;text-align:left}th{width:45%;background:#f5f7f9}.outcome{font-size:2rem;font-weight:700}</style>
</head>
<body>
  <h1>Experiment ${escapeHtml(result.experimentId)}</h1>
  <p class="outcome">${escapeHtml(result.decision.outcome)}</p>
  <h2>Reasons</h2><ul>${reasons}</ul>
  <h2>Evidence</h2>
  <table><tbody>
    ${row('Valid pairs', result.comparison.validPairCount)}
    ${row('Invalid pairs', result.comparison.invalidPairCount)}
    ${row('Exposure verified', result.exposureSummary.exposed)}
    ${row('Exposure unknown', result.exposureSummary.unknown)}
    ${row('Task success lift', result.comparison.quality.taskSuccessLift)}
    ${row('Paired wins / losses / ties', result.comparison.quality.pairedOutcomes === undefined ? 'unavailable' : `${result.comparison.quality.pairedOutcomes.wins} / ${result.comparison.quality.pairedOutcomes.losses} / ${result.comparison.quality.pairedOutcomes.ties}`)}
    ${row('Blind win rate', result.comparison.quality.blindWinRate ?? 'unavailable')}
    ${row('Critical case regressions', result.comparison.quality.criticalCaseRegressions)}
    ${row('Median token increase pct', result.comparison.guardrails.medianTokenIncreasePct ?? 'unavailable')}
    ${row('P95 latency increase pct', result.comparison.guardrails.p95LatencyIncreasePct ?? 'unavailable')}
    ${row('Tool error rate increase pp', result.comparison.guardrails.toolErrorRateIncreasePp ?? 'unavailable')}
  </tbody></table>
  <h2>Evidence boundary</h2>
  <p>The decision is produced by deterministic policy code. Optional generated analysis cannot override hard gates.</p>
</body>
</html>
`
}
