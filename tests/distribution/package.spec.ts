import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface ProjectIdentity {
  npmName: string
  repoSlug: string
}

interface PackageManifest {
  name?: string
  repository?: { type?: string; url?: string }
  homepage?: string
  bugs?: { url?: string }
  keywords?: string[]
  files?: string[]
  publishConfig?: { access?: string; provenance?: boolean }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T
}

describe('distribution package contract', () => {
  it('公开包元数据把 npm 制品绑定到唯一的公开源码仓库', async () => {
    const manifest = await readJson<PackageManifest>('package.json')
    const identity = await readJson<ProjectIdentity>('project.identity.json')
    const repository = `https://github.com/Morriaty-The-Murderer/${identity.repoSlug}`

    expect(manifest.name).toBe(identity.npmName)
    expect(manifest.repository).toEqual({ type: 'git', url: `git+${repository}.git` })
    expect(manifest.homepage).toBe(`${repository}#readme`)
    expect(manifest.bugs).toEqual({ url: `${repository}/issues` })
    expect(manifest.keywords).toEqual(
      expect.arrayContaining(['deepseek-harness', 'dsh-plugin', 'ab-testing', 'llm-evaluation']),
    )
    expect(manifest.publishConfig).toEqual({ access: 'public', provenance: true })
  })

  it('npm 制品清单同时包含运行入口、DSH bundle 和双语说明', async () => {
    const manifest = await readJson<PackageManifest>('package.json')

    expect(manifest.files).toEqual(
      expect.arrayContaining([
        'lib',
        'cordis.patch.yml',
        'project.identity.json',
        'README.md',
        'README.zh-CN.md',
        'assets/social-preview.jpg',
        'LICENSE',
      ]),
    )
  })
})
