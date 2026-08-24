import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renameProject } from '../../src/identity/rename.js'
import { scanStaleIdentity } from '../../src/identity/stale-scan.js'
import { runRenameVerification } from '../../src/identity/verification.js'

const sourceRoot = process.cwd()
if (process.env.DISTRIBUTION_PNPM_STORE === undefined) {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const store = spawnSync(pnpm, ['store', 'path'], { cwd: sourceRoot, encoding: 'utf8' })
  if (store.error !== undefined) throw store.error
  if (store.status !== 0) throw new Error(`无法解析 pnpm store：${store.stderr.trim()}`)
  process.env.DISTRIBUTION_PNPM_STORE = store.stdout.trim()
}
const temporaryRoot = await mkdtemp(join(tmpdir(), 'plugin-experiment-rename-e2e-'))
await cp(sourceRoot, temporaryRoot, {
  recursive: true,
  filter: (source) => {
    const relative = source.slice(sourceRoot.length).replace(/^\//, '')
    const first = relative.split('/')[0]
    return ![
      '.git',
      '.idea',
      '.worktrees',
      'coverage',
      'experiments',
      'lib',
      'node_modules',
      'rename-report.json',
    ].includes(first ?? '')
  },
})
await symlink(join(sourceRoot, 'node_modules'), join(temporaryRoot, 'node_modules'), 'junction')

const oldIdentity = JSON.parse(await readFile(join(temporaryRoot, 'project.identity.json'), 'utf8')) as {
  identityVersion: 1
  displayName: string
  shortName: string
  repoSlug: string
  npmScope: string | null
  npmName: string
  cliBin: string
  description: string
  legacyAliases: { npmPackages: string[]; cliBins: string[]; repoSlugs: string[] }
}
const newIdentity = {
  ...oldIdentity,
  displayName: 'Harness Pair Laboratory',
  shortName: 'Pair Laboratory',
  repoSlug: 'harness-pair-laboratory',
  npmName: 'harness-pair-laboratory',
  cliBin: 'hpair-lab',
  description: 'Reproducible paired promotion experiments for harness plugins.',
}
const report = await renameProject(temporaryRoot, newIdentity, {
  dryRun: false,
  verify: runRenameVerification,
})
if (report.status !== 'applied') {
  throw new Error(`临时项目重命名失败：${JSON.stringify(report.verification)}`)
}
const packageJson = JSON.parse(await readFile(join(temporaryRoot, 'package.json'), 'utf8')) as {
  name?: string
  bin?: Record<string, string>
}
if (packageJson.name !== newIdentity.npmName || packageJson.bin?.[newIdentity.cliBin] === undefined) {
  throw new Error('临时项目的 package metadata 或 CLI bin 未更新')
}
const generated = await readFile(join(temporaryRoot, 'src/identity/generated.ts'), 'utf8')
if (!generated.includes(newIdentity.displayName) || !generated.includes(newIdentity.cliBin)) {
  throw new Error('临时项目的生成身份常量未更新')
}
const stale = (await scanStaleIdentity(temporaryRoot, oldIdentity)).filter((occurrence) => !occurrence.allowed)
if (stale.length > 0) throw new Error(`临时项目仍有旧身份：${JSON.stringify(stale)}`)
process.stdout.write(`rename e2e PASS：${temporaryRoot}\n`)
