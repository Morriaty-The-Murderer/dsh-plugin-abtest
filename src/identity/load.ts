import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ProjectIdentity, projectIdentitySchema } from './schema.js'

export const PROJECT_IDENTITY_FILENAME = 'project.identity.json'

export async function loadProjectIdentity(root: string): Promise<ProjectIdentity> {
  const path = join(root, PROJECT_IDENTITY_FILENAME)
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Failed to read ${PROJECT_IDENTITY_FILENAME} at ${path}: ${String(error)}`, { cause: error })
  }
  return projectIdentitySchema.parse(value)
}
