import type { DshSessionEvent } from '../adapters/dsh/v0_1/events.js'

export interface ExposureEvidence {
  events: readonly DshSessionEvent[]
  prompt?: string
  serviceOperations?: readonly string[]
  otelAttributes?: Readonly<Record<string, unknown>>
}

export type ExposureDetectorConfig =
  | { id: string; kind: 'tool_name'; toolName: string }
  | { id: string; kind: 'session_event'; eventType: string }
  | { id: string; kind: 'prompt_section'; text: string }
  | { id: string; kind: 'service_operation'; operation: string }
  | { id: string; kind: 'otel_attribute'; key: string; value?: unknown }
  | { id: string; kind: 'custom_receipt'; plugin?: string }
