import { isAbsolute, relative, resolve } from 'node:path'

export type ParsedArtifactSource =
  | { type: 'local-directory'; path: string }
  | { type: 'local-tarball'; path: string }
  | { type: 'npm'; packageSpec: string }
  | { type: 'github'; repository: string; commit: string }

function resolveContainedPath(baseDir: string, configured: string): string {
  if (isAbsolute(configured)) throw new Error(`Artifact path must be relative to the manifest directory: ${configured}`)
  const resolved = resolve(baseDir, configured)
  const child = relative(resolve(baseDir), resolved)
  if (child.startsWith('..') || isAbsolute(child)) {
    throw new Error(`Artifact path escapes the manifest directory: ${configured}`)
  }
  return resolved
}

export function parseArtifactSource(source: string, baseDir: string): ParsedArtifactSource {
  if (source.startsWith('local:')) {
    return { type: 'local-directory', path: resolveContainedPath(baseDir, source.slice('local:'.length)) }
  }
  if (source.startsWith('tarball:')) {
    return { type: 'local-tarball', path: resolveContainedPath(baseDir, source.slice('tarball:'.length)) }
  }
  if (source.startsWith('npm:')) {
    const packageSpec = source.slice('npm:'.length)
    if (!/(?:^|@)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageSpec)) {
      throw new Error(`npm source must use an exact version: ${source}`)
    }
    return { type: 'npm', packageSpec }
  }
  if (source.startsWith('github:')) {
    const value = source.slice('github:'.length)
    const separator = value.lastIndexOf('#')
    const repository = value.slice(0, separator)
    const commit = value.slice(separator + 1)
    if (!/^[^/]+\/[^/#]+$/.test(repository) || !/^[a-f0-9]{40}$/i.test(commit)) {
      throw new Error(`GitHub source must use owner/repository#<40-character-commit>: ${source}`)
    }
    return { type: 'github', repository, commit: commit.toLowerCase() }
  }
  throw new Error(`Unsupported artifact source: ${source}`)
}

export function resolveProjectPath(baseDir: string, configured: string): string {
  return resolveContainedPath(baseDir, configured)
}
