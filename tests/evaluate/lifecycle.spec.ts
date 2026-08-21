import { describe, expect, it } from 'vitest'
import type { Run } from '../../src/domain/types.js'
import {
  bootAndActivationPass,
  lifecycleStatus,
  missingSessionIsInfrastructureFailure,
  shouldAttemptSessionCollection,
} from '../../src/evaluate/lifecycle.js'

function runWithSuccessfulStartupCheck(): Run {
  return {
    id: 'case-0-candidate',
    variant: 'candidate',
    caseId: 'case',
    repetition: 0,
    fingerprint: {} as Run['fingerprint'],
    evidence: {
      stdoutPath: '/private/task.stdout.log',
      stderrPath: '/private/task.stderr.log',
      processExitCode: 9,
      signal: null,
      durationMs: 20,
      startupMs: 5,
      startupCheck: {
        stdoutPath: '/private/startup.stdout.log',
        stderrPath: '/private/startup.stderr.log',
        processExitCode: 0,
        signal: null,
        durationMs: 10,
        startupMs: 4,
        success: true,
      },
    },
    exposure: { state: 'unknown', detectors: [] },
    assertions: [],
  }
}

describe('bootAndActivationPass', () => {
  it('启动预检成功后不把正式任务非零退出误判成启动失败', () => {
    expect(bootAndActivationPass(runWithSuccessfulStartupCheck())).toBe(true)
  })

  it('启动预检成功同时证明 DSH boot 与所有 entry activation 成功', () => {
    expect(lifecycleStatus(runWithSuccessfulStartupCheck())).toEqual({
      bootSuccess: true,
      activationSuccess: true,
    })
  })

  it('启动预检失败时不要求不存在的任务会话', () => {
    const run = runWithSuccessfulStartupCheck()
    if (run.evidence.startupCheck === undefined) throw new Error('startup check fixture missing')
    run.evidence.startupCheck.success = false
    run.evidence.startupCheck.processExitCode = 7
    run.evidence.processExitCode = null

    expect(shouldAttemptSessionCollection(run)).toBe(false)
    expect(missingSessionIsInfrastructureFailure(run)).toBe(false)
  })

  it('正式任务失败但启动成功时允许缺少会话且保留任务失败分类', () => {
    const run = runWithSuccessfulStartupCheck()

    expect(shouldAttemptSessionCollection(run)).toBe(true)
    expect(missingSessionIsInfrastructureFailure(run)).toBe(false)
  })

  it('正式任务成功却缺少会话时归类为采集基础设施故障', () => {
    const run = runWithSuccessfulStartupCheck()
    run.evidence.processExitCode = 0

    expect(shouldAttemptSessionCollection(run)).toBe(true)
    expect(missingSessionIsInfrastructureFailure(run)).toBe(true)
  })
})
