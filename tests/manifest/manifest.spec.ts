import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadManifest, parseManifest } from '../../src/manifest/load.js'
import { validateManifestSemantics } from '../../src/manifest/validate.js'

const validManifest = {
  schema_version: 1,
  experiment: {
    id: 'memory-plugin-v2',
    name: 'Memory Plugin V1 versus V2',
    hypothesis: 'Candidate improves factual recall.',
  },
  target: { plugin: 'dsh-memory-plugin' },
  variants: {
    control: { source: 'npm:dsh-memory-plugin@1.3.2', config: 'variants/control.yml' },
    candidate: { source: 'github:owner/dsh-memory-plugin#0123456789abcdef0123456789abcdef01234567' },
  },
  runtime: {
    dsh_version: '0.1.0-rc.7',
    profile: 'headless',
    model: { provider: 'mock', name: 'scripted-model', parameters: { temperature: 0 } },
    workspace_fixture: 'fixtures/workspace',
    sandbox: 'isolated-workspace',
  },
  suite: { cases: 'evals/cases.yml', repetitions: 3 },
  execution: {
    order: 'counterbalanced',
    concurrency: 2,
    timeout_ms: 600_000,
    require_exposure: true,
  },
  decision: {
    minimum_valid_pairs: 6,
    hard_gates: {
      boot_success: true,
      activation_success: true,
      critical_security_violations: 0,
      critical_case_regressions: 0,
    },
    primary: {
      metric: 'task_success_rate',
      policy: 'superiority',
      minimum_absolute_lift: 0.03,
    },
    guardrails: {
      median_token_increase_pct: 15,
      p95_latency_increase_pct: 20,
      tool_error_rate_increase_pp: 1,
    },
  },
}

describe('实验 manifest', () => {
  it('解析严格的 schema v1', () => {
    expect(parseManifest(validManifest)).toEqual(validManifest)
  })

  it('拒绝 suite 中未保留的字段', () => {
    expect(() => parseManifest({ ...validManifest, suite: { ...validManifest.suite, mystery: 1 } })).toThrow(
      /unrecognized key.*mystery/i,
    )
  })

  it('把 mutable GitHub ref 报为冻结前语义错误', async () => {
    const manifest = parseManifest({
      ...validManifest,
      variants: {
        ...validManifest.variants,
        candidate: { source: 'github:owner/dsh-memory-plugin#main' },
      },
    })

    const issues = await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })

    expect(issues).toContainEqual({
      code: 'mutable_github_ref',
      path: 'variants.candidate.source',
      message: 'GitHub source must resolve to a 40-character commit before execution',
    })
  })

  it('拒绝逃出 manifest 根目录的 fixture 路径', async () => {
    const manifest = parseManifest({
      ...validManifest,
      runtime: { ...validManifest.runtime, workspace_fixture: '../outside' },
    })

    const issues = await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })

    expect(issues.some((issue) => issue.code === 'path_escape' && issue.path === 'runtime.workspace_fixture')).toBe(
      true,
    )
  })

  it('拒绝与实际适配器不一致的 DSH 版本', async () => {
    const manifest = parseManifest({
      ...validManifest,
      runtime: { ...validManifest.runtime, dsh_version: '0.1.0-rc.6' },
    })

    const issues = await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })

    expect(issues).toContainEqual({
      code: 'unsupported_dsh_version',
      path: 'runtime.dsh_version',
      message: 'DSH version must be exactly 0.1.0-rc.7 for this adapter',
    })
  })

  it('从 YAML 文件加载并保留严格类型', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-experiment-manifest-'))
    await mkdir(join(root, 'variants'), { recursive: true })
    await writeFile(join(root, 'experiment.yml'), `schema_version: 1\nexperiment:\n  id: demo\n`)

    await expect(loadManifest(join(root, 'experiment.yml'))).rejects.toThrow(/experiment.*name/i)
  })
})
