import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type CollectedSession, selectPrimarySession } from '../adapters/dsh/v0_1/session.js'
import type { RunEvidence } from '../domain/types.js'

export interface EvidenceProcessInput {
  sessionRoot: string
  stdoutPath: string
  stderrPath: string
  processExitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  startupMs: number
  workspaceDiffPath?: string
}

export interface CollectedToolCall {
  name: string
  callId: string
  failed: boolean
}

export interface CollectedRunEvidence {
  runEvidence: RunEvidence
  session: CollectedSession
  finalOutput?: string
  toolCalls: CollectedToolCall[]
  warnings: CollectedSession['warnings']
}

function dataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function collectToolCalls(session: CollectedSession): CollectedToolCall[] {
  const results = new Map<string, boolean>()
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const data = dataRecord(event.data)
    if (typeof data.callId === 'string') results.set(data.callId, data.ok === false || data.error !== undefined)
  }
  return session.events.flatMap((event) => {
    if (event.type !== 'tool/call') return []
    const data = dataRecord(event.data)
    if (typeof data.name !== 'string' || typeof data.callId !== 'string') return []
    return [{ name: data.name, callId: data.callId, failed: results.get(data.callId) ?? false }]
  })
}

function collectUsage(session: CollectedSession): RunEvidence['tokenUsage'] | undefined {
  const event = [...session.events].reverse().find((candidate) => candidate.type === 'usage')
  if (event === undefined) return undefined
  const data = dataRecord(event.data)
  const keys = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'] as const
  if (!keys.every((key) => typeof data[key] === 'number' && Number.isFinite(data[key]))) return undefined
  return Object.fromEntries(keys.map((key) => [key, data[key]])) as NonNullable<RunEvidence['tokenUsage']>
}

export async function collectRunEvidence(input: EvidenceProcessInput): Promise<CollectedRunEvidence> {
  const session = await selectPrimarySession(input.sessionRoot)
  const finalEvent = [...session.events].reverse().find((event) => event.type === 'assistant/final')
  const finalText = dataRecord(finalEvent?.data).text
  const finalOutput = typeof finalText === 'string' ? finalText : undefined
  const finalOutputPath = join(dirname(input.stdoutPath), 'final-output.txt')
  if (finalOutput !== undefined) await writeFile(finalOutputPath, finalOutput)

  const runEvidence: RunEvidence = {
    stdoutPath: input.stdoutPath,
    stderrPath: input.stderrPath,
    sessionLogPath: session.path,
    processExitCode: input.processExitCode,
    signal: input.signal,
    durationMs: input.durationMs,
    startupMs: input.startupMs,
  }
  if (finalOutput !== undefined) runEvidence.finalOutputPath = finalOutputPath
  if (input.workspaceDiffPath !== undefined) runEvidence.workspaceDiffPath = input.workspaceDiffPath
  const tokenUsage = collectUsage(session)
  if (tokenUsage !== undefined) runEvidence.tokenUsage = tokenUsage
  const result: CollectedRunEvidence = {
    runEvidence,
    session,
    toolCalls: collectToolCalls(session),
    warnings: session.warnings,
  }
  if (finalOutput !== undefined) result.finalOutput = finalOutput
  return result
}
