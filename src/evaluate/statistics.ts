export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[midpoint - 1] as number) + (sorted[midpoint] as number)) / 2
    : (sorted[midpoint] as number)
}

export function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null
  if (quantile < 0 || quantile > 1) throw new Error('Quantile must be between zero and one')
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower] as number
  const weight = position - lower
  return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight
}

export function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const average = mean(values) as number
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}
