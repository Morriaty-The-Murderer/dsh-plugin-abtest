import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProjectIdentity } from '../../src/identity/load.js'

const validIdentity = {
  identityVersion: 1,
  displayName: 'Example Experiment',
  shortName: 'Experiment',
  repoSlug: 'example-experiment',
  npmScope: null,
  npmName: 'example-experiment',
  cliBin: 'example-exp',
  description: 'Paired experiments for plugins.',
  legacyAliases: {
    npmPackages: [],
    cliBins: [],
    repoSlugs: [],
  },
}

async function loadIdentityFixture(value: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-experiment-identity-'))
  await writeFile(join(root, 'project.identity.json'), `${JSON.stringify(value, undefined, 2)}\n`)
  return loadProjectIdentity(root)
}

describe('项目身份', () => {
  it('读取严格且完整的项目身份', async () => {
    await expect(loadIdentityFixture(validIdentity)).resolves.toEqual(validIdentity)
  })

  it('拒绝未知字段，避免重命名遗漏新的 public surface', async () => {
    await expect(loadIdentityFixture({ ...validIdentity, unexpected: true })).rejects.toThrow(
      /unrecognized key.*unexpected/i,
    )
  })

  it('拒绝带 npm scope 但未使用同一 scope 的 npmName', async () => {
    await expect(
      loadIdentityFixture({ ...validIdentity, npmScope: '@example', npmName: 'example-experiment' }),
    ).rejects.toThrow(/npmName.*@example\/example-experiment/)
  })
})
