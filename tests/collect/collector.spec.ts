import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectRunEvidence } from '../../src/collect/collector.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('collectRunEvidence', () => {
  it('从主 session 汇总最终输出、工具调用和 token usage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evidence-collector-'))
    roots.push(root)
    const sessionRoot = join(root, 'sessions', 'primary')
    await mkdir(sessionRoot, { recursive: true })
    const records = [
      { type: 'session', version: 0, id: 'primary', delegationDepth: 0 },
      { type: 'tool/call', seq: 0, data: { name: 'read', callId: 'call-1' } },
      { type: 'tool/result', seq: 1, data: { callId: 'call-1', ok: true } },
      { type: 'assistant/final', seq: 2, data: { text: 'done' } },
      { type: 'usage', seq: 3, data: { input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 1 } },
    ]
    await writeFile(
      join(sessionRoot, 'session.jsonl'),
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    )
    const stdoutPath = join(root, 'stdout.log')
    const stderrPath = join(root, 'stderr.log')
    const workspaceDiffPath = join(root, 'workspace-diff.json')
    await writeFile(stdoutPath, 'stdout')
    await writeFile(stderrPath, '')
    await writeFile(workspaceDiffPath, '{}')

    const evidence = await collectRunEvidence({
      sessionRoot: join(root, 'sessions'),
      stdoutPath,
      stderrPath,
      processExitCode: 0,
      signal: null,
      durationMs: 100,
      startupMs: 10,
      workspaceDiffPath,
    })

    expect(evidence.finalOutput).toBe('done')
    expect(evidence.toolCalls).toEqual([{ name: 'read', callId: 'call-1', failed: false }])
    expect(evidence.runEvidence.tokenUsage).toEqual({ input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 1 })
    expect(evidence.runEvidence.workspaceDiffPath).toBe(workspaceDiffPath)
    expect(evidence.session.header.id).toBe('primary')
  })
})
