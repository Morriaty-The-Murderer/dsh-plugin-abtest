import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { hashDirectory } from '../artifacts/hash.js'
import type { RuntimeFixture } from '../domain/types.js'
import { canonicalHash } from './canonical.js'

const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface RuntimeFixtureInput {
  workspacePath: string
  sandboxPolicy: string
  environmentAllowlist: readonly string[]
}

export async function createRuntimeFixture(input: RuntimeFixtureInput): Promise<RuntimeFixture> {
  const workspacePath = resolve(input.workspacePath)
  const details = await stat(workspacePath)
  if (!details.isDirectory()) {
    throw new Error(`Runtime workspace must be a directory: ${workspacePath}`)
  }
  if (input.sandboxPolicy.trim() === '') {
    throw new Error('Sandbox policy must not be empty')
  }
  for (const name of input.environmentAllowlist) {
    if (!environmentName.test(name)) {
      throw new Error(`Invalid environment variable name: ${name}`)
    }
  }
  const environmentAllowlist = [...new Set(input.environmentAllowlist)].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )
  return {
    workspacePath,
    workspaceHash: await hashDirectory(workspacePath),
    sandboxPolicy: input.sandboxPolicy,
    sandboxPolicyHash: canonicalHash(input.sandboxPolicy),
    environmentAllowlist,
    environmentAllowlistHash: canonicalHash(environmentAllowlist),
  }
}
