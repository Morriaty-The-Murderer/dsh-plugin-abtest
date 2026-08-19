import type { ObservableHash, RuntimeFingerprint } from '../domain/types.js'
import { canonicalHash } from './canonical.js'

export interface RuntimeFingerprintInput {
  dshVersion: string
  nodeVersion: string
  os: string
  architecture: string
  orderedBundles: readonly { name: string; version: string }[]
  composedProfile: unknown
  targetArtifactHash: string
  targetConfig: unknown
  nonTargetPlugins: Readonly<Record<string, { version: string; artifactHash: string }>>
  model: { provider: string; name: string; parameters: unknown }
  systemPrompt?: unknown
  toolSchema?: unknown
  skillCatalog?: unknown
  sandboxPolicyHash: string
  workspaceFixtureHash: string
  environmentAllowlistHash: string
}

function observableHash(value: unknown, observable: boolean): ObservableHash {
  return observable ? { state: 'known', hash: canonicalHash(value) } : { state: 'unknown' }
}

function copyNonTargetPlugins(
  plugins: Readonly<Record<string, { version: string; artifactHash: string }>>,
): Record<string, { version: string; artifactHash: string }> {
  return Object.fromEntries(
    Object.entries(plugins)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([name, identity]) => [name, { ...identity }]),
  )
}

export function createRuntimeFingerprint(input: RuntimeFingerprintInput): RuntimeFingerprint {
  return {
    schemaVersion: 1,
    dshVersion: input.dshVersion,
    nodeVersion: input.nodeVersion,
    os: input.os,
    architecture: input.architecture,
    orderedBundles: input.orderedBundles.map((bundle) => ({ ...bundle })),
    composedProfileHash: canonicalHash(input.composedProfile),
    targetArtifactHash: input.targetArtifactHash,
    targetConfigHash: canonicalHash(input.targetConfig),
    nonTargetPlugins: copyNonTargetPlugins(input.nonTargetPlugins),
    model: {
      provider: input.model.provider,
      name: input.model.name,
      parameterHash: canonicalHash(input.model.parameters),
    },
    systemPrompt: observableHash(input.systemPrompt, Object.hasOwn(input, 'systemPrompt')),
    toolSchema: observableHash(input.toolSchema, Object.hasOwn(input, 'toolSchema')),
    skillCatalog: observableHash(input.skillCatalog, Object.hasOwn(input, 'skillCatalog')),
    sandboxPolicyHash: input.sandboxPolicyHash,
    workspaceFixtureHash: input.workspaceFixtureHash,
    environmentAllowlistHash: input.environmentAllowlistHash,
  }
}
