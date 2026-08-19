export type VariantId = 'control' | 'candidate'
export type ExposureState = 'installed' | 'loaded' | 'activated' | 'exposed' | 'unknown'
export type PromotionOutcome = 'PROMOTE' | 'REVIEW' | 'REJECT' | 'INCONCLUSIVE'

export interface Variant {
  id: VariantId
  source: string
  configPath?: string
}

export interface FrozenArtifact {
  packageName: string
  packageVersion: string
  sourceType: 'npm' | 'github' | 'local-directory' | 'local-tarball'
  sourceCommit?: string
  artifactHash: string
  pluginConfigHash: string
  dependencyLockHash: string
  dshBundleHash: string
  materializedPath: string
}

export interface RuntimeFixture {
  workspacePath: string
  workspaceHash: string
  sandboxPolicy: string
  sandboxPolicyHash: string
  environmentAllowlist: string[]
  environmentAllowlistHash: string
}

export interface ObservableHash {
  state: 'known' | 'unknown'
  hash?: string
}

export interface RuntimeFingerprint {
  schemaVersion: 1
  dshVersion: string
  nodeVersion: string
  os: string
  architecture: string
  orderedBundles: { name: string; version: string }[]
  composedProfileHash: string
  targetArtifactHash: string
  targetConfigHash: string
  nonTargetPlugins: Record<string, { version: string; artifactHash: string }>
  model: { provider: string; name: string; parameterHash: string }
  systemPrompt: ObservableHash
  toolSchema: ObservableHash
  skillCatalog: ObservableHash
  sandboxPolicyHash: string
  workspaceFixtureHash: string
  environmentAllowlistHash: string
}

export interface Case {
  id: string
  task: string
  critical: boolean
  assertions: DeterministicAssertion[]
  rubric?: string
}

export interface DeterministicAssertion {
  id: string
  kind: string
  critical: boolean
  config: Record<string, unknown>
}

export interface RunEvidence {
  stdoutPath: string
  stderrPath: string
  sessionLogPath?: string
  finalOutputPath?: string
  workspaceDiffPath?: string
  processExitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  startupMs: number
  tokenUsage?: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}

export interface ExposureReceipt {
  state: ExposureState
  detectors: { id: string; matched: boolean; evidenceRefs: string[] }[]
}

export interface AssertionResult {
  assertionId: string
  passed: boolean
  critical: boolean
  evidenceRefs: string[]
  message: string
}

export interface Run {
  id: string
  variant: VariantId
  caseId: string
  repetition: number
  fingerprint: RuntimeFingerprint
  evidence: RunEvidence
  exposure: ExposureReceipt
  assertions: AssertionResult[]
  infrastructureError?: { code: string; message: string }
}

export interface RunPair {
  id: string
  caseId: string
  repetition: number
  order: [VariantId, VariantId]
  control: Run
  candidate: Run
  integrity: { valid: true } | { valid: false; code: 'pair_integrity_failure'; paths: string[] }
}

export interface BlindComparison {
  mappingId: string
  winner: 'control' | 'candidate' | 'tie'
  anonymousWinner: 'A' | 'B' | 'tie'
  reasoning: string
  scores: { control: number; candidate: number }
}

export interface PostHocAnalysis {
  observedEvidence: string[]
  likelyExplanations: string[]
  unprovenCausalClaims: string[]
}

export interface PromotionPolicy {
  minimumValidPairs: number
  minimumAbsoluteLift: number
  hardGates: {
    bootSuccess: boolean
    activationSuccess: boolean
    criticalSecurityViolations: number
    criticalCaseRegressions: number
  }
  guardrails: {
    medianTokenIncreasePct: number
    p95LatencyIncreasePct: number
    toolErrorRateIncreasePp: number
  }
}

export interface PromotionDecision {
  outcome: PromotionOutcome
  reasons: string[]
  triggeredRules: string[]
  validPairCount: number
  invalidPairCount: number
}

export interface Experiment {
  id: string
  name: string
  hypothesis: string
  targetPlugin: string
  variants: Record<VariantId, Variant>
  cases: Case[]
  repetitions: number
  policy: PromotionPolicy
}
