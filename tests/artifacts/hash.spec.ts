import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashDirectory } from '../../src/artifacts/hash.js'

describe('制品目录哈希', () => {
  it('相同内容得到相同哈希，文件变化会改变哈希', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-artifact-hash-'))
    const first = join(root, 'first')
    const second = join(root, 'second')
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(first, 'index.js'), 'export default 1\n')
    await writeFile(join(second, 'index.js'), 'export default 1\n')

    expect(await hashDirectory(first)).toBe(await hashDirectory(second))

    await writeFile(join(second, 'index.js'), 'export default 2\n')
    expect(await hashDirectory(first)).not.toBe(await hashDirectory(second))
  })

  it('拒绝指向制品根外部的符号链接', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-artifact-link-'))
    const artifact = join(root, 'artifact')
    await mkdir(artifact)
    await writeFile(join(root, 'secret.txt'), 'outside')
    await symlink('../secret.txt', join(artifact, 'escape.txt'))

    await expect(hashDirectory(artifact)).rejects.toThrow(/symbolic link.*escape/i)
  })

  it('忽略 VCS 和 node_modules 目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'plugin-artifact-ignore-'))
    await mkdir(join(root, '.git'))
    await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'index.js'), 'export default 1\n')
    const before = await hashDirectory(root)
    await writeFile(join(root, '.git', 'HEAD'), 'changed')
    await writeFile(join(root, 'node_modules', 'dep.js'), 'changed')
    expect(await hashDirectory(root)).toBe(before)
  })
})
