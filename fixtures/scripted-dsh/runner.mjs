import fs from 'node:fs'
import path from 'node:path'

const artifact = JSON.parse(fs.readFileSync(path.join(process.env.DSH_EXPERIMENT_ARTIFACT, 'package.json'), 'utf8'))
const behavior = artifact.fixtureBehavior ?? {}
fs.mkdirSync(process.env.DSH_EXPERIMENT_SESSION_ROOT, { recursive: true })
if (behavior.hangMs) setTimeout(() => {}, behavior.hangMs)
const events = [
  { type: 'session', version: 0, id: process.env.DSH_EXPERIMENT_VARIANT, delegationDepth: 0 },
  { type: 'plugin/loaded', seq: 0, data: { name: artifact.name } },
]
if (behavior.bootFailure) {
  fs.writeFileSync(
    path.join(process.env.DSH_EXPERIMENT_SESSION_ROOT, 'session.jsonl'),
    `${events.map(JSON.stringify).join('\n')}\n`,
  )
  process.exit(1)
}
events.push({ type: 'plugin/activated', seq: 1, data: { name: artifact.name } })
if (!behavior.unexposed) {
  events.push({ type: 'dsh.plugin-experiment/exposure', seq: 2, data: { plugin: artifact.name } })
}
events.push({ type: 'tool/call', seq: 3, data: { name: 'fixture_tool', callId: 'call-1' } })
events.push({ type: 'tool/result', seq: 4, data: { callId: 'call-1', ok: true } })
events.push({ type: 'assistant/final', seq: 5, data: { text: behavior.output ?? '' } })
events.push({
  type: 'usage',
  seq: 6,
  data: {
    input: behavior.inputTokens ?? 50,
    output: behavior.outputTokens ?? 50,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
})
fs.writeFileSync(
  path.join(process.env.DSH_EXPERIMENT_SESSION_ROOT, 'session.jsonl'),
  `${events.map(JSON.stringify).join('\n')}\n`,
)
process.stdout.write(behavior.output ?? '')
