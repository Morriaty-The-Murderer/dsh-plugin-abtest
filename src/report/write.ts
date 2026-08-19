import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { FrozenArtifact, RunPair } from '../domain/types.js'
import { renderHtmlReport } from './html.js'
import { canonicalJson } from './json.js'
import { type ReportView, renderMarkdownReport } from './markdown.js'

export interface ExperimentReportInput extends ReportView {
  manifestLock: unknown
  artifacts: { control: FrozenArtifact; candidate: FrozenArtifact }
  pairs: readonly RunPair[]
}

export interface ReportPaths {
  manifestLock: string
  controlArtifact: string
  candidateArtifact: string
  comparison: string
  decision: string
  markdown: string
  html: string
  pairFiles: string[]
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
}

function assertNoForbiddenValues(input: unknown, forbiddenValues: readonly string[]): void {
  const serialized = JSON.stringify(input)
  const found = forbiddenValues.find((value) => value !== '' && serialized.includes(value))
  if (found !== undefined) throw new Error(`Report contains forbidden value: ${found}`)
}

export async function writeExperimentReport(
  input: ExperimentReportInput,
  outputRoot: string,
  options: { forbiddenValues?: readonly string[] } = {},
): Promise<ReportPaths> {
  assertNoForbiddenValues(input, options.forbiddenValues ?? [])
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.experimentId)) throw new Error('Invalid experiment id')
  const root = resolve(outputRoot, input.experimentId)
  const paths: ReportPaths = {
    manifestLock: join(root, 'manifest.lock.json'),
    controlArtifact: join(root, 'control-artifact.json'),
    candidateArtifact: join(root, 'candidate-artifact.json'),
    comparison: join(root, 'comparison.json'),
    decision: join(root, 'decision.json'),
    markdown: join(root, 'report.md'),
    html: join(root, 'report.html'),
    pairFiles: input.pairs.map((pair) => join(root, 'pairs', pair.id, 'pair.json')),
  }
  await Promise.all([
    atomicWrite(paths.manifestLock, canonicalJson(input.manifestLock)),
    atomicWrite(paths.controlArtifact, canonicalJson(input.artifacts.control)),
    atomicWrite(paths.candidateArtifact, canonicalJson(input.artifacts.candidate)),
    atomicWrite(paths.comparison, canonicalJson(input.comparison)),
    atomicWrite(paths.decision, canonicalJson(input.decision)),
    atomicWrite(paths.markdown, renderMarkdownReport(input)),
    atomicWrite(paths.html, renderHtmlReport(input)),
    ...input.pairs.flatMap((pair, index) => {
      const pairFile = paths.pairFiles[index] as string
      return [
        atomicWrite(pairFile, canonicalJson(pair)),
        atomicWrite(join(dirname(pairFile), 'control', 'run.json'), canonicalJson(pair.control)),
        atomicWrite(join(dirname(pairFile), 'candidate', 'run.json'), canonicalJson(pair.candidate)),
      ]
    }),
  ])
  return paths
}
