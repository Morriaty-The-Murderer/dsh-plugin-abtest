import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FrozenArtifact, RunPair } from '../../src/domain/types.js'
import { writeExperimentReport } from '../../src/report/write.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('report storage contract', () => {
  it('写入 canonical 文件树且拒绝 sentinel secret', async () => {
    const root = await mkdtemp(join(tmpdir(), 'report-storage-'))
    roots.push(root)
    const artifact = {
      packageName: 'fixture-plugin',
      packageVersion: '1.0.0',
      sourceType: 'local-directory',
      artifactHash: 'hash',
      pluginConfigHash: 'config',
      dependencyLockHash: 'lock',
      dshBundleHash: 'bundle',
      materializedPath: '/cache/artifact',
    } satisfies FrozenArtifact
    const pair = {
      id: 'case-a-0',
      caseId: 'case-a',
      repetition: 0,
      order: ['control', 'candidate'],
      integrity: { valid: true },
      control: { id: 'control' },
      candidate: { id: 'candidate' },
    } as unknown as RunPair
    const input = {
      experimentId: 'experiment-a',
      manifestLock: { schema_version: 1 },
      artifacts: { control: artifact, candidate: { ...artifact, artifactHash: 'candidate-hash' } },
      pairs: [pair],
      comparison: {
        validPairCount: 1,
        invalidPairCount: 0,
        quality: { taskSuccessLift: 0.1, criticalCaseRegressions: 0 },
        guardrails: { medianTokenIncreasePct: 0, p95LatencyIncreasePct: 0, toolErrorRateIncreasePp: 0 },
      },
      decision: { outcome: 'PROMOTE', reasons: ['passed'], triggeredRules: ['primary.superiority'] },
      exposureSummary: { exposed: 2, unknown: 0 },
    }
    const paths = await writeExperimentReport(input, root, { forbiddenValues: ['SENTINEL_SECRET'] })

    const writtenPaths = Object.values(paths).flatMap((path) => (Array.isArray(path) ? path : [path]))
    for (const path of writtenPaths) expect(await readFile(path, 'utf8')).not.toContain('SENTINEL_SECRET')
    expect(paths.manifestLock).toBe(join(root, 'experiment-a', 'manifest.lock.json'))
    expect(paths.controlArtifact).toBe(join(root, 'experiment-a', 'control-artifact.json'))
    expect(paths.pairFiles).toEqual([join(root, 'experiment-a', 'pairs', 'case-a-0', 'pair.json')])

    await expect(
      writeExperimentReport({ ...input, decision: { ...input.decision, reasons: ['SENTINEL_SECRET'] } }, root, {
        forbiddenValues: ['SENTINEL_SECRET'],
      }),
    ).rejects.toThrow(/forbidden value/i)
  })
})
