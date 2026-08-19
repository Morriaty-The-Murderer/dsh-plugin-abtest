import type { Run } from '../domain/types.js'

export function bootAndActivationPass(run: Run): boolean {
  return (
    run.infrastructureError === undefined &&
    run.evidence.processExitCode === 0 &&
    run.evidence.signal === null &&
    (run.exposure.state === 'activated' || run.exposure.state === 'exposed')
  )
}
