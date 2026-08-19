import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalHash } from '../../src/runtime/canonical.js'
import { createRuntimeFixture } from '../../src/runtime/fixture.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('RuntimeFixture', () => {
  it('冻结 workspace、sandbox policy 与排序后的环境变量名', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-fixture-'))
    temporaryRoots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'input.txt'), 'stable fixture')

    const fixture = await createRuntimeFixture({
      workspacePath: workspace,
      sandboxPolicy: 'isolated-workspace',
      environmentAllowlist: ['TZ', 'LANG', 'TZ'],
    })

    expect(fixture.workspacePath).toBe(workspace)
    expect(fixture.workspaceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(fixture.sandboxPolicyHash).toBe(canonicalHash('isolated-workspace'))
    expect(fixture.environmentAllowlist).toEqual(['LANG', 'TZ'])
    expect(fixture.environmentAllowlistHash).toBe(canonicalHash(['LANG', 'TZ']))
  })

  it('只记录环境变量名，不读取或持久化原始 secret 值', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-fixture-secret-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'input.txt'), 'fixture')
    const sentinel = 'SENTINEL_SECRET_VALUE'
    process.env.TEST_PROVIDER_TOKEN = sentinel
    try {
      const fixture = await createRuntimeFixture({
        workspacePath: root,
        sandboxPolicy: 'isolated-workspace',
        environmentAllowlist: ['TEST_PROVIDER_TOKEN'],
      })

      expect(JSON.stringify(fixture)).not.toContain(sentinel)
      expect(fixture.environmentAllowlist).toEqual(['TEST_PROVIDER_TOKEN'])
    } finally {
      delete process.env.TEST_PROVIDER_TOKEN
    }
  })

  it('拒绝无法安全表达的环境变量名', async () => {
    const root = await mkdtemp(join(tmpdir(), 'runtime-fixture-invalid-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'input.txt'), 'fixture')

    await expect(
      createRuntimeFixture({
        workspacePath: root,
        sandboxPolicy: 'isolated-workspace',
        environmentAllowlist: ['TOKEN=raw-value'],
      }),
    ).rejects.toThrow(/environment variable name/i)
  })
})
