import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ExperimentManifest } from './schema.js'

export interface ValidationIssue {
  code: 'mutable_github_ref' | 'path_escape' | 'path_missing' | 'path_type' | 'unsupported_dsh_version'
  path: string
  message: string
}

export interface SemanticValidationOptions {
  checkPaths?: boolean
}

function isWithin(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export async function validateManifestSemantics(
  manifest: ExperimentManifest,
  baseDir: string,
  options: SemanticValidationOptions = {},
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  if (manifest.runtime.dsh_version !== '0.1.0-rc.7') {
    issues.push({
      code: 'unsupported_dsh_version',
      path: 'runtime.dsh_version',
      message: 'DSH version must be exactly 0.1.0-rc.7 for this adapter',
    })
  }
  for (const variantName of ['control', 'candidate'] as const) {
    const source = manifest.variants[variantName].source
    if (source.startsWith('github:')) {
      const ref = source.slice(source.lastIndexOf('#') + 1)
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        issues.push({
          code: 'mutable_github_ref',
          path: `variants.${variantName}.source`,
          message: 'GitHub source must resolve to a 40-character commit before execution',
        })
      }
    }
  }

  const paths: { path: string; value: string; type: 'file' | 'directory' }[] = [
    { path: 'runtime.workspace_fixture', value: manifest.runtime.workspace_fixture, type: 'directory' },
    { path: 'suite.cases', value: manifest.suite.cases, type: 'file' },
  ]
  for (const variantName of ['control', 'candidate'] as const) {
    const config = manifest.variants[variantName].config
    if (config !== undefined) paths.push({ path: `variants.${variantName}.config`, value: config, type: 'file' })
  }
  for (const entry of paths) {
    const resolved = resolve(baseDir, entry.value)
    if (isAbsolute(entry.value) || !isWithin(baseDir, resolved)) {
      issues.push({ code: 'path_escape', path: entry.path, message: 'Path must stay within the manifest directory' })
      continue
    }
    if (options.checkPaths === false) continue
    try {
      const details = await stat(resolved)
      const matches = entry.type === 'file' ? details.isFile() : details.isDirectory()
      if (!matches) {
        issues.push({ code: 'path_type', path: entry.path, message: `Expected ${entry.type}: ${entry.value}` })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        issues.push({ code: 'path_missing', path: entry.path, message: `Path does not exist: ${entry.value}` })
      } else {
        throw error
      }
    }
  }
  return issues
}
