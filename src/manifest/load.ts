import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { type ExperimentManifest, experimentManifestSchema } from './schema.js'

export function parseManifest(value: unknown): ExperimentManifest {
  const result = experimentManifestSchema.safeParse(value)
  if (result.success) return result.data
  const details = result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
  throw new Error(`Invalid experiment manifest: ${details}`, { cause: result.error })
}

export async function loadManifest(path: string): Promise<ExperimentManifest> {
  let value: unknown
  try {
    value = parseYaml(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read experiment manifest at ${path}: ${String(error)}`, { cause: error })
  }
  return parseManifest(value)
}
