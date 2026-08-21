import { stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { ExperimentManifest } from './schema.js'

export interface ValidationIssue {
  code:
    | 'mutable_github_ref'
    | 'path_escape'
    | 'path_missing'
    | 'path_type'
    | 'unsupported_dsh_version'
    | 'unsupported_model_parameter'
    | 'invalid_model_parameter'
    | 'credential_not_allowlisted'
  path: string
  message: string
}

export interface SemanticValidationOptions {
  checkPaths?: boolean
}

function isWithin(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

function isValidHttpHost(value: unknown): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    )
  } catch {
    return false
  }
}

export async function validateManifestSemantics(
  manifest: ExperimentManifest,
  baseDir: string,
  options: SemanticValidationOptions = {},
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  if (manifest.runtime.dsh_version !== '0.1.0-rc.7') {
    issues.push({
      code: 'unsupported_dsh_version',
      path: 'runtime.dsh_version',
      message: 'DSH version must be exactly 0.1.0-rc.7 for this adapter',
    })
  }
  if (manifest.runtime.model.provider === 'deepseek-official') {
    const parameters = manifest.runtime.model.parameters ?? {}
    const allowed = new Set(['reasoningEffort', 'maxTokens'])
    for (const [name, value] of Object.entries(parameters)) {
      const path = `runtime.model.parameters.${name}`
      if (!allowed.has(name)) {
        issues.push({
          code: 'unsupported_model_parameter',
          path,
          message: 'Model parameter is not applied by the deepseek-official profile adapter',
        })
      } else if (name === 'reasoningEffort' && !['off', 'low', 'high', 'max'].includes(String(value))) {
        issues.push({
          code: 'invalid_model_parameter',
          path,
          message: 'reasoningEffort must be one of off, low, high, or max',
        })
      } else if (name === 'maxTokens' && (!Number.isSafeInteger(value) || (value as number) <= 0)) {
        issues.push({
          code: 'invalid_model_parameter',
          path,
          message: 'maxTokens must be a positive safe integer',
        })
      }
    }
  }
  if (manifest.runtime.model.provider === 'openai-compatible') {
    const parameters = manifest.runtime.model.parameters ?? {}
    const allowed = new Set(['host', 'apiKeyEnv', 'contextWindow', 'maxTokens'])
    for (const [name, value] of Object.entries(parameters)) {
      const path = `runtime.model.parameters.${name}`
      if (!allowed.has(name)) {
        issues.push({
          code: 'unsupported_model_parameter',
          path,
          message:
            name === 'apiKey' || name === 'api_key'
              ? 'Literal API keys are forbidden; use apiKeyEnv and the environment allowlist'
              : 'Model parameter is not applied by the openai-compatible profile adapter',
        })
      } else if (name === 'host' && !isValidHttpHost(value)) {
        issues.push({
          code: 'invalid_model_parameter',
          path,
          message: 'host must be an absolute http or https URL without credentials, query, or fragment',
        })
      } else if (name === 'apiKeyEnv' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value))) {
        issues.push({
          code: 'invalid_model_parameter',
          path,
          message: 'apiKeyEnv must be an environment variable name',
        })
      } else if (
        (name === 'contextWindow' || name === 'maxTokens') &&
        (!Number.isSafeInteger(value) || (value as number) <= 0)
      ) {
        issues.push({
          code: 'invalid_model_parameter',
          path,
          message: `${name} must be a positive safe integer`,
        })
      }
    }
    for (const required of ['host', 'apiKeyEnv'] as const) {
      if (parameters[required] === undefined) {
        issues.push({
          code: 'invalid_model_parameter',
          path: `runtime.model.parameters.${required}`,
          message: `${required} is required for the openai-compatible provider`,
        })
      }
    }
    const apiKeyEnv = parameters.apiKeyEnv
    const allowlist = manifest.extensions?.environment_allowlist
    if (
      typeof apiKeyEnv === 'string' &&
      (!Array.isArray(allowlist) || !allowlist.some((entry) => entry === apiKeyEnv))
    ) {
      issues.push({
        code: 'credential_not_allowlisted',
        path: 'extensions.environment_allowlist',
        message: `${apiKeyEnv} must be explicitly named in extensions.environment_allowlist`,
      })
    }
  }
  for (const variantName of ['control', 'candidate'] as const) {
    const source = manifest.variants[variantName].source
    if (source.startsWith('github:')) {
      const ref = source.slice(source.lastIndexOf('#') + 1)
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        issues.push({
          code: 'mutable_github_ref',
          path: `variants.${variantName}.source`,
          message: 'GitHub source must resolve to a 40-character commit before execution',
        })
      }
    }
  }

  const paths: { path: string; value: string; type: 'file' | 'directory' }[] = [
    { path: 'runtime.workspace_fixture', value: manifest.runtime.workspace_fixture, type: 'directory' },
    { path: 'suite.cases', value: manifest.suite.cases, type: 'file' },
  ]
  for (const variantName of ['control', 'candidate'] as const) {
    const config = manifest.variants[variantName].config
    if (config !== undefined) paths.push({ path: `variants.${variantName}.config`, value: config, type: 'file' })
  }
  for (const entry of paths) {
    const resolved = resolve(baseDir, entry.value)
    if (isAbsolute(entry.value) || !isWithin(baseDir, resolved)) {
      issues.push({ code: 'path_escape', path: entry.path, message: 'Path must stay within the manifest directory' })
      continue
    }
    if (options.checkPaths === false) continue
    try {
      const details = await stat(resolved)
      const matches = entry.type === 'file' ? details.isFile() : details.isDirectory()
      if (!matches) {
        issues.push({ code: 'path_type', path: entry.path, message: `Expected ${entry.type}: ${entry.value}` })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        issues.push({ code: 'path_missing', path: entry.path, message: `Path does not exist: ${entry.value}` })
      } else {
        throw error
      }
    }
  }
  return issues
}
