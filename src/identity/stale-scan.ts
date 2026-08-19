import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { ProjectIdentity } from './schema.js'

const excludedDirectories = new Set(['.git', '.idea', '.worktrees', 'coverage', 'experiments', 'lib', 'node_modules'])
const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const allowedStalePaths = new Set(['GOAL.md'])

export interface StaleOccurrence {
  path: string
  line: number
  value: string
  allowed: boolean
}

export function publicIdentityValues(identity: ProjectIdentity): string[] {
  return [
    identity.displayName,
    identity.shortName,
    identity.repoSlug,
    identity.npmName,
    identity.cliBin,
    identity.description,
  ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index)
}

async function listTextFiles(root: string, directory: string = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listTextFiles(root, path)))
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

export async function scanStaleIdentity(root: string, oldIdentity: ProjectIdentity): Promise<StaleOccurrence[]> {
  const values = publicIdentityValues(oldIdentity).sort((left, right) => right.length - left.length)
  const occurrences: StaleOccurrence[] = []
  for (const path of await listTextFiles(root)) {
    const relativePath = relative(root, path).split(sep).join('/')
    if (relativePath === 'rename-report.json' || relativePath === 'pnpm-lock.yaml') continue
    const lines = (await readFile(path, 'utf8')).split('\n')
    for (const [index, line] of lines.entries()) {
      const claimedRanges: { start: number; end: number }[] = []
      for (const value of values) {
        const ranges: { start: number; end: number }[] = []
        for (let start = line.indexOf(value); start >= 0; start = line.indexOf(value, start + value.length)) {
          ranges.push({ start, end: start + value.length })
        }
        const unclaimed = ranges.filter(
          (range) => !claimedRanges.some((claimed) => range.start < claimed.end && range.end > claimed.start),
        )
        if (unclaimed.length === 0) continue
        claimedRanges.push(...unclaimed)
        occurrences.push({ path: relativePath, line: index + 1, value, allowed: allowedStalePaths.has(relativePath) })
      }
    }
  }
  return occurrences.sort((left, right) => {
    const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    const valueOrder = left.value < right.value ? -1 : left.value > right.value ? 1 : 0
    return pathOrder || left.line - right.line || valueOrder
  })
}
