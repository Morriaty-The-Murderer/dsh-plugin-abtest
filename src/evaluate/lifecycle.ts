import type { Run } from '../domain/types.js'

export function lifecycleStatus(run: Run): { bootSuccess: boolean; activationSuccess: boolean } {
  if (run.evidence.startupCheck !== undefined) {
    return {
      bootSuccess: run.evidence.startupCheck.success,
      activationSuccess: run.evidence.startupCheck.success,
    }
  }
  return {
    bootSuccess:
      run.infrastructureError === undefined && run.evidence.processExitCode === 0 && run.evidence.signal === null,
    activationSuccess: run.exposure.state === 'activated' || run.exposure.state === 'exposed',
  }
}

export function shouldAttemptSessionCollection(run: Run): boolean {
  return run.evidence.startupCheck?.success !== false
}

export function missingSessionIsInfrastructureFailure(run: Run): boolean {
  return (
    shouldAttemptSessionCollection(run) &&
    run.evidence.processExitCode === 0 &&
    run.evidence.signal === null &&
    run.infrastructureError === undefined
  )
}

export function bootAndActivationPass(run: Run): boolean {
  const status = lifecycleStatus(run)
  return status.bootSuccess && status.activationSuccess
}
