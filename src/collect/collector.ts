import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type CollectedSession, selectPrimarySession } from '../adapters/dsh/v0_1/session.js'
import type { RunEvidence } from '../domain/types.js'
import { readWorkspaceDiff, type WorkspaceDiff } from '../runtime/workspace-diff.js'

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
  workspaceDiff?: WorkspaceDiff
}

function dataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function collectToolCalls(session: CollectedSession): CollectedToolCall[] {
  const results = new Map<string, boolean>()
  for (const event of session.events) {
    if (event.type !== 'tool/result') continue
    const data = dataRecord(event.data)
    const message = dataRecord(data.message)
    if (typeof message.callId === 'string') {
      results.set(message.callId, message.isError === true || data.error !== undefined)
    }
  }
  return session.events.flatMap((event) => {
    if (event.type !== 'tool/call') return []
    const data = dataRecord(event.data)
    if (typeof data.name !== 'string' || typeof data.callId !== 'string') return []
    return [{ name: data.name, callId: data.callId, failed: results.get(data.callId) ?? false }]
  })
}

function collectUsage(session: CollectedSession): RunEvidence['tokenUsage'] | undefined {
  const total = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  let observed = false
  for (const event of session.events) {
    if (event.type !== 'assistant/message') continue
    const usage = dataRecord(dataRecord(event.data).usage)
    if (
      typeof usage.inputTokens !== 'number' ||
      !Number.isFinite(usage.inputTokens) ||
      typeof usage.outputTokens !== 'number' ||
      !Number.isFinite(usage.outputTokens)
    ) {
      continue
    }
    const optional = (key: string): number => {
      const value = usage[key]
      return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }
    observed = true
    total.input += usage.inputTokens
    total.output += usage.outputTokens
    total.reasoning += optional('reasoningTokens')
    total.cacheRead += optional('cacheReadTokens')
    total.cacheWrite += optional('cacheWriteTokens')
  }
  return observed ? total : undefined
}

function finalAssistantText(session: CollectedSession): string | undefined {
  const event = [...session.events].reverse().find((candidate) => candidate.type === 'assistant/message')
  const content = dataRecord(dataRecord(event?.data).message).content
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((block) => {
    const record = dataRecord(block)
    return record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
  })
  return text.length === 0 ? undefined : text.join('')
}

export async function collectRunEvidence(input: EvidenceProcessInput): Promise<CollectedRunEvidence> {
  const session = await selectPrimarySession(input.sessionRoot)
  const finalOutput = finalAssistantText(session)
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
  if (input.workspaceDiffPath !== undefined) result.workspaceDiff = await readWorkspaceDiff(input.workspaceDiffPath)
  return result
}
