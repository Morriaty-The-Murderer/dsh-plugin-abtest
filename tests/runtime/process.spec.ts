import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeChildProcess } from '../../src/runtime/process.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('executeChildProcess', () => {
  it('无 shell 运行命令并持久化 stdout/stderr', async () => {
    const root = await mkdtemp(join(tmpdir(), 'child-process-'))
    roots.push(root)
    const result = await executeChildProcess({
      executable: process.execPath,
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
      cwd: root,
      environment: { LANG: 'C' },
      stdoutPath: join(root, 'stdout.log'),
      stderrPath: join(root, 'stderr.log'),
      timeoutMs: 5_000,
      terminationGraceMs: 100,
    })

    expect(result).toMatchObject({ exitCode: 0, signal: null, timedOut: false })
    expect(await readFile(join(root, 'stdout.log'), 'utf8')).toBe('out')
    expect(await readFile(join(root, 'stderr.log'), 'utf8')).toBe('err')
  })

  it('超时后终止子进程并显式分类', async () => {
    const root = await mkdtemp(join(tmpdir(), 'child-timeout-'))
    roots.push(root)
    const result = await executeChildProcess({
      executable: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      environment: {},
      stdoutPath: join(root, 'stdout.log'),
      stderrPath: join(root, 'stderr.log'),
      timeoutMs: 30,
      terminationGraceMs: 30,
    })

    expect(result.timedOut).toBe(true)
    expect(result.infrastructureError?.code).toBe('process_timeout')
    expect(result.durationMs).toBeGreaterThanOrEqual(20)
  })
})
