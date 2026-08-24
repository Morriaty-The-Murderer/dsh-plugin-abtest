import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface DistributionSmokeResult {
  ok: boolean
  packageName: string
  profile: string
  bundleIncluded: boolean
  patchLoaded: boolean
  pluginName: string
  toolCount: number
}

describe('distribution install smoke', () => {
  it('公开验证命令从 npm tarball 安装到隔离 profile 后可自动挂载并导入工具入口', () => {
    const identity = JSON.parse(readFileSync(resolve('project.identity.json'), 'utf8')) as { npmName: string }
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const result = spawnSync(pnpm, ['test:distribution'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
      timeout: 30_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const output = result.stdout.trim().split('\n').at(-1)
    expect(JSON.parse(output ?? '') as DistributionSmokeResult).toMatchObject({
      ok: true,
      packageName: identity.npmName,
      profile: 'distribution-smoke',
      bundleIncluded: true,
      patchLoaded: true,
      pluginName: 'plugin-experiment-controller',
      toolCount: 7,
    })
  })
})
