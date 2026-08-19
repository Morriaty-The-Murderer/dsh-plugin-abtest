import {
  compareExperiment,
  decideExperiment,
  initProject,
  reportExperiment,
  runExperiment,
  statusExperiment,
  validateExperiment,
} from '../cli/workflow.js'

interface SafeArgs {
  manifest: string
  output: string
}

export interface ToolOperations {
  init(output: string): unknown | Promise<unknown>
  validate(manifest: string, output: string): unknown | Promise<unknown>
  run(manifest: string, output: string): unknown | Promise<unknown>
  status(manifest: string, output: string): unknown | Promise<unknown>
  compare(manifest: string, output: string): unknown | Promise<unknown>
  report(manifest: string, output: string): unknown | Promise<unknown>
  decision(manifest: string, output: string): unknown | Promise<unknown>
}

export interface ExperimentToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: 'string'; description: string }>
    required: string[]
    additionalProperties: false
  }
  output: {
    schema: { type: 'object'; additionalProperties: true }
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
  }
  execute(args: unknown): Promise<unknown>
}

async function runModelSafeExperiment(manifest: string, output: string): Promise<unknown> {
  const { cases } = await validateExperiment(manifest)
  const commandAssertions = cases.flatMap((caseDef) =>
    caseDef.assertions.filter((assertion) => assertion.kind === 'command_test').map((assertion) => assertion.id),
  )
  if (commandAssertions.length > 0) {
    throw new Error(
      `command_test assertions are not allowed through model-facing tools: ${commandAssertions.join(', ')}`,
    )
  }
  return runExperiment(manifest, output)
}

const defaultOperations: ToolOperations = {
  init: initProject,
  validate: async (manifest) => validateExperiment(manifest),
  run: runModelSafeExperiment,
  status: statusExperiment,
  compare: compareExperiment,
  report: reportExperiment,
  decision: decideExperiment,
}

const commonParameters = {
  type: 'object' as const,
  properties: {
    manifest: { type: 'string' as const, description: 'Path to a versioned experiment manifest.' },
    output: { type: 'string' as const, description: 'Controller-owned experiment evidence root.' },
  },
  required: ['manifest', 'output'],
  additionalProperties: false as const,
}

function safeArgs(value: unknown): SafeArgs {
  if (value === null || typeof value !== 'object') throw new Error('Tool arguments must be an object')
  const args = value as Record<string, unknown>
  const keys = Object.keys(args)
  if (keys.some((key) => key !== 'manifest' && key !== 'output'))
    throw new Error('Tool arguments contain an unknown field')
  if (typeof args.manifest !== 'string' || typeof args.output !== 'string') {
    throw new Error('Tool arguments require string manifest and output paths')
  }
  return { manifest: args.manifest, output: args.output }
}

function tool(
  name: string,
  description: string,
  operation: (manifest: string, output: string) => unknown | Promise<unknown>,
): ExperimentToolDefinition {
  return {
    name,
    description,
    parameters: commonParameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(value) {
      const args = safeArgs(value)
      return operation(args.manifest, args.output)
    },
  }
}

export function createToolDefinitions(operations: ToolOperations = defaultOperations): ExperimentToolDefinition[] {
  const initParameters = {
    type: 'object' as const,
    properties: { output: { type: 'string' as const, description: 'New experiment project directory.' } },
    required: ['output'],
    additionalProperties: false as const,
  }
  return [
    {
      name: 'plugin_experiment_init',
      description: 'Create a deterministic paired-experiment scaffold without network or production mutations.',
      parameters: initParameters,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(value) {
        if (value === null || typeof value !== 'object' || typeof (value as { output?: unknown }).output !== 'string') {
          throw new Error('Init requires an output directory')
        }
        if (Object.keys(value).some((key) => key !== 'output'))
          throw new Error('Init arguments contain an unknown field')
        return operations.init((value as { output: string }).output)
      },
    },
    tool(
      'plugin_experiment_validate',
      'Validate an experiment manifest and all local fixture contracts.',
      operations.validate,
    ),
    tool(
      'plugin_experiment_run',
      'Run isolated Control and Candidate child processes and collect paired evidence.',
      operations.run,
    ),
    tool('plugin_experiment_status', 'Read completion state from canonical experiment evidence.', operations.status),
    tool('plugin_experiment_compare', 'Aggregate valid pair deltas using deterministic metrics.', operations.compare),
    tool('plugin_experiment_report', 'Write canonical JSON, Markdown, and static HTML reports.', operations.report),
    tool('plugin_experiment_decision', 'Apply the deterministic four-state promotion policy.', operations.decision),
  ]
}
