import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renameProject } from '../../src/identity/rename.js'
import type { ProjectIdentity } from '../../src/identity/schema.js'

const oldIdentity: ProjectIdentity = {
  identityVersion: 1,
  displayName: 'Old Experiment',
  shortName: 'Old Exp',
  repoSlug: 'old-experiment',
  npmScope: null,
  npmName: 'old-experiment',
  cliBin: 'old-exp',
  description: 'Old paired experiment.',
  legacyAliases: { npmPackages: [], cliBins: [], repoSlugs: [] },
}

const newIdentity = {
  ...oldIdentity,
  displayName: 'Harness Pair Lab',
  shortName: 'Pair Lab',
  repoSlug: 'harness-pair-lab',
  npmName: 'harness-pair-lab',
  cliBin: 'hpair',
  description: 'Safe paired plugin experiments.',
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-experiment-rename-'))
  await mkdir(join(root, 'src', 'identity'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, '.github', 'workflows'), { recursive: true })
  await writeFile(join(root, 'project.identity.json'), `${JSON.stringify(oldIdentity, undefined, 2)}\n`)
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: oldIdentity.npmName,
        description: oldIdentity.description,
        bin: { [oldIdentity.cliBin]: './lib/cli/bin.js' },
        scripts: { test: 'vitest run' },
      },
      undefined,
      2,
    )}\n`,
  )
  await writeFile(
    join(root, 'src', 'identity', 'generated.ts'),
    `export const PROJECT_IDENTITY = { displayName: '${oldIdentity.displayName}' }\n`,
  )
  await writeFile(join(root, 'README.md'), `# ${oldIdentity.displayName}\n\nRun \`${oldIdentity.cliBin} init\`.\n`)
  await writeFile(join(root, 'LICENSE'), `Copyright ${oldIdentity.displayName} contributors\n`)
  await writeFile(
    join(root, 'docs', 'usage.md'),
    `Clone ${oldIdentity.repoSlug} and install ${oldIdentity.npmName}. ${oldIdentity.description}\n`,
  )
  await writeFile(
    join(root, '.github', 'workflows', 'ci.yml'),
    `name: ${oldIdentity.shortName}\n# pnpm --filter ${oldIdentity.npmName} test\n`,
  )
  await writeFile(join(root, 'GOAL.md'), `The original goal named ${oldIdentity.displayName}.\n`)
  return root
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files = [
    'project.identity.json',
    'package.json',
    'src/identity/generated.ts',
    'README.md',
    'LICENSE',
    'docs/usage.md',
    '.github/workflows/ci.yml',
    'GOAL.md',
  ]
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, await readFile(join(root, file), 'utf8')])),
  )
}

describe('项目重命名', () => {
  it('dry-run 返回精确变更计划且不写任何文件', async () => {
    const root = await createProject()
    const before = await snapshot(root)

    const report = await renameProject(root, newIdentity, { dryRun: true })

    expect(report.status).toBe('planned')
    expect(report.changedFiles).toEqual([
      '.github/workflows/ci.yml',
      'LICENSE',
      'README.md',
      'docs/usage.md',
      'package.json',
      'project.identity.json',
      'src/identity/generated.ts',
    ])
    expect(await snapshot(root)).toEqual(before)
  })

  it('只更新授权 public surface，并把原始 GOAL 保留为 allowlist 证据', async () => {
    const root = await createProject()

    const report = await renameProject(root, newIdentity, {
      dryRun: false,
      verify: async () => [{ command: 'fixture-check', passed: true }],
    })

    expect(report.status).toBe('applied')
    expect(report.staleOccurrences).toEqual([{ path: 'GOAL.md', line: 1, value: 'Old Experiment', allowed: true }])
    expect(await readFile(join(root, 'README.md'), 'utf8')).toContain('# Harness Pair Lab')
    expect(await readFile(join(root, 'docs', 'usage.md'), 'utf8')).toBe(
      'Clone harness-pair-lab and install harness-pair-lab. Safe paired plugin experiments.\n',
    )
    expect(await readFile(join(root, 'GOAL.md'), 'utf8')).toContain('Old Experiment')
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(packageJson).toMatchObject({
      name: 'harness-pair-lab',
      description: 'Safe paired plugin experiments.',
      bin: { hpair: './lib/cli/bin.js' },
      scripts: { test: 'vitest run' },
    })
  })

  it('验证失败时恢复全部原文件', async () => {
    const root = await createProject()
    const before = await snapshot(root)

    const report = await renameProject(root, newIdentity, {
      dryRun: false,
      verify: async () => [{ command: 'fixture-check', passed: false, detail: 'expected failure' }],
    })

    expect(report.status).toBe('rolled_back')
    expect(await snapshot(root)).toEqual(before)
  })
})
