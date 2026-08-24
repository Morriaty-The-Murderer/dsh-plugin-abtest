import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { list } from 'tar'

interface PackageManifest {
  name: string
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

interface PluginProbe {
  name: string
  toolCount: number
}

interface CommandResult {
  stdout: string
  stderr: string
}

const PROFILE = 'distribution-smoke'

function commandName(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function run(command: string, args: string[], cwd: string, env = process.env): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 30_000,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(
      [`command failed: ${command} ${args.join(' ')}`, result.stdout, result.stderr].filter(Boolean).join('\n'),
    )
  }
  return { stdout: result.stdout, stderr: result.stderr }
}

async function tarballEntries(path: string): Promise<string[]> {
  const entries: string[] = []
  await list({
    file: path,
    onReadEntry(entry) {
      entries.push(entry.path)
    },
  })
  return entries
}

async function main(): Promise<void> {
  const projectRoot = process.cwd()
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-distribution-'))
  try {
    const manifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as PackageManifest
    const packRoot = join(root, 'pack')
    const dshHome = join(root, 'dsh-home')
    await run(commandName('pnpm'), ['pack', '--pack-destination', packRoot], projectRoot)

    const tarballs = (await readdir(packRoot)).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 1) throw new Error(`expected one tarball, found ${tarballs.length}`)
    const tarball = join(packRoot, tarballs[0] as string)
    const entries = await tarballEntries(tarball)
    const requiredEntries = [
      'package/package.json',
      'package/cordis.patch.yml',
      'package/lib/dsh-plugin/index.js',
      'package/README.md',
      'package/README.zh-CN.md',
    ]
    const missingEntries = requiredEntries.filter((entry) => !entries.includes(entry))
    if (missingEntries.length > 0) throw new Error(`tarball is missing: ${missingEntries.join(', ')}`)

    const dsh = resolve(projectRoot, 'node_modules', '.bin', commandName('dsh'))
    const smokeEnv = { ...process.env, DSH_HOME: dshHome }
    const installArgs = ['plugin', '--profile', PROFILE, 'add', tarball, '--offline']
    if (process.env.DISTRIBUTION_PNPM_STORE !== undefined) {
      installArgs.push('--store-dir', process.env.DISTRIBUTION_PNPM_STORE)
    }
    run(dsh, installArgs, projectRoot, smokeEnv)

    const profileRoot = join(dshHome, 'profiles', PROFILE)
    const profile = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8')) as ProfileManifest
    const bundleIncluded = profile.dsh?.profile?.bundles?.includes(manifest.name) === true
    if (!bundleIncluded) throw new Error(`${manifest.name} was not added to dsh.profile.bundles`)

    const dump = run(dsh, ['--profile', PROFILE, '--dump-default-config'], projectRoot, smokeEnv).stdout
    const patchLoaded =
      dump.includes(`# == ${manifest.name}`) &&
      dump.includes('id: plugin-experiment-controller') &&
      dump.includes(`name: ${manifest.name}/dsh-plugin`)
    if (!patchLoaded) throw new Error('installed bundle patch was not composed into the profile')

    const probeSource = [
      `const plugin = await import(${JSON.stringify(`${manifest.name}/dsh-plugin`)})`,
      'process.stdout.write(JSON.stringify({ name: plugin.name, toolCount: plugin.createToolDefinitions().length }))',
    ].join(';')
    const probe = JSON.parse(
      run(process.execPath, ['--input-type=module', '--eval', probeSource], profileRoot, smokeEnv).stdout,
    ) as PluginProbe
    if (probe.name !== 'plugin-experiment-controller' || probe.toolCount !== 7) {
      throw new Error(`unexpected plugin probe: ${JSON.stringify(probe)}`)
    }

    const hash = createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex')
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        packageName: manifest.name,
        profile: PROFILE,
        bundleIncluded,
        patchLoaded,
        pluginName: probe.name,
        toolCount: probe.toolCount,
        tarballSha256: hash,
      })}\n`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
