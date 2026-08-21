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
      {
        type: 'assistant/message',
        seq: 0,
        data: {
          message: { role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'read' }] },
          usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 1 },
        },
      },
      { type: 'tool/call', seq: 1, data: { name: 'read', callId: 'call-1' } },
      {
        type: 'tool/result',
        seq: 2,
        data: { message: { callId: 'call-1', role: 'user', content: [], isError: false } },
      },
      {
        type: 'assistant/message',
        seq: 3,
        data: {
          message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 },
        },
      },
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
    await writeFile(
      workspaceDiffPath,
      `${JSON.stringify({ schemaVersion: 1, added: ['toolshrink.log'], modified: [], deleted: [] })}\n`,
    )

    const evidence = await collectRunEvidence({
      sessionRoot: join(root, 'sessions'),
      stdoutPath,
      stderrPath,
      processExitCode: 0,
      signal: null,
      durationMs: 100,
      startupMs: 10,
      startupCheck: {
        stdoutPath: join(root, 'startup.stdout.log'),
        stderrPath: join(root, 'startup.stderr.log'),
        processExitCode: 0,
        signal: null,
        durationMs: 20,
        startupMs: 5,
        success: true,
      },
      workspaceDiffPath,
    })

    expect(evidence.finalOutput).toBe('done')
    expect(evidence.toolCalls).toEqual([{ name: 'read', callId: 'call-1', failed: false }])
    expect(evidence.runEvidence.tokenUsage).toEqual({ input: 14, output: 7, reasoning: 2, cacheRead: 4, cacheWrite: 1 })
    expect(evidence.runEvidence.workspaceDiffPath).toBe(workspaceDiffPath)
    expect(evidence.runEvidence.startupCheck).toMatchObject({ success: true, processExitCode: 0 })
    expect(evidence.runEvidence.sessionCollected).toBe(true)
    expect(evidence.workspaceDiff).toEqual({
      schemaVersion: 1,
      added: ['toolshrink.log'],
      modified: [],
      deleted: [],
    })
    expect(evidence.session.header.id).toBe('primary')
  })
})
