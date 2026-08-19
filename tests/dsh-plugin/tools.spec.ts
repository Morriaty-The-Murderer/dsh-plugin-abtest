import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse, stringify } from 'yaml'
import { initProject } from '../../src/cli/workflow.js'
import { createToolDefinitions } from '../../src/dsh-plugin/tools.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('DSH plugin tools', () => {
  it('注册七个受限工具且 schema 不暴露任意命令、环境或 profile mutation', () => {
    const tools = createToolDefinitions({
      init: vi.fn(),
      validate: vi.fn(),
      run: vi.fn(),
      status: vi.fn(),
      compare: vi.fn(),
      report: vi.fn(),
      decision: vi.fn(),
    })

    expect(tools.map((tool) => tool.name)).toEqual([
      'plugin_experiment_init',
      'plugin_experiment_validate',
      'plugin_experiment_run',
      'plugin_experiment_status',
      'plugin_experiment_compare',
      'plugin_experiment_report',
      'plugin_experiment_decision',
    ])
    const schemas = JSON.stringify(tools.map((tool) => tool.parameters))
    expect(schemas).not.toMatch(/shell|command|executable|environment|env_map|profile_mutation/i)
    expect(tools.every((tool) => tool.parameters.additionalProperties === false)).toBe(true)
  })

  it('工具执行只委托 core operation', async () => {
    const validate = vi.fn(async () => ({ ok: true }))
    const tools = createToolDefinitions({
      init: vi.fn(),
      validate,
      run: vi.fn(),
      status: vi.fn(),
      compare: vi.fn(),
      report: vi.fn(),
      decision: vi.fn(),
    })
    const tool = tools.find((candidate) => candidate.name === 'plugin_experiment_validate')
    await tool?.execute({ manifest: '/safe/experiment.yml', output: '/safe/output' })

    expect(validate).toHaveBeenCalledWith('/safe/experiment.yml', '/safe/output')
  })

  it('模型侧 run 在启动任何进程前拒绝 command_test 断言', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-experiment-tool-safety-'))
    roots.push(root)
    const project = join(root, 'project')
    const { manifest } = await initProject(project)
    const casesPath = join(project, 'evals', 'cases.yml')
    const cases = parse(await readFile(casesPath, 'utf8'))
    cases.cases[0].assertions.push({
      id: 'unsafe-command',
      kind: 'command_test',
      critical: true,
      config: { executable: '/usr/bin/touch', args: [join(root, 'must-not-exist')] },
    })
    await writeFile(casesPath, stringify(cases))

    const run = createToolDefinitions().find((tool) => tool.name === 'plugin_experiment_run')

    await expect(run?.execute({ manifest, output: join(root, 'evidence') })).rejects.toThrow(
      /command_test.*not allowed/i,
    )
    await expect(readFile(join(root, 'must-not-exist'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
