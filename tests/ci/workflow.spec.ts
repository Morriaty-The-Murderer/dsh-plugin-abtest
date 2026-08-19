import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface WorkflowStep {
  uses?: string
  with?: Record<string, unknown>
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
})
