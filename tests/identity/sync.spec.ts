import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { synchronizeIdentity } from '../../src/identity/sync.js'

const identity = {
  identityVersion: 1,
  displayName: 'Harness Pair Lab',
  shortName: 'Pair Lab',
  repoSlug: 'harness-pair-lab',
  npmScope: null,
  npmName: 'harness-pair-lab',
  cliBin: 'hpair',
  description: 'Safe paired plugin experiments.',
  legacyAliases: { npmPackages: [], cliBins: [], repoSlugs: [] },
}

async function createDriftedProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-experiment-sync-'))
  await mkdir(join(root, 'src', 'identity'), { recursive: true })
  await writeFile(join(root, 'project.identity.json'), `${JSON.stringify(identity, undefined, 2)}\n`)
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'old-name', description: 'old', bin: { old: './lib/cli/bin.js' }, scripts: {} }, undefined, 2)}\n`,
  )
  await writeFile(
    join(root, 'src', 'identity', 'generated.ts'),
    "export const PROJECT_IDENTITY = { displayName: 'Old' }\n",
  )
  return root
}

describe('身份同步', () => {
  it('check 模式报告漂移但不写文件', async () => {
    const root = await createDriftedProject()
    const packagePath = join(root, 'package.json')
    const before = await readFile(packagePath, 'utf8')

    const result = await synchronizeIdentity(root, 'check')

    expect(result.changedFiles).toEqual(['package.json', 'src/identity/generated.ts'])
    expect(await readFile(packagePath, 'utf8')).toBe(before)
  })

  it('write 模式同步 package metadata、CLI bin 和生成常量且保持其他字段', async () => {
    const root = await createDriftedProject()

    await synchronizeIdentity(root, 'write')

    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(packageJson).toMatchObject({
      name: 'harness-pair-lab',
      description: 'Safe paired plugin experiments.',
      bin: { hpair: './lib/cli/bin.js' },
      scripts: {},
    })
    expect(await readFile(join(root, 'src', 'identity', 'generated.ts'), 'utf8')).toContain(
      "displayName: 'Harness Pair Lab'",
    )
    await expect(synchronizeIdentity(root, 'check')).resolves.toEqual({ changedFiles: [] })
  })
})
