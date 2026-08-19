import { PROTOCOL_IDENTIFIERS } from '../domain/protocol.js'
import { createToolDefinitions, type ExperimentToolDefinition } from './tools.js'

export const name = PROTOCOL_IDENTIFIERS.cordisEntryId
export const inject = ['tools'] as const

export interface ToolContext {
  tools: {
    register(definition: ExperimentToolDefinition): unknown
  }
}

export function apply(context: ToolContext): void {
  for (const definition of createToolDefinitions()) context.tools.register(definition)
}

export { createToolDefinitions } from './tools.js'
