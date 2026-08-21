import { isAbsolute, join, relative, resolve } from 'node:path'
import type { VariantId } from '../domain/types.js'

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface ArmLayout {
  root: string
  home: string
  profile: string
  startupProfile: string
  workspace: string
  startupWorkspace: string
  sessionRoot: string
  artifact: string
  stdout: string
  stderr: string
  startupStdout: string
  startupStderr: string
}

export interface PairLayout {
  experimentRoot: string
  pairRoot: string
  pairFile: string
  control: ArmLayout
  candidate: ArmLayout
}

function assertIdentifier(value: string, label: string): void {
  if (!safeIdentifier.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
}

function assertWithin(root: string, path: string): void {
  const child = relative(root, path)
  if (child.startsWith('..') || isAbsolute(child)) {
    throw new Error(`Generated path escapes experiment root: ${path}`)
  }
}

function armLayout(pairRoot: string, variant: VariantId): ArmLayout {
  const root = join(pairRoot, variant)
  return {
    root,
    home: join(root, 'home'),
    profile: join(root, 'home', 'profiles', 'experiment'),
    startupProfile: join(root, 'home', 'profiles', 'experiment-startup'),
    workspace: join(root, 'workspace'),
    startupWorkspace: join(root, 'startup-workspace'),
    sessionRoot: join(root, 'sessions'),
    artifact: join(root, 'artifact'),
    stdout: join(root, 'stdout.log'),
    stderr: join(root, 'stderr.log'),
    startupStdout: join(root, 'startup.stdout.log'),
    startupStderr: join(root, 'startup.stderr.log'),
  }
}

export function createPairLayout(
  outputRoot: string,
  experimentId: string,
  caseId: string,
  repetition: number,
): PairLayout {
  assertIdentifier(experimentId, 'experiment id')
  assertIdentifier(caseId, 'case id')
  if (!Number.isSafeInteger(repetition) || repetition < 0) {
    throw new Error(`Invalid repetition: ${repetition}`)
  }
  const experimentRoot = resolve(outputRoot, experimentId)
  const pairRoot = join(experimentRoot, 'pairs', `${caseId}-${repetition}`)
  const layout: PairLayout = {
    experimentRoot,
    pairRoot,
    pairFile: join(pairRoot, 'pair.json'),
    control: armLayout(pairRoot, 'control'),
    candidate: armLayout(pairRoot, 'candidate'),
  }
  for (const path of [
    layout.pairRoot,
    layout.pairFile,
    ...Object.values(layout.control),
    ...Object.values(layout.candidate),
  ]) {
    assertWithin(experimentRoot, path)
  }
  return layout
}
