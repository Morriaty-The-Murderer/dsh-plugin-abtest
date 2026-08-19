import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DshSessionEvent, DshSessionHeader } from './events.js'
import { isKnownSessionEvent } from './events.js'
import { readSessionArtifact } from './zstd.js'

export interface SessionWarning {
  code: 'torn_tail'
  line: number
}

export interface CollectedSession {
  path: string
  header: DshSessionHeader
  events: DshSessionEvent[]
  unknownEventRefs: string[]
  warnings: SessionWarning[]
}

function parseRecord(text: string, line: number, isTail: boolean): unknown | SessionWarning {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (isTail) return { code: 'torn_tail', line }
    throw new Error(`Invalid DSH session JSON at line ${line}: ${(error as Error).message}`, { cause: error })
  }
}

function parseHeader(value: unknown): DshSessionHeader {
  if (value === null || typeof value !== 'object') throw new Error('Invalid DSH session header')
  const header = value as Record<string, unknown>
  if (header.type !== 'session') throw new Error('Invalid DSH session header type')
  if (header.version !== 0) throw new Error(`Unsupported DSH session version ${String(header.version)}`)
  if (typeof header.id !== 'string' || header.id === '') throw new Error('Invalid DSH session header id')
  return header as DshSessionHeader
}

export async function collectSessionLog(path: string): Promise<CollectedSession> {
  const content = (await readSessionArtifact(path)).toString('utf8')
  const hasCompleteTail = content.endsWith('\n')
  const lines = content.split('\n')
  if (hasCompleteTail) lines.pop()
  if (lines.length === 0 || lines[0] === '') throw new Error('DSH session artifact has no header')
  const header = parseHeader(parseRecord(lines[0] as string, 1, false))
  const events: DshSessionEvent[] = []
  const unknownEventRefs: string[] = []
  const warnings: SessionWarning[] = []
  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const parsed = parseRecord(lines[index] as string, lineNumber, !hasCompleteTail && index === lines.length - 1)
    if ('code' in (parsed as SessionWarning)) {
      warnings.push(parsed as SessionWarning)
      continue
    }
    if (parsed === null || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') {
      throw new Error(`Invalid DSH session event at line ${lineNumber}`)
    }
    const event = parsed as DshSessionEvent
    events.push(event)
    if (!isKnownSessionEvent(event.type)) unknownEventRefs.push(`${basename(path).replace('.zstd', '')}:${lineNumber}`)
  }
  return { path, header, events, unknownEventRefs, warnings }
}

async function findSessionArtifacts(root: string): Promise<string[]> {
  const found: string[] = []
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && (entry.name === 'session.jsonl' || entry.name === 'session.jsonl.zstd'))
        found.push(path)
    }
  }
  await visit(root)
  return found
}

export async function selectPrimarySession(root: string): Promise<CollectedSession> {
  const sessions = await Promise.all((await findSessionArtifacts(root)).map(collectSessionLog))
  const roots = sessions.filter(
    (session) => (session.header.delegationDepth ?? 0) === 0 && session.header.parentId === undefined,
  )
  if (roots.length !== 1) throw new Error(`Expected exactly one primary DSH session, found ${roots.length}`)
  return roots[0] as CollectedSession
}
