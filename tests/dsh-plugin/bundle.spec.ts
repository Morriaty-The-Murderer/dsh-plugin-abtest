import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PROTOCOL_IDENTIFIERS } from '../../src/domain/protocol.js'
import { apply } from '../../src/dsh-plugin/index.js'
import { PROJECT_IDENTITY } from '../../src/identity/generated.js'

describe('Cordis bundle surface', () => {
  it('使用稳定 entry id 和 identity 驱动的 public package name', async () => {
    const patch = await readFile(resolve('cordis.patch.yml'), 'utf8')
    expect(patch).toContain(`id: ${PROTOCOL_IDENTIFIERS.cordisEntryId}`)
    expect(patch).toContain(`name: ${PROJECT_IDENTITY.npmName}/dsh-plugin`)
  })

  it('apply 向 tools runtime 注册七个定义', () => {
    const register = vi.fn(() => () => undefined)
    apply({ tools: { register } })
    expect(register).toHaveBeenCalledTimes(7)
  })
})
