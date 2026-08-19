export interface CliIo {
  stdout(value: string): void
  stderr(value: string): void
}

export function emit(io: CliIo, value: unknown, json: boolean, error = false): void {
  const text = json
    ? `${JSON.stringify(value)}\n`
    : `${typeof value === 'string' ? value : JSON.stringify(value, undefined, 2)}\n`
  if (error) io.stderr(text)
  else io.stdout(text)
}
