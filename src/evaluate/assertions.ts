import { access, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { AssertionResult, Case, DeterministicAssertion, Run } from '../domain/types.js'
import { executeChildProcess } from '../runtime/process.js'

export interface DeterministicContext {
  workspacePath: string
  finalOutput?: string
  toolCalls: readonly { name: string; failed: boolean }[]
  criticalSecurityViolations: number
  sessionReadable: boolean
  ownedEffectsRemaining: number
}

interface AssertionEvaluation {
  passed: boolean
  message: string
  evidenceRefs?: string[]
}

function resolveWorkspacePath(workspace: string, requested: unknown): string {
  if (typeof requested !== 'string' || requested === '') throw new Error('Assertion path must be a non-empty string')
  const root = resolve(workspace)
  const path = resolve(root, requested)
  const child = relative(root, path)
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`Assertion path escapes workspace: ${requested}`)
  return path
}

function requiredNumber(config: Record<string, unknown>, key: string): number {
  const value = config[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Assertion config ${key} must be a number`)
  return value
}

function validateJsonType(value: unknown, schema: Record<string, unknown>, path = '$'): string[] {
  const failures: string[] = []
  const type = schema.type
  const matches =
    type === undefined ||
    (type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'number' && typeof value === 'number') ||
    (type === 'integer' && Number.isInteger(value)) ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'null' && value === null)
  if (!matches) return [`${path} expected ${String(type)}`]
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !Object.hasOwn(record, key)) failures.push(`${path}.${key} is required`)
      }
    }
    if (schema.properties !== null && typeof schema.properties === 'object') {
      for (const [key, childSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (Object.hasOwn(record, key) && childSchema !== null && typeof childSchema === 'object') {
          failures.push(...validateJsonType(record[key], childSchema as Record<string, unknown>, `${path}.${key}`))
        }
      }
    }
  }
  return failures
}

async function evaluateAssertion(
  run: Run,
  assertion: DeterministicAssertion,
  context: DeterministicContext,
): Promise<AssertionEvaluation> {
  switch (assertion.kind) {
    case 'process_exit_success':
      return run.evidence.processExitCode === 0 && run.evidence.signal === null && run.infrastructureError === undefined
        ? {
            passed: true,
            message: 'Process exited successfully',
            evidenceRefs: [run.evidence.stdoutPath, run.evidence.stderrPath],
          }
        : { passed: false, message: 'Process did not exit successfully' }
    case 'file_exists': {
      const path = resolveWorkspacePath(context.workspacePath, assertion.config.path)
      await access(path)
      return { passed: true, message: 'Expected file exists', evidenceRefs: [path] }
    }
    case 'json_schema': {
      const path = resolveWorkspacePath(context.workspacePath, assertion.config.path)
      const value = JSON.parse(await readFile(path, 'utf8'))
      const schema = assertion.config.schema
      if (schema === null || typeof schema !== 'object')
        throw new Error('JSON schema assertion requires an object schema')
      const failures = validateJsonType(value, schema as Record<string, unknown>)
      return failures.length === 0
        ? { passed: true, message: 'JSON matches schema', evidenceRefs: [path] }
        : { passed: false, message: failures.join('; '), evidenceRefs: [path] }
    }
    case 'command_test': {
      const executable = assertion.config.executable
      const args = assertion.config.args ?? []
      if (typeof executable !== 'string' || !Array.isArray(args) || !args.every((entry) => typeof entry === 'string')) {
        throw new Error('Command assertion requires executable and string args')
      }
      const root = resolveWorkspacePath(context.workspacePath, `.plugin-experiment/assertions/${assertion.id}`)
      const result = await executeChildProcess({
        executable,
        args,
        cwd: context.workspacePath,
        environment: {},
        stdoutPath: `${root}.stdout.log`,
        stderrPath: `${root}.stderr.log`,
        timeoutMs: typeof assertion.config.timeoutMs === 'number' ? assertion.config.timeoutMs : 30_000,
        terminationGraceMs: 500,
      })
      return result.exitCode === 0 && result.infrastructureError === undefined
        ? { passed: true, message: 'Verification command passed', evidenceRefs: [`${root}.stdout.log`] }
        : { passed: false, message: 'Verification command failed', evidenceRefs: [`${root}.stderr.log`] }
    }
    case 'forbidden_tool': {
      const names = assertion.config.names
      if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
        throw new Error('Forbidden tool assertion requires string names')
      }
      const used = context.toolCalls.filter((call) => names.includes(call.name)).map((call) => call.name)
      return used.length === 0
        ? { passed: true, message: 'No forbidden tool was called' }
        : { passed: false, message: `Forbidden tools called: ${used.join(', ')}` }
    }
    case 'critical_security': {
      const maximum = requiredNumber(assertion.config, 'maximum')
      return context.criticalSecurityViolations <= maximum
        ? { passed: true, message: 'Critical security gate passed' }
        : {
            passed: false,
            message: `Critical security violations ${context.criticalSecurityViolations} exceed ${maximum}`,
          }
    }
    case 'session_readable':
      return context.sessionReadable
        ? {
            passed: true,
            message: 'Session is readable',
            evidenceRefs: run.evidence.sessionLogPath ? [run.evidence.sessionLogPath] : [],
          }
        : { passed: false, message: 'Session is not readable' }
    case 'unload_cleanup':
      return context.ownedEffectsRemaining === 0
        ? { passed: true, message: 'Plugin unloaded without owned effects' }
        : { passed: false, message: `${context.ownedEffectsRemaining} owned effects remain after unload` }
    case 'required_value': {
      const value = assertion.config.value
      if (typeof value !== 'string') throw new Error('Required value assertion needs a string value')
      return context.finalOutput?.includes(value) === true
        ? {
            passed: true,
            message: 'Final output contains required value',
            evidenceRefs: run.evidence.finalOutputPath ? [run.evidence.finalOutputPath] : [],
          }
        : { passed: false, message: 'Final output does not contain required value' }
    }
    default:
      return { passed: false, message: `Unsupported deterministic assertion kind: ${assertion.kind}` }
  }
}

export async function evaluateDeterministic(
  run: Run,
  caseDef: Case,
  context: DeterministicContext,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = []
  for (const assertion of caseDef.assertions) {
    try {
      const evaluated = await evaluateAssertion(run, assertion, context)
      results.push({
        assertionId: assertion.id,
        passed: evaluated.passed,
        critical: assertion.critical,
        evidenceRefs: evaluated.evidenceRefs ?? [],
        message: evaluated.message,
      })
    } catch (error) {
      results.push({
        assertionId: assertion.id,
        passed: false,
        critical: assertion.critical,
        evidenceRefs: [],
        message: (error as Error).message,
      })
    }
  }
  return results
}
