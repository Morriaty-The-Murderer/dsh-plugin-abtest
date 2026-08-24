import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const PAID_RUN_INPUT = '$' + '{{ inputs.confirm_paid_run }}'
const GITHUB_REF = '$' + '{{ github.ref }}'
const GITHUB_REF_TYPE = '$' + '{{ github.ref_type }}'
const DEEPSEEK_SECRET = '$' + '{{ secrets.DEEPSEEK_API_KEY }}'
const PROTECTED_VARIABLE = '$' + '{{ vars.LIVE_MODEL_CI_PROTECTED }}'
const RUNNER_TEMP_SUMMARY = '$' + '{{ runner.temp }}/live-model-summary/result.json'
const RELEASE_VERSION = '$' + '{{ inputs.version }}'
const RELEASE_CONFIRMATION = '$' + '{{ inputs.confirm_release }}'
const NPM_TOKEN = '$' + '{{ secrets.NPM_TOKEN }}'
const RELEASE_TARBALL = '$' + '{{ steps.package.outputs.tarball }}'
const RELEASE_PROTECTED_VARIABLE = '$' + '{{ vars.NPM_RELEASE_PROTECTED }}'

interface WorkflowStep {
  env?: Record<string, string>
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowDocument {
  on: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: { group: string; 'cancel-in-progress': boolean }
  jobs: Record<
    string,
    {
      needs?: string
      environment?: string
      permissions?: Record<string, string>
      'timeout-minutes'?: number
      steps: WorkflowStep[]
    }
  >
}

async function readWorkflow(path: string): Promise<WorkflowDocument> {
  const content = await readFile(resolve(path), 'utf8').catch(() => '')
  expect(content, `${path} must exist`).not.toBe('')
  return parse(content) as WorkflowDocument
}

describe('GitHub Actions workflow', () => {
  it('在 setup-node 初始化 pnpm cache 前提供 pnpm 可执行文件', async () => {
    const workflow = parse(await readFile(resolve('.github/workflows/ci.yml'), 'utf8')) as {
      jobs: { verify: { steps: WorkflowStep[] } }
    }
    const steps = workflow.jobs.verify.steps
    const pnpmSetupIndex = steps.findIndex((step) => step.uses === 'pnpm/action-setup@v4')
    const nodeSetupIndex = steps.findIndex((step) => step.uses === 'actions/setup-node@v4')

    expect(
      pnpmSetupIndex,
      'pnpm/action-setup must provision pnpm for setup-node cache discovery',
    ).toBeGreaterThanOrEqual(0)
    expect(nodeSetupIndex).toBeGreaterThan(pnpmSetupIndex)
    expect(steps[nodeSetupIndex]?.with?.cache).toBe('pnpm')
  })

  it('真实模型流程只能由明确确认付费调用的人工事件触发', async () => {
    const workflow = await readWorkflow('.github/workflows/live-model-smoke.yml')

    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.on.workflow_dispatch).toEqual({
      inputs: {
        confirm_paid_run: {
          description: '确认本次运行会调用付费模型',
          required: true,
          default: false,
          type: 'boolean',
        },
      },
    })
    const confirmationStep = workflow.jobs.authorize?.steps.find((step) => step.name === '确认运行边界')
    expect(confirmationStep?.env?.PAID_RUN_CONFIRMED).toBe(PAID_RUN_INPUT)
    expect(confirmationStep?.run).toContain('test "$PAID_RUN_CONFIRMED" = "true"')
  })

  it('只允许 master 进入受保护环境且工作流没有写权限', async () => {
    const workflow = await readWorkflow('.github/workflows/live-model-smoke.yml')

    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toEqual({ group: 'live-model-smoke', 'cancel-in-progress': false })
    const authorization = workflow.jobs.authorize?.steps.find((step) => step.name === '确认运行边界')
    expect(authorization?.env).toMatchObject({
      DISPATCHED_REF: GITHUB_REF,
      DISPATCHED_REF_TYPE: GITHUB_REF_TYPE,
    })
    expect(authorization?.run).toContain('test "$DISPATCHED_REF_TYPE" = "branch"')
    expect(authorization?.run).toContain('test "$DISPATCHED_REF" = "refs/heads/master"')
    expect(workflow.jobs['live-smoke']).toMatchObject({
      needs: 'authorize',
      environment: 'live-model',
      'timeout-minutes': 60,
    })
  })

  it('只向付费步骤注入密钥且只上传脱敏摘要', async () => {
    const workflow = await readWorkflow('.github/workflows/live-model-smoke.yml')
    const steps = workflow.jobs['live-smoke']?.steps ?? []
    const secretSteps = steps.filter((step) => JSON.stringify(step).includes('secrets.DEEPSEEK_API_KEY'))

    expect(secretSteps).toHaveLength(1)
    expect(secretSteps[0]).toMatchObject({
      name: '运行真实模型案例并生成脱敏摘要',
      env: {
        DEEPSEEK_API_KEY: DEEPSEEK_SECRET,
        LIVE_MODEL_CI_PROTECTED: PROTECTED_VARIABLE,
      },
    })
    expect(secretSteps[0]?.run).toContain('test "$LIVE_MODEL_CI_PROTECTED" = "true"')
    expect(secretSteps[0]?.run).toContain('LIVE_EVIDENCE_ROOT="$(mktemp -d)"')
    expect(secretSteps[0]?.run).toContain('pnpm case-study:summarize')
    expect(secretSteps[0]?.run).toContain('$RUNNER_TEMP/live-model-summary/result.json')

    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
    expect(upload?.with).toEqual({
      name: 'live-model-summary',
      path: RUNNER_TEMP_SUMMARY,
      'if-no-files-found': 'error',
      'retention-days': 7,
    })
  })

  it('持有密钥的 job 将所有 action 固定到完整 commit SHA', async () => {
    const workflow = await readWorkflow('.github/workflows/live-model-smoke.yml')
    const actions = (workflow.jobs['live-smoke']?.steps ?? []).flatMap((step) =>
      step.uses === undefined ? [] : [step.uses],
    )

    expect(actions).toEqual([
      'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
      'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1',
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
      'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    ])
  })

  it('默认 CI 在构建后验证可分发制品且不执行远端发布', async () => {
    const workflow = await readWorkflow('.github/workflows/ci.yml')
    const commands = workflow.jobs.verify?.steps.flatMap((step) => (step.run === undefined ? [] : [step.run])) ?? []
    const buildIndex = commands.indexOf('pnpm build')
    const distributionIndex = commands.indexOf('pnpm test:distribution')
    const packIndex = commands.findIndex((command) =>
      command.includes('pnpm pack --pack-destination "$RUNNER_TEMP/package-audit"'),
    )

    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(distributionIndex).toBeGreaterThan(buildIndex)
    expect(packIndex).toBeGreaterThan(distributionIndex)
    expect(commands).not.toContain('pnpm pack --dry-run')
    expect(commands.join('\n')).not.toMatch(/(?:npm|pnpm) publish|git push|gh release create/)
  })

  it('npm 发布只能由 master 上精确确认版本的人工事件进入受保护环境', async () => {
    const workflow = await readWorkflow('.github/workflows/npm-release.yml')

    expect(workflow.on).toEqual({
      workflow_dispatch: {
        inputs: {
          version: {
            description: '输入与 package.json 完全一致的发布版本',
            required: true,
            type: 'string',
          },
          confirm_release: {
            description: '输入 publish-<version> 确认公开发布',
            required: true,
            type: 'string',
          },
        },
      },
    })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toEqual({ group: 'npm-release', 'cancel-in-progress': false })

    const authorization = workflow.jobs.authorize?.steps.find((step) => step.name === '确认发布边界')
    expect(authorization?.env).toMatchObject({
      REQUESTED_VERSION: RELEASE_VERSION,
      RELEASE_CONFIRMATION,
      DISPATCHED_REF: GITHUB_REF,
      DISPATCHED_REF_TYPE: GITHUB_REF_TYPE,
    })
    expect(authorization?.run).toContain('test "$DISPATCHED_REF_TYPE" = "branch"')
    expect(authorization?.run).toContain('test "$DISPATCHED_REF" = "refs/heads/master"')
    expect(authorization?.run).toContain('test "$RELEASE_CONFIRMATION" = "publish-$REQUESTED_VERSION"')
    expect(workflow.jobs.publish).toMatchObject({
      needs: 'authorize',
      environment: 'npm-release',
      permissions: { contents: 'read', 'id-token': 'write' },
      'timeout-minutes': 30,
    })
    const protection = workflow.jobs.publish?.steps.find((step) => step.name === '确认受保护环境')
    expect(protection?.env).toEqual({ NPM_RELEASE_PROTECTED: RELEASE_PROTECTED_VARIABLE })
    expect(protection?.run).toContain('test "$NPM_RELEASE_PROTECTED" = "true"')
  })

  it('发布 job 固定 action 且只向 npm publish 注入凭证并发布已审计 tarball', async () => {
    const workflow = await readWorkflow('.github/workflows/npm-release.yml')
    const steps = workflow.jobs.publish?.steps ?? []
    const actions = steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]))

    expect(actions).toEqual([
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
    ])
    const secretSteps = steps.filter((step) => JSON.stringify(step).includes('secrets.NPM_TOKEN'))
    expect(secretSteps).toHaveLength(1)
    expect(secretSteps[0]).toMatchObject({
      name: '发布已审计 tarball',
      env: { NODE_AUTH_TOKEN: NPM_TOKEN },
    })
    expect(secretSteps[0]?.run).toContain('test -n "$NODE_AUTH_TOKEN"')
    expect(secretSteps[0]?.run).toContain(
      `npm publish "${RELEASE_TARBALL}" --access public --tag latest --provenance --registry=https://registry.npmjs.org/`,
    )

    const packageStep = steps.find((step) => step.name === '打包并记录制品')
    expect(packageStep?.env).toBeUndefined()
    expect(packageStep?.run).toContain('pnpm pack --pack-destination "$RELEASE_DIR"')
    expect(packageStep?.run).toContain('echo "tarball=$TARBALL" >> "$GITHUB_OUTPUT"')
    expect(packageStep?.run).toContain('shasum -a 256 "$TARBALL"')
  })
})
