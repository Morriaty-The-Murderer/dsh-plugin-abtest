import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { runCli } from '../../src/cli/main.js'
import { freezeExperiment, initProject, runExperiment } from '../../src/cli/workflow.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function command(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout: string[] = []
  const stderr: string[] = []
  const code = await runCli(args, { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) })
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

describe('offline CLI workflow', () => {
  it('init 到 report/decision 全流程可离线重复执行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-workflow-'))
    roots.push(root)
    const project = join(root, 'project')
    const output = join(root, 'evidence')
    expect((await command(['init', '--output', project, '--json'])).code).toBe(0)
    const manifest = join(project, 'experiment.yml')

    for (const name of ['validate', 'freeze', 'run', 'status', 'compare']) {
      const result = await command([name, '--manifest', manifest, '--output', output, '--json'])
      expect(result.code, `${name}: ${result.stderr}`).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true })
    }

    const resumedRun = await command(['run', '--manifest', manifest, '--output', output, '--json'])
    expect(resumedRun.code, resumedRun.stderr).toBe(0)
    expect(JSON.parse(resumedRun.stdout)).toMatchObject({ ok: true, pairCount: 4 })
    const resumedStatus = await command(['status', '--manifest', manifest, '--output', output, '--json'])
    expect(JSON.parse(resumedStatus.stdout)).toMatchObject({ completed: 4, valid: 4, failed: 0, pending: 0 })

    const comparison = JSON.parse(await readFile(join(output, 'example-plugin-improvement', 'comparison.json'), 'utf8'))
    expect(comparison).toMatchObject({
      validUniqueCaseCount: 2,
      caseStability: { evaluableCaseCount: 2, unstableCaseCount: 0, status: 'stable' },
      quality: {
        blindOutcomes: { candidateWins: 0, controlWins: 0, ties: 0, evaluatedPairs: 0 },
        blindWinRate: null,
      },
    })

    const decision = await command(['decision', '--manifest', manifest, '--output', output, '--json'])
    expect(decision.code).toBe(0)
    expect(JSON.parse(decision.stdout)).toMatchObject({ ok: true, outcome: 'PROMOTE' })
    const report = await command(['report', '--manifest', manifest, '--output', output, '--json'])
    expect(report.code).toBe(0)
    const reportPayload = JSON.parse(report.stdout)
    expect(await readFile(reportPayload.paths.markdown, 'utf8')).toContain('PROMOTE')
    expect(await readFile(reportPayload.paths.html, 'utf8')).not.toMatch(/<script/i)

    const casesPath = join(project, 'evals', 'cases.yml')
    const originalCases = await readFile(casesPath, 'utf8')
    await writeFile(casesPath, originalCases.replace('expected fixture value', 'changed fixture value'))
    const driftedCases = await command(['run', '--manifest', manifest, '--output', output, '--json'])
    expect(driftedCases.code).toBe(3)
    expect(JSON.parse(driftedCases.stderr).message).toContain('Case suite changed after freeze')
    await writeFile(casesPath, originalCases)

    await writeFile(join(project, 'variants', 'candidate.yml'), 'mode: changed\n')
    const driftedConfig = await command(['run', '--manifest', manifest, '--output', output, '--json'])
    expect(driftedConfig.code).toBe(3)
    expect(JSON.parse(driftedConfig.stderr).message).toContain('candidate plugin config changed after freeze')
  })

  it('冻结制品被改动后拒绝运行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-artifact-integrity-'))
    roots.push(root)
    const project = join(root, 'project')
    const output = join(root, 'evidence')
    const { manifest } = await initProject(project)
    const frozen = await freezeExperiment(manifest, output)
    await writeFile(join(frozen.artifacts.candidate.materializedPath, 'tampered.txt'), 'changed after freeze\n')

    await expect(runExperiment(manifest, output)).rejects.toThrow(/candidate artifact changed after freeze/i)
  })

  it('按 manifest concurrency 并发执行不同 pair 且保持完整结果', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-concurrency-'))
    roots.push(root)
    const project = join(root, 'project')
    const output = join(root, 'evidence')
    const { manifest } = await initProject(project)
    const document = parse(await readFile(manifest, 'utf8'))
    document.suite.repetitions = 2
    document.execution.concurrency = 2
    document.decision.minimum_valid_pairs = 4
    await writeFile(manifest, stringify(document))
    for (const variant of ['control-v1', 'candidate-v2']) {
      const packagePath = join(project, 'plugins', variant, 'package.json')
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
      packageJson.fixtureBehavior.hangMs = 400
      await writeFile(packagePath, `${JSON.stringify(packageJson)}\n`)
    }
    await freezeExperiment(manifest, output)

    const startedAt = performance.now()
    const result = await runExperiment(manifest, output)
    const elapsedMs = performance.now() - startedAt

    expect(result.pairs.map((pair) => pair.id)).toEqual([
      'expected-output-0',
      'expected-output-1',
      'clean-process-exit-0',
      'clean-process-exit-1',
    ])
    expect(elapsedMs).toBeLessThan(2_800)
  }, 10_000)
})
