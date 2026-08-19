import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { RenameVerification } from './rename.js'

interface VerificationCommand {
  name: string
  args: string[]
}

function execute(root: string, command: VerificationCommand): Promise<RenameVerification> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, command.args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = (chunk: Buffer): void => {
      output += chunk.toString()
      if (output.length > 16_000) output = output.slice(-16_000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ command: command.name, passed: false, detail: error.message })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        command: command.name,
        passed: code === 0,
        ...(code === 0 ? {} : { detail: `${signal ?? `exit ${String(code)}`}\n${output.trim()}` }),
      })
    })
  })
}

export async function runRenameVerification(root: string): Promise<RenameVerification[]> {
  const commands: VerificationCommand[] = [
    {
      name: 'identity:check',
      args: ['--import', 'tsx', join(root, 'scripts/identity/check.ts')],
    },
    {
      name: 'format/lint',
      args: [join(root, 'node_modules/@biomejs/biome/bin/biome'), 'check', '.'],
    },
    {
      name: 'typecheck',
      args: [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'],
    },
    {
      name: 'test',
      args: [join(root, 'node_modules/vitest/vitest.mjs'), 'run'],
    },
    {
      name: 'build',
      args: [join(root, 'node_modules/tsdown/dist/run.mjs')],
    },
  ]
  const results: RenameVerification[] = []
  for (const command of commands) {
    const result = await execute(root, command)
    results.push(result)
    if (!result.passed) break
  }
  return results
}
