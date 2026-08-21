import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  assertSanitizedCaseStudySummary,
  createCaseStudySummary,
  parsePricingSnapshot,
} from '../../src/case-study/summary.js'
import { validateExperiment } from '../../src/cli/workflow.js'
import type { FrozenArtifact, PromotionDecision, RunPair } from '../../src/domain/types.js'
import type { Comparison } from '../../src/evaluate/metrics.js'
import { canonicalJson } from '../../src/report/json.js'
import { schedulePairs } from '../../src/runtime/scheduler.js'

function option(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} is required`)
  return value
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

const manifestPath = resolve(option('--manifest'))
const evidenceRoot = resolve(option('--evidence'))
const outputPath = resolve(option('--output'))
const { manifest, cases } = await validateExperiment(manifestPath)
const root = join(evidenceRoot, manifest.experiment.id)
const pricing = parsePricingSnapshot(await readJson(join(dirname(manifestPath), 'pricing.json')))
if (pricing.model !== manifest.runtime.model.name)
  throw new Error('Pricing snapshot model does not match manifest model')

const pairs = await Promise.all(
  schedulePairs(
    cases.map((caseDef) => caseDef.id),
    manifest.suite.repetitions,
  ).map((pair) => readJson<RunPair>(join(root, 'pairs', pair.id, 'pair.json'))),
)
const summary = createCaseStudySummary({
  experiment: {
    id: manifest.experiment.id,
    dshVersion: manifest.runtime.dsh_version,
    model: {
      provider: manifest.runtime.model.provider,
      name: manifest.runtime.model.name,
      parameters: manifest.runtime.model.parameters ?? {},
    },
  },
  artifacts: {
    control: await readJson<FrozenArtifact>(join(root, 'control-artifact.json')),
    candidate: await readJson<FrozenArtifact>(join(root, 'candidate-artifact.json')),
  },
  pairs,
  comparison: await readJson<Comparison>(join(root, 'comparison.json')),
  decision: await readJson<PromotionDecision>(join(root, 'decision.json')),
  pricing,
})
assertSanitizedCaseStudySummary(summary)

await mkdir(dirname(outputPath), { recursive: true })
const temporary = `${outputPath}.tmp-${process.pid}-${Date.now()}`
await writeFile(temporary, canonicalJson(summary), { mode: 0o600 })
await rename(temporary, outputPath)
process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath })}\n`)
