import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Case, Run } from '../../src/domain/types.js'
import { evaluateDeterministic } from '../../src/evaluate/assertions.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function run(): Run {
  return {
    id: 'run-1',
    variant: 'candidate',
    caseId: 'case-1',
    repetition: 0,
    fingerprint: {} as Run['fingerprint'],
    evidence: {
      stdoutPath: '/tmp/stdout',
      stderrPath: '/tmp/stderr',
      processExitCode: 0,
      signal: null,
      durationMs: 10,
      startupMs: 1,
    },
    exposure: { state: 'exposed', detectors: [] },
    assertions: [],
  }
}

describe('evaluateDeterministic', () => {
  it('执行退出、文件、JSON、工具、安全、会话、清理和 required value 检查', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assertions-'))
    roots.push(root)
    await mkdir(join(root, 'result'))
    await writeFile(join(root, 'result', 'data.json'), JSON.stringify({ status: 'ok', count: 1 }))
    const caseDef: Case = {
      id: 'case-1',
      task: 'verify output',
      critical: true,
      assertions: [
        { id: 'exit', kind: 'process_exit_success', critical: true, config: {} },
        { id: 'file', kind: 'file_exists', critical: true, config: { path: 'result/data.json' } },
        {
          id: 'json',
          kind: 'json_schema',
          critical: true,
          config: { path: 'result/data.json', schema: { type: 'object', required: ['status', 'count'] } },
        },
        { id: 'tool', kind: 'forbidden_tool', critical: true, config: { names: ['dangerous'] } },
        { id: 'security', kind: 'critical_security', critical: true, config: { maximum: 0 } },
        { id: 'session', kind: 'session_readable', critical: true, config: {} },
        { id: 'cleanup', kind: 'unload_cleanup', critical: true, config: {} },
        { id: 'value', kind: 'required_value', critical: true, config: { value: 'expected' } },
      ],
    }

    const results = await evaluateDeterministic(run(), caseDef, {
      workspacePath: root,
      finalOutput: 'contains expected value',
      toolCalls: [{ name: 'read', failed: false }],
      criticalSecurityViolations: 0,
      sessionReadable: true,
      ownedEffectsRemaining: 0,
    })

    expect(results).toHaveLength(8)
    expect(results.every((result) => result.passed)).toBe(true)
  })

  it('拒绝 workspace 路径逃逸并把失败归入对应断言', async () => {
    const root = await mkdtemp(join(tmpdir(), 'assertion-escape-'))
    roots.push(root)
    const caseDef: Case = {
      id: 'case-1',
      task: 'escape',
      critical: true,
      assertions: [{ id: 'escape', kind: 'file_exists', critical: true, config: { path: '../secret' } }],
    }

    const [result] = await evaluateDeterministic(run(), caseDef, {
      workspacePath: root,
      toolCalls: [],
      criticalSecurityViolations: 0,
      sessionReadable: true,
      ownedEffectsRemaining: 0,
    })

    expect(result).toMatchObject({ assertionId: 'escape', passed: false, critical: true })
    expect(result?.message).toMatch(/escapes workspace/i)
  })
})
