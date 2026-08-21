import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import { loadProjectIdentity } from './load.js'
import { type ProjectIdentity, projectIdentitySchema } from './schema.js'
import { type StaleOccurrence, scanStaleIdentity } from './stale-scan.js'
import { renderGeneratedIdentity, renderPackageIdentity } from './sync.js'

const editableRoots = ['docs', '.github', 'examples', 'fixtures']
const editableTopLevel = ['README.md', 'README.zh-CN.md', 'LICENSE', 'cordis.patch.yml']
const editableExtensions = new Set(['.md', '.yaml', '.yml'])

export interface RenameVerification {
  command: string
  passed: boolean
  detail?: string
}

export interface RenameReport {
  reportVersion: 1
  status: 'planned' | 'applied' | 'rolled_back'
  dryRun: boolean
  oldIdentity: ProjectIdentity
  newIdentity: ProjectIdentity
  changedFiles: string[]
  staleOccurrences: StaleOccurrence[]
  verification: RenameVerification[]
  networkMutation: false
  createdAt: string
}

export interface RenameOptions {
  dryRun: boolean
  verify?: (root: string) => Promise<RenameVerification[]>
  reportPath?: string
}

interface PlannedChange {
  path: string
  relativePath: string
  before: string
  after: string
}

function replacements(oldIdentity: ProjectIdentity, newIdentity: ProjectIdentity): [string, string][] {
  const pairs: [string, string][] = [
    [oldIdentity.description, newIdentity.description],
    [oldIdentity.displayName, newIdentity.displayName],
    [oldIdentity.shortName, newIdentity.shortName],
    [oldIdentity.npmName, newIdentity.npmName],
    [oldIdentity.repoSlug, newIdentity.repoSlug],
    [oldIdentity.cliBin, newIdentity.cliBin],
  ]
  const bySource = new Map<string, string>()
  for (const [from, to] of pairs) {
    const existing = bySource.get(from)
    if (existing !== undefined && existing !== to) {
      throw new Error(`Ambiguous rename for public identity value ${JSON.stringify(from)}: ${existing} or ${to}`)
    }
    bySource.set(from, to)
  }
  return [...bySource].filter(([from, to]) => from !== to).sort(([left], [right]) => right.length - left.length)
}

function replacePublicIdentity(text: string, pairs: readonly [string, string][]): string {
  return pairs.reduce((current, [from, to]) => current.replaceAll(from, to), text)
}

async function existingText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function listEditableFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const relativePath of editableTopLevel) {
    if ((await existingText(join(root, relativePath))) !== undefined) files.push(relativePath)
  }
  async function visit(relativeDirectory: string): Promise<void> {
    const directory = join(root, relativeDirectory)
    let entries: Dirent[]
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name)
      if (entry.isDirectory()) await visit(relativePath)
      else if (entry.isFile() && editableExtensions.has(extname(entry.name))) {
        files.push(relativePath.split(sep).join('/'))
      }
    }
  }
  for (const directory of editableRoots) await visit(directory)
  return files
}

async function planChanges(
  root: string,
  oldIdentity: ProjectIdentity,
  newIdentity: ProjectIdentity,
): Promise<PlannedChange[]> {
  const planned = new Map<string, PlannedChange>()
  const add = async (relativePath: string, after: string): Promise<void> => {
    const path = join(root, relativePath)
    const before = (await existingText(path)) ?? ''
    if (before !== after) planned.set(relativePath, { path, relativePath, before, after })
  }
  await add('project.identity.json', `${JSON.stringify(newIdentity, undefined, 2)}\n`)
  const packageText = await readFile(join(root, 'package.json'), 'utf8')
  await add('package.json', renderPackageIdentity(JSON.parse(packageText) as Record<string, unknown>, newIdentity))
  await add('src/identity/generated.ts', renderGeneratedIdentity(newIdentity))
  const pairs = replacements(oldIdentity, newIdentity)
  for (const relativePath of await listEditableFiles(root)) {
    const before = await readFile(join(root, relativePath), 'utf8')
    await add(relativePath, replacePublicIdentity(before, pairs))
  }
  return [...planned.values()].sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  )
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.rename-tmp`
  await writeFile(temporaryPath, content)
  await rename(temporaryPath, path)
}

async function applyChanges(changes: readonly PlannedChange[], side: 'before' | 'after'): Promise<void> {
  for (const change of changes) await writeAtomic(change.path, change[side])
}

export async function renameProject(
  root: string,
  requestedIdentity: ProjectIdentity,
  options: RenameOptions,
): Promise<RenameReport> {
  const oldIdentity = await loadProjectIdentity(root)
  const newIdentity = projectIdentitySchema.parse(requestedIdentity)
  const changes = await planChanges(root, oldIdentity, newIdentity)
  const base = {
    reportVersion: 1 as const,
    dryRun: options.dryRun,
    oldIdentity,
    newIdentity,
    changedFiles: changes.map((change) => change.relativePath),
    networkMutation: false as const,
    createdAt: new Date().toISOString(),
  }
  if (options.dryRun) {
    return { ...base, status: 'planned', staleOccurrences: [], verification: [] }
  }

  await applyChanges(changes, 'after')
  let verification: RenameVerification[] = []
  let status: RenameReport['status'] = 'applied'
  try {
    verification = options.verify === undefined ? [] : await options.verify(root)
    if (verification.some((result) => !result.passed)) {
      await applyChanges(changes, 'before')
      status = 'rolled_back'
    }
  } catch (error) {
    await applyChanges(changes, 'before')
    status = 'rolled_back'
    verification = [{ command: 'verification', passed: false, detail: String(error) }]
  }
  const staleOccurrences = await scanStaleIdentity(root, oldIdentity)
  const report: RenameReport = { ...base, status, staleOccurrences, verification }
  const reportPath = options.reportPath ?? join(root, 'rename-report.json')
  await writeAtomic(reportPath, `${JSON.stringify(report, undefined, 2)}\n`)
  return report
}

export function projectRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}
