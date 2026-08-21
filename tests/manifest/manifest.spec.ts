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
    minimum_unique_cases: 2,
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

  it('旧 schema v1 manifest 缺少 unique-case 门槛时采用保守默认值', () => {
    const { minimum_unique_cases: _minimumUniqueCases, ...legacyDecision } = validManifest.decision
    const parsed = parseManifest({ ...validManifest, decision: legacyDecision })

    expect(parsed.decision.minimum_unique_cases).toBe(2)
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

  it('workspace file change detector 只接受 workspace 内的便携相对路径', () => {
    const withDetector = (path: string) => ({
      ...validManifest,
      execution: {
        ...validManifest.execution,
        exposure_detectors: [{ id: 'cut-log', kind: 'workspace_file_change', path, change: 'added' }],
      },
    })

    expect(parseManifest(withDetector('toolshrink.log')).execution.exposure_detectors).toEqual([
      { id: 'cut-log', kind: 'workspace_file_change', path: 'toolshrink.log', change: 'added' },
    ])
    expect(() => parseManifest(withDetector('../outside.log'))).toThrow(/exposure_detectors/i)
    expect(() => parseManifest(withDetector('/absolute.log'))).toThrow(/exposure_detectors/i)
    expect(() => parseManifest(withDetector('windows\\path.log'))).toThrow(/exposure_detectors/i)

    expect(
      parseManifest({
        ...validManifest,
        execution: {
          ...validManifest.execution,
          exposure_detectors: [
            {
              id: 'spill-created',
              kind: 'workspace_file_change',
              path: '.toolshrink-spill/',
              change: 'added',
              match: 'prefix',
            },
          ],
        },
      }).execution.exposure_detectors,
    ).toEqual([
      {
        id: 'spill-created',
        kind: 'workspace_file_change',
        path: '.toolshrink-spill/',
        change: 'added',
        match: 'prefix',
      },
    ])
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

  it('真实 DeepSeek 运行只接受会实际写入 profile 的固定模型参数', async () => {
    const allowed = parseManifest({
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'deepseek-official',
          name: 'deepseek-v4-flash',
          parameters: { reasoningEffort: 'off', maxTokens: 2_048 },
        },
      },
    })
    expect(await validateManifestSemantics(allowed, '/tmp/manifest-fixture', { checkPaths: false })).toEqual([])

    const unsupported = parseManifest({
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'deepseek-official',
          name: 'deepseek-v4-flash',
          parameters: { temperature: 0 },
        },
      },
    })
    expect(await validateManifestSemantics(unsupported, '/tmp/manifest-fixture', { checkPaths: false })).toContainEqual(
      {
        code: 'unsupported_model_parameter',
        path: 'runtime.model.parameters.temperature',
        message: 'Model parameter is not applied by the deepseek-official profile adapter',
      },
    )
  })

  it('OpenAI-compatible 运行接受 host、凭据引用和固定模型容量', async () => {
    const manifest = parseManifest({
      ...validManifest,
      extensions: { environment_allowlist: ['GATEWAY_API_KEY', 'LANG', 'TZ'] },
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'openai-compatible',
          name: 'gateway-model-v1',
          parameters: {
            host: 'https://gateway.example/v1',
            apiKeyEnv: 'GATEWAY_API_KEY',
            contextWindow: 128_000,
            maxTokens: 2_048,
          },
        },
      },
    })

    expect(await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })).toEqual([])
  })

  it('OpenAI-compatible 凭据引用必须显式进入环境 allowlist', async () => {
    const manifest = parseManifest({
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'openai-compatible',
          name: 'gateway-model-v1',
          parameters: {
            host: 'https://gateway.example/v1',
            apiKeyEnv: 'GATEWAY_API_KEY',
          },
        },
      },
    })

    expect(await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })).toContainEqual({
      code: 'credential_not_allowlisted',
      path: 'extensions.environment_allowlist',
      message: 'GATEWAY_API_KEY must be explicitly named in extensions.environment_allowlist',
    })
  })

  it('OpenAI-compatible 运行要求完整连接参数和正整数容量', async () => {
    const manifest = parseManifest({
      ...validManifest,
      extensions: { environment_allowlist: ['not-an-env-name'] },
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'openai-compatible',
          name: 'gateway-model-v1',
          parameters: {
            apiKeyEnv: 'not-an-env-name',
            contextWindow: 0,
            maxTokens: 1.5,
          },
        },
      },
    })

    expect(await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })).toEqual(
      expect.arrayContaining([
        {
          code: 'invalid_model_parameter',
          path: 'runtime.model.parameters.host',
          message: 'host is required for the openai-compatible provider',
        },
        {
          code: 'invalid_model_parameter',
          path: 'runtime.model.parameters.apiKeyEnv',
          message: 'apiKeyEnv must be an environment variable name',
        },
        {
          code: 'invalid_model_parameter',
          path: 'runtime.model.parameters.contextWindow',
          message: 'contextWindow must be a positive safe integer',
        },
        {
          code: 'invalid_model_parameter',
          path: 'runtime.model.parameters.maxTokens',
          message: 'maxTokens must be a positive safe integer',
        },
      ]),
    )

    const withoutCredentialReference = parseManifest({
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'openai-compatible',
          name: 'gateway-model-v1',
          parameters: { host: 'https://gateway.example/v1' },
        },
      },
    })
    expect(
      await validateManifestSemantics(withoutCredentialReference, '/tmp/manifest-fixture', { checkPaths: false }),
    ).toContainEqual({
      code: 'invalid_model_parameter',
      path: 'runtime.model.parameters.apiKeyEnv',
      message: 'apiKeyEnv is required for the openai-compatible provider',
    })
  })

  it('OpenAI-compatible 运行拒绝字面 API key 和不可用 host', async () => {
    const manifest = parseManifest({
      ...validManifest,
      runtime: {
        ...validManifest.runtime,
        model: {
          provider: 'openai-compatible',
          name: 'gateway-model-v1',
          parameters: {
            host: 'file:///tmp/provider',
            apiKeyEnv: 'GATEWAY_API_KEY',
            apiKey: 'secret-must-not-enter-the-manifest',
          },
        },
      },
    })

    expect(await validateManifestSemantics(manifest, '/tmp/manifest-fixture', { checkPaths: false })).toEqual(
      expect.arrayContaining([
        {
          code: 'invalid_model_parameter',
          path: 'runtime.model.parameters.host',
          message: 'host must be an absolute http or https URL without credentials, query, or fragment',
        },
        {
          code: 'unsupported_model_parameter',
          path: 'runtime.model.parameters.apiKey',
          message: 'Literal API keys are forbidden; use apiKeyEnv and the environment allowlist',
        },
      ]),
    )
  })

  it('从 YAML 文件加载并保留严格类型', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-experiment-manifest-'))
    await mkdir(join(root, 'variants'), { recursive: true })
    await writeFile(join(root, 'experiment.yml'), `schema_version: 1\nexperiment:\n  id: demo\n`)

    await expect(loadManifest(join(root, 'experiment.yml'))).rejects.toThrow(/experiment.*name/i)
  })
})
