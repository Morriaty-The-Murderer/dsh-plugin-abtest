import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface ChildProcessInput {
  executable: string
  args: readonly string[]
  cwd: string
  environment: Readonly<Record<string, string>>
  stdoutPath: string
  stderrPath: string
  timeoutMs: number
  terminationGraceMs: number
}

export interface ChildProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  startupMs: number
  timedOut: boolean
  infrastructureError?: { code: 'process_timeout' | 'process_spawn_failure'; message: string }
}

export async function executeChildProcess(input: ChildProcessInput): Promise<ChildProcessResult> {
  if (input.timeoutMs <= 0 || input.terminationGraceMs < 0) {
    throw new Error('Process timeout must be positive and termination grace must be nonnegative')
  }
  await Promise.all([
    mkdir(dirname(input.stdoutPath), { recursive: true }),
    mkdir(dirname(input.stderrPath), { recursive: true }),
  ])
  const startedAt = performance.now()
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let firstActivityAt: number | undefined
  let timedOut = false
  let spawnError: Error | undefined

  const child = spawn(input.executable, [...input.args], {
    cwd: input.cwd,
    env: { ...input.environment },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk: Buffer) => {
    firstActivityAt ??= performance.now()
    stdoutChunks.push(chunk)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    firstActivityAt ??= performance.now()
    stderrChunks.push(chunk)
  })
  child.on('error', (error) => {
    spawnError = error
  })

  let forceTimer: NodeJS.Timeout | undefined
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    forceTimer = setTimeout(() => child.kill('SIGKILL'), input.terminationGraceMs)
  }, input.timeoutMs)

  const completion = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolveCompletion) => {
      child.once('close', (exitCode, signal) => resolveCompletion({ exitCode, signal }))
    },
  )
  clearTimeout(timeout)
  if (forceTimer !== undefined) clearTimeout(forceTimer)
  const finishedAt = performance.now()
  await Promise.all([
    writeFile(input.stdoutPath, Buffer.concat(stdoutChunks)),
    writeFile(input.stderrPath, Buffer.concat(stderrChunks)),
  ])

  const common = {
    ...completion,
    durationMs: Math.round(finishedAt - startedAt),
    startupMs: Math.round((firstActivityAt ?? finishedAt) - startedAt),
    timedOut,
  }
  if (timedOut) {
    return {
      ...common,
      infrastructureError: { code: 'process_timeout', message: `Child process exceeded ${input.timeoutMs}ms` },
    }
  }
  if (spawnError !== undefined) {
    return {
      ...common,
      infrastructureError: { code: 'process_spawn_failure', message: spawnError.message },
    }
  }
  return common
}
