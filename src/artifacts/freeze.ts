import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { FrozenArtifact, Variant } from '../domain/types.js'
import { hashBytes, hashFile } from './hash.js'
import { type MaterializeContext, materializeArtifact } from './materialize.js'
import { parseArtifactSource, resolveProjectPath } from './source.js'

export interface FreezeContext extends Omit<MaterializeContext, 'cacheRoot'> {
  baseDir: string
  cacheRoot: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function optionalFileHash(path: string | undefined): Promise<string> {
  return path !== undefined && (await exists(path)) ? hashFile(path) : hashBytes('')
}

function bundlePatchPath(materializedPath: string, packageJson: Record<string, unknown>): string | undefined {
  const dsh = packageJson.dsh
  if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh)) return undefined
  const bundle = (dsh as Record<string, unknown>).bundle
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) return undefined
  const patch = (bundle as Record<string, unknown>).patch
  if (typeof patch !== 'string') return undefined
  const resolved = resolveProjectPath(materializedPath, patch)
  return resolved
}

async function dependencyLockPath(materializedPath: string): Promise<string | undefined> {
  for (const filename of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
    const path = join(materializedPath, filename)
    if (await exists(path)) return path
  }
  return undefined
}

export async function freezeVariant(variant: Variant, context: FreezeContext): Promise<FrozenArtifact> {
  const source = parseArtifactSource(variant.source, context.baseDir)
  const materialized = await materializeArtifact(source, context)
  const packagePath = join(materialized.path, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error(`Frozen plugin ${basename(dirname(packagePath))} must declare package name and exact version`)
  }
  const configPath =
    variant.configPath === undefined ? undefined : resolveProjectPath(context.baseDir, variant.configPath)
  return {
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    sourceType: materialized.sourceType,
    ...(materialized.sourceCommit === undefined ? {} : { sourceCommit: materialized.sourceCommit }),
    artifactHash: materialized.hash,
    pluginConfigHash: await optionalFileHash(configPath),
    dependencyLockHash: await optionalFileHash(await dependencyLockPath(materialized.path)),
    dshBundleHash: await optionalFileHash(bundlePatchPath(materialized.path, packageJson)),
    materializedPath: materialized.path,
  }
}
