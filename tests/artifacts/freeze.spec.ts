import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { describe, expect, it } from 'vitest'
import { freezeVariant } from '../../src/artifacts/freeze.js'

async function createPluginFixture(): Promise<{ root: string; cacheRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-artifact-freeze-'))
  const plugin = join(root, 'plugin')
  await mkdir(plugin)
  await mkdir(join(root, 'variants'))
  await writeFile(
    join(plugin, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture-plugin',
        version: '1.2.3',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
      undefined,
      2,
    )}\n`,
  )
  await writeFile(join(plugin, 'index.js'), 'export default function fixture() {}\n')
  await writeFile(join(plugin, 'cordis.patch.yml'), '- id: fixture\n  name: fixture-plugin\n')
  await writeFile(join(plugin, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  await writeFile(join(root, 'variants', 'control.yml'), 'enabled: true\n')
  return { root, cacheRoot: join(root, 'cache') }
}

describe('FrozenArtifact', () => {
  it('冻结 local directory 并记录制品、配置、锁文件和 bundle 哈希', async () => {
    const fixture = await createPluginFixture()

    const artifact = await freezeVariant(
      { id: 'control', source: 'local:plugin', configPath: 'variants/control.yml' },
      { baseDir: fixture.root, cacheRoot: fixture.cacheRoot },
    )

    expect(artifact).toMatchObject({
      packageName: 'fixture-plugin',
      packageVersion: '1.2.3',
      sourceType: 'local-directory',
    })
    for (const hash of [
      artifact.artifactHash,
      artifact.pluginConfigHash,
      artifact.dependencyLockHash,
      artifact.dshBundleHash,
    ]) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(JSON.parse(await readFile(join(artifact.materializedPath, 'package.json'), 'utf8'))).toMatchObject({
      name: 'fixture-plugin',
    })
  })

  it('并发冻结相同来源时复用同一个完整缓存制品', async () => {
    const fixture = await createPluginFixture()

    const artifacts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        freezeVariant(
          { id: index % 2 === 0 ? 'control' : 'candidate', source: 'local:plugin' },
          { baseDir: fixture.root, cacheRoot: fixture.cacheRoot },
        ),
      ),
    )

    expect(new Set(artifacts.map((artifact) => artifact.materializedPath)).size).toBe(1)
    expect(new Set(artifacts.map((artifact) => artifact.artifactHash)).size).toBe(1)
    const firstArtifact = artifacts[0]
    if (firstArtifact === undefined) throw new Error('Expected at least one frozen artifact')
    expect(JSON.parse(await readFile(join(firstArtifact.materializedPath, 'package.json'), 'utf8'))).toMatchObject({
      name: 'fixture-plugin',
    })
  })

  it('制品 metadata 不包含 ambient secret 原文', async () => {
    const fixture = await createPluginFixture()
    const sentinel = 'SENTINEL_SECRET_MUST_NOT_LEAK'
    process.env.ARTIFACT_TEST_SECRET = sentinel
    try {
      const artifact = await freezeVariant(
        { id: 'candidate', source: 'local:plugin' },
        { baseDir: fixture.root, cacheRoot: fixture.cacheRoot },
      )
      expect(JSON.stringify(artifact)).not.toContain(sentinel)
    } finally {
      delete process.env.ARTIFACT_TEST_SECRET
    }
  })

  it('冻结 npm pack 形状的本地 tarball', async () => {
    const fixture = await createPluginFixture()
    const packageRoot = join(fixture.root, 'packed', 'package')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(
      join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: 'packed-plugin', version: '2.0.0' })}\n`,
    )
    await writeFile(join(packageRoot, 'index.js'), 'export default 2\n')
    const tarball = join(fixture.root, 'packed-plugin-2.0.0.tgz')
    await createTar({ cwd: join(fixture.root, 'packed'), file: tarball, gzip: true }, ['package'])

    const artifact = await freezeVariant(
      { id: 'candidate', source: 'tarball:packed-plugin-2.0.0.tgz' },
      { baseDir: fixture.root, cacheRoot: fixture.cacheRoot },
    )

    expect(artifact).toMatchObject({
      packageName: 'packed-plugin',
      packageVersion: '2.0.0',
      sourceType: 'local-tarball',
    })
  })

  it('通过受控 package manager 物化精确 npm 版本', async () => {
    const fixture = await createPluginFixture()
    const packageRoot = join(fixture.root, 'npm-packed', 'package')
    await mkdir(packageRoot, { recursive: true })
    await writeFile(
      join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: 'remote-plugin', version: '2.1.0' })}\n`,
    )
    await writeFile(join(packageRoot, 'index.js'), 'export default 21\n')
    const tarball = join(fixture.root, 'remote-plugin-2.1.0.tgz')
    await createTar({ cwd: join(fixture.root, 'npm-packed'), file: tarball, gzip: true }, ['package'])
    const log = join(fixture.root, 'package-manager.log')
    const fake = join(fixture.root, 'fake-package-manager.mjs')
    await writeFile(
      fake,
      `import { appendFileSync, copyFileSync } from 'node:fs'; import { join } from 'node:path';
const [tarball, log, ...args] = process.argv.slice(2);
appendFileSync(log, JSON.stringify(args) + '\\n');
const destination = args[args.indexOf('--pack-destination') + 1];
copyFileSync(tarball, join(destination, 'remote-plugin-2.1.0.tgz'));
`,
    )

    const artifact = await freezeVariant(
      { id: 'candidate', source: 'npm:remote-plugin@2.1.0' },
      {
        baseDir: fixture.root,
        cacheRoot: fixture.cacheRoot,
        packageManagerCommand: { bin: process.execPath, prefixArgs: [fake, tarball, log] },
      },
    )

    expect(artifact).toMatchObject({ packageName: 'remote-plugin', packageVersion: '2.1.0', sourceType: 'npm' })
    expect(await readFile(log, 'utf8')).toContain('"remote-plugin@2.1.0"')
  })

  it('通过受控 git 物化固定 GitHub commit 并移除仓库元数据', async () => {
    const fixture = await createPluginFixture()
    const source = join(fixture.root, 'git-source')
    await mkdir(source)
    await writeFile(join(source, 'package.json'), `${JSON.stringify({ name: 'git-plugin', version: '3.0.0' })}\n`)
    await writeFile(join(source, 'index.js'), 'export default 30\n')
    const commit = '0123456789abcdef0123456789abcdef01234567'
    const log = join(fixture.root, 'git.log')
    const fake = join(fixture.root, 'fake-git.mjs')
    await writeFile(
      fake,
      `import { appendFileSync, cpSync, mkdirSync } from 'node:fs'; import { join } from 'node:path';
const [source, log, ...args] = process.argv.slice(2);
appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'clone') {
  const destination = args.at(-1);
  cpSync(source, destination, { recursive: true });
  mkdirSync(join(destination, '.git'));
}
`,
    )

    const artifact = await freezeVariant(
      { id: 'candidate', source: `github:owner/git-plugin#${commit}` },
      {
        baseDir: fixture.root,
        cacheRoot: fixture.cacheRoot,
        gitCommand: { bin: process.execPath, prefixArgs: [fake, source, log] },
      },
    )

    expect(artifact).toMatchObject({
      packageName: 'git-plugin',
      packageVersion: '3.0.0',
      sourceType: 'github',
      sourceCommit: commit,
    })
    expect(await readFile(log, 'utf8')).toContain(`"${commit}"`)
    await expect(readFile(join(artifact.materializedPath, '.git', 'HEAD'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
