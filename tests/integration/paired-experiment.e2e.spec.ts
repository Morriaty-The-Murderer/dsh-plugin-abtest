import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { decideExperiment, freezeExperiment, initProject, runExperiment } from '../../src/cli/workflow.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function scenario(candidateFixture: string, timeoutMs?: number) {
  const root = await mkdtemp(join(tmpdir(), `paired-${candidateFixture}-`))
  roots.push(root)
  const project = join(root, 'project')
  const output = join(root, 'output')
  await initProject(project)
  await cp(resolve('fixtures/plugins', candidateFixture), join(project, 'plugins', 'candidate-v2'), {
    recursive: true,
    force: true,
  })
  const manifest = join(project, 'experiment.yml')
  if (timeoutMs !== undefined) {
    const document = parse(await readFile(manifest, 'utf8'))
    document.execution.timeout_ms = timeoutMs
    await writeFile(manifest, stringify(document))
  }
  await freezeExperiment(manifest, output)
  await runExperiment(manifest, output)
  return decideExperiment(manifest, output)
}

describe('deterministic candidate fixtures', () => {
  it('measurement 保留 case、repetition 与可选盲评结果', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paired-measurement-identity-'))
    roots.push(root)
    const project = join(root, 'project')
    const output = join(root, 'output')
    const { manifest } = await initProject(project)
    await freezeExperiment(manifest, output)

    await runExperiment(manifest, output, {
      comparator: async () => ({
        anonymousWinner: 'tie',
        reasoning: 'outputs are equivalent',
        scores: { A: 3, B: 3 },
      }),
    })

    const measurement = JSON.parse(
      await readFile(
        join(output, 'example-plugin-improvement', 'pairs', 'expected-output-0', 'measurement.json'),
        'utf8',
      ),
    )
    expect(measurement).toMatchObject({ caseId: 'expected-output', repetition: 0, blindWinner: 'tie' })
  })

  it('Candidate V2 达到 PROMOTE', async () => {
    expect((await scenario('candidate-v2')).outcome).toBe('PROMOTE')
  })

  it('regressed Candidate 达到 REJECT', async () => {
    expect((await scenario('candidate-regressed')).outcome).toBe('REJECT')
  })

  it('loaded but unexposed Candidate 达到 INCONCLUSIVE', async () => {
    expect((await scenario('candidate-unexposed')).outcome).toBe('INCONCLUSIVE')
  })

  it('manifest 配置的工具调用 detector 可以证明第三方插件暴露', async () => {
    const root = await mkdtemp(join(tmpdir(), 'paired-configurable-exposure-'))
    roots.push(root)
    const project = join(root, 'project')
    const output = join(root, 'output')
    await initProject(project)
    await cp(resolve('fixtures/plugins/candidate-unexposed'), join(project, 'plugins', 'candidate-v2'), {
      recursive: true,
      force: true,
    })
    const manifest = join(project, 'experiment.yml')
    const document = parse(await readFile(manifest, 'utf8'))
    document.execution.exposure_detectors = [{ id: 'fixture-tool', kind: 'tool_name', tool_name: 'fixture_tool' }]
    await writeFile(manifest, stringify(document))

    await freezeExperiment(manifest, output)
    await runExperiment(manifest, output)

    expect((await decideExperiment(manifest, output)).outcome).toBe('PROMOTE')
  })

  it('boot failure Candidate 触发 hard gate REJECT', async () => {
    const decision = await scenario('candidate-boot-failure')
    expect(decision.outcome).toBe('REJECT')
    expect(decision.triggeredRules).toContain('hard_gate.boot_success')
  })

  it('timeout 归类为 infrastructure failure 并达到 INCONCLUSIVE', async () => {
    const decision = await scenario('candidate-timeout', 30)
    expect(decision.outcome).toBe('INCONCLUSIVE')
    expect(decision.triggeredRules).toContain('evidence.infrastructure_failures')
  })
})
