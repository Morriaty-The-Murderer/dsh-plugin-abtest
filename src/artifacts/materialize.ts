import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { x as extractTar } from 'tar'
import { hashDirectory } from './hash.js'
import type { ParsedArtifactSource } from './source.js'

export interface ExternalCommand {
  bin: string
  prefixArgs?: string[]
}

export interface MaterializeContext {
  cacheRoot: string
  packageManagerCommand?: ExternalCommand
  gitCommand?: ExternalCommand
  githubBaseUrl?: string
}

export interface MaterializedArtifact {
  path: string
  hash: string
  sourceType: ParsedArtifactSource['type']
  sourceCommit?: string
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

async function promoteToCache(stagingArtifact: string, target: string, expectedHash: string): Promise<void> {
  try {
    await rename(stagingArtifact, target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
    if (!(await exists(target)) || (await hashDirectory(target)) !== expectedHash) throw error
  }
}

function run(command: ExternalCommand, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.bin, [...(command.prefixArgs ?? []), ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let diagnostic = ''
    const append = (chunk: Buffer): void => {
      diagnostic += chunk.toString()
      if (diagnostic.length > 8_000) diagnostic = diagnostic.slice(-8_000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command.bin} failed (${signal ?? `exit ${String(code)}`}): ${diagnostic.trim()}`))
    })
  })
}

async function extractPackedTarball(tarball: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  await extractTar({
    cwd: destination,
    file: tarball,
    gzip: true,
    preservePaths: false,
    strict: true,
    strip: 1,
  })
}

async function prepareSource(
  source: ParsedArtifactSource,
  stagingArtifact: string,
  stagingRoot: string,
  context: MaterializeContext,
) {
  switch (source.type) {
    case 'local-directory': {
      const details = await stat(source.path)
      if (!details.isDirectory()) throw new Error(`Local artifact source is not a directory: ${source.path}`)
      await cp(source.path, stagingArtifact, { recursive: true, verbatimSymlinks: true })
      return {}
    }
    case 'local-tarball': {
      const details = await stat(source.path)
      if (!details.isFile()) throw new Error(`Local artifact source is not a tarball: ${source.path}`)
      await extractPackedTarball(source.path, stagingArtifact)
      return {}
    }
    case 'npm': {
      const command = context.packageManagerCommand ?? { bin: 'pnpm' }
      await run(command, ['pack', source.packageSpec, '--pack-destination', stagingRoot], stagingRoot)
      const tarballs = (await readdir(stagingRoot)).filter((name) => name.endsWith('.tgz'))
      if (tarballs.length !== 1) {
        throw new Error(`pnpm pack must produce exactly one tarball for ${source.packageSpec}`)
      }
      await extractPackedTarball(join(stagingRoot, tarballs[0] as string), stagingArtifact)
      return {}
    }
    case 'github': {
      const command = context.gitCommand ?? { bin: 'git' }
      const baseUrl = (context.githubBaseUrl ?? 'https://github.com').replace(/\/$/, '')
      await run(
        command,
        ['clone', '--no-checkout', '--filter=blob:none', `${baseUrl}/${source.repository}.git`, stagingArtifact],
        stagingRoot,
      )
      await run(command, ['-C', stagingArtifact, 'checkout', '--detach', source.commit], stagingRoot)
      await rm(join(stagingArtifact, '.git'), { recursive: true, force: true })
      return { sourceCommit: source.commit }
    }
  }
}

export async function materializeArtifact(
  source: ParsedArtifactSource,
  context: MaterializeContext,
): Promise<MaterializedArtifact> {
  await mkdir(context.cacheRoot, { recursive: true })
  const stagingRoot = await mkdtemp(join(context.cacheRoot, '.staging-'))
  const stagingArtifact = join(stagingRoot, 'artifact')
  try {
    const metadata = await prepareSource(source, stagingArtifact, stagingRoot, context)
    const hash = await hashDirectory(stagingArtifact)
    const target = join(context.cacheRoot, hash)
    await promoteToCache(stagingArtifact, target, hash)
    return { path: target, hash, sourceType: source.type, ...metadata }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}
