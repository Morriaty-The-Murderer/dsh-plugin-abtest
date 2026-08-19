import { createHash } from 'node:crypto'

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers')
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError('Canonical JSON does not support cyclic values')
    }
    seen.add(value)
    const normalized = value.map((entry) => {
      if (entry === undefined) {
        throw new TypeError('Canonical JSON does not support undefined array entries')
      }
      return normalize(entry, seen)
    })
    seen.delete(value)
    return normalized
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      throw new TypeError('Canonical JSON does not support cyclic values')
    }
    seen.add(value)
    const record = value as Record<string, unknown>
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const entry = record[key]
      if (entry === undefined) {
        throw new TypeError(`Canonical JSON does not support undefined at ${key}`)
      }
      normalized[key] = normalize(entry, seen)
    }
    seen.delete(value)
    return normalized
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`)
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()))
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex')
}
