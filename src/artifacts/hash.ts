import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const ignoredDirectories = new Set(['.git', 'node_modules'])

export function hashBytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function hashFile(path: string): Promise<string> {
  return hashBytes(await readFile(path))
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function isWithin(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export async function hashDirectory(root: string): Promise<string> {
  const digest = createHash('sha256')

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
      const path = resolve(directory, entry.name)
      const artifactPath = portablePath(root, path)
      const details = await lstat(path)
      if (details.isSymbolicLink()) {
        const target = await readlink(path)
        const resolvedTarget = isAbsolute(target) ? target : resolve(dirname(path), target)
        if (!isWithin(root, resolvedTarget)) {
          throw new Error(`Symbolic link ${artifactPath} escapes the artifact root`)
        }
        digest.update(`link\0${artifactPath}\0${target}\0`)
      } else if (details.isDirectory()) {
        digest.update(`directory\0${artifactPath}\0`)
        await visit(path)
      } else if (details.isFile()) {
        digest.update(`file\0${artifactPath}\0${details.mode & 0o111}\0${details.size}\0`)
        digest.update(await readFile(path))
        digest.update('\0')
      }
    }
  }

  await visit(resolve(root))
  return digest.digest('hex')
}
