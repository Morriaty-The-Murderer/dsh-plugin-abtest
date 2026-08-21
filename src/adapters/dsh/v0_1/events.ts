export interface DshSessionHeader {
  type: 'session'
  version: 0
  id: string
  createdAt?: number
  delegationDepth?: number
  parentId?: string
  parentSession?: string
  [key: string]: unknown
}

export interface DshSessionEvent {
  type: string
  seq?: number
  time?: number
  data?: unknown
  [key: string]: unknown
}

const knownEventTypes = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'assistant/chunk',
  'assistant/message',
  'text-chunks',
  'tool/call',
  'tool/result',
  'request/header-delta',
  'request/header',
  'plugin/installed',
  'plugin/loaded',
  'plugin/activated',
  'dsh.plugin-experiment/exposure',
])

export function isKnownSessionEvent(type: string): boolean {
  return knownEventTypes.has(type)
}
