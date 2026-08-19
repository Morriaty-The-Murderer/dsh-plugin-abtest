import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSessionLog, selectPrimarySession } from '../../src/adapters/dsh/v0_1/session.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

describe('DSH v0.1 session adapter', () => {
  it('保留未知事件并将坏尾行记录为 warning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-'))
    roots.push(root)
    const path = join(root, 'session.jsonl')
    await writeFile(
      path,
      line({ type: 'session', version: 0, id: 'root', createdAt: 1, delegationDepth: 0 }) +
        line({ type: 'future/event', seq: 0, time: 2, data: { preserved: true } }) +
        '{"type":"assistant/chunk"',
    )

    const session = await collectSessionLog(path)

    expect(session.events).toEqual([{ type: 'future/event', seq: 0, time: 2, data: { preserved: true } }])
    expect(session.unknownEventRefs).toEqual(['session.jsonl:2'])
    expect(session.warnings).toEqual([{ code: 'torn_tail', line: 3 }])
  })

  it('拒绝未知 header 版本和中间损坏行', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-invalid-'))
    roots.push(root)
    const versionPath = join(root, 'version.jsonl')
    await writeFile(versionPath, line({ type: 'session', version: 42, id: 'future' }))
    await expect(collectSessionLog(versionPath)).rejects.toThrow(/unsupported.*version 42/i)

    const corruptPath = join(root, 'corrupt.jsonl')
    await writeFile(
      corruptPath,
      `${line({ type: 'session', version: 0, id: 'root' })}{bad}\n${line({ type: 'turn/end' })}`,
    )
    await expect(collectSessionLog(corruptPath)).rejects.toThrow(/line 2/i)
  })

  it('读取 Node 24 zstd 会话制品', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-zstd-'))
    roots.push(root)
    const path = join(root, 'session.jsonl.zstd')
    const content = line({ type: 'session', version: 0, id: 'compressed' }) + line({ type: 'turn/start', seq: 0 })
    await writeFile(path, zstdCompressSync(content))

    await expect(collectSessionLog(path)).resolves.toMatchObject({ header: { id: 'compressed' }, warnings: [] })
  })

  it('按 DSH append-only 合同读取多个独立 zstd frame', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-zstd-frames-'))
    roots.push(root)
    const path = join(root, 'session.jsonl.zstd')
    const header = line({ type: 'session', version: 0, id: 'multi-frame' })
    const events = line({ type: 'turn/start', seq: 0 }) + line({ type: 'turn/end', seq: 1 })
    await writeFile(path, Buffer.concat([zstdCompressSync(header), zstdCompressSync(events)]))

    const session = await collectSessionLog(path)
    expect(session.header.id).toBe('multi-frame')
    expect(session.events.map((event) => event.type)).toEqual(['turn/start', 'turn/end'])
  })

  it('从父子 session 中选择 delegationDepth 为零的唯一主会话', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-session-tree-'))
    roots.push(root)
    for (const [name, depth] of [
      ['parent', 0],
      ['child', 1],
    ] as const) {
      const directory = join(root, name)
      await mkdir(directory)
      await writeFile(
        join(directory, 'session.jsonl'),
        line({ type: 'session', version: 0, id: name, delegationDepth: depth }),
      )
    }

    const selected = await selectPrimarySession(root)
    expect(selected.header.id).toBe('parent')
  })
})
