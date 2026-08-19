import type { RuntimeFingerprint } from '../domain/types.js'

export const TARGET_VARIANT_DIFFERENCES = ['targetArtifactHash', 'targetConfigHash'] as const

export type PairIntegrityResult =
  | { valid: true }
  | {
      valid: false
      failure: { code: 'pair_integrity_failure'; paths: string[] }
    }

function differentPaths(left: unknown, right: unknown, prefix = ''): string[] {
  if (Object.is(left, right)) {
    return []
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const paths: string[] = []
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      paths.push(...differentPaths(left[index], right[index], `${prefix}[${index}]`))
    }
    return paths
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
    return [...keys]
      .sort((a, b) => a.localeCompare(b, 'en'))
      .flatMap((key) => differentPaths(leftRecord[key], rightRecord[key], prefix === '' ? key : `${prefix}.${key}`))
  }
  return [prefix]
}

function isAllowed(path: string, allowedPaths: readonly string[]): boolean {
  return allowedPaths.some(
    (allowed) => path === allowed || path.startsWith(`${allowed}.`) || path.startsWith(`${allowed}[`),
  )
}

export function compareFingerprints(
  control: RuntimeFingerprint,
  candidate: RuntimeFingerprint,
  allowedPaths: readonly string[] = TARGET_VARIANT_DIFFERENCES,
): PairIntegrityResult {
  const paths = differentPaths(control, candidate).filter((path) => !isAllowed(path, allowedPaths))
  return paths.length === 0 ? { valid: true } : { valid: false, failure: { code: 'pair_integrity_failure', paths } }
}
