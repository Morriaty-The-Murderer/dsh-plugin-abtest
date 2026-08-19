import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { canonicalStringify } from './canonical.js'

const ignoredDirectories = new Set(['.git', 'node_modules'])

interface WorkspaceEntry {
  kind: 'file' | 'symlink'
  fingerprint: string
}

export type WorkspaceSnapshot = Readonly<Record<string, WorkspaceEntry>>

export interface WorkspaceDiff {
  schemaVersion: 1
  added: string[]
  modified: string[]
  deleted: string[]
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function snapshotWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const snapshot: Record<string, WorkspaceEntry> = {}

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
      const path = resolve(directory, entry.name)
      const workspacePath = portablePath(root, path)
      const details = await lstat(path)
      if (details.isSymbolicLink()) {
        snapshot[workspacePath] = { kind: 'symlink', fingerprint: hash(await readlink(path)) }
      } else if (details.isDirectory()) {
        await visit(path)
      } else if (details.isFile()) {
        const contents = await readFile(path)
        snapshot[workspacePath] = {
          kind: 'file',
          fingerprint: hash(`${details.mode & 0o111}\0${hash(contents)}`),
        }
      }
    }
  }

  await visit(resolve(root))
  return snapshot
}

export function compareWorkspaceSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff {
  const beforePaths = new Set(Object.keys(before))
  const afterPaths = new Set(Object.keys(after))
  return {
    schemaVersion: 1,
    added: [...afterPaths].filter((path) => !beforePaths.has(path)).sort(),
    modified: [...afterPaths]
      .filter(
        (path) =>
          beforePaths.has(path) &&
          (before[path]?.kind !== after[path]?.kind || before[path]?.fingerprint !== after[path]?.fingerprint),
      )
      .sort(),
    deleted: [...beforePaths].filter((path) => !afterPaths.has(path)).sort(),
  }
}

export async function writeWorkspaceDiff(
  path: string,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): Promise<void> {
  await writeFile(path, `${canonicalStringify(compareWorkspaceSnapshots(before, after))}\n`, { mode: 0o600 })
}
