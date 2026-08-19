import { describe, expect, it } from 'vitest'
import { EXIT_CODES, exitCodeForDecision } from '../../src/cli/exit-codes.js'
import { runCli } from '../../src/cli/main.js'

describe('CLI surface', () => {
  it('帮助中列出八个稳定命令', async () => {
    const lines: string[] = []
    const code = await runCli(['--help'], {
      stdout: (value) => lines.push(value),
      stderr: (value) => lines.push(value),
    })
    const help = lines.join('\n')

    expect(code).toBe(EXIT_CODES.success)
    for (const command of ['init', 'validate', 'freeze', 'run', 'status', 'compare', 'report', 'decision']) {
      expect(help).toContain(command)
    }
  })

  it('决策退出码稳定', () => {
    expect(exitCodeForDecision('PROMOTE')).toBe(0)
    expect(exitCodeForDecision('REVIEW')).toBe(0)
    expect(exitCodeForDecision('INCONCLUSIVE')).toBe(4)
    expect(exitCodeForDecision('REJECT')).toBe(5)
  })

  it('验证错误返回 2 而不是内部错误', async () => {
    const errors: string[] = []
    const code = await runCli(['validate', '--manifest', '/definitely/missing.yml', '--json'], {
      stdout: () => undefined,
      stderr: (value) => errors.push(value),
    })

    expect(code).toBe(EXIT_CODES.validationError)
    expect(JSON.parse(errors.join(''))).toMatchObject({ ok: false, code: 'validation_error' })
  })
})
