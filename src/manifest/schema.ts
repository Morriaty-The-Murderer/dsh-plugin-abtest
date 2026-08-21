import { z } from 'zod'

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const relativePath = z.string().trim().min(1)
const variantSource = z.string().regex(/^(?:npm|github|local|tarball):.+/)
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
)

const variantSchema = z.strictObject({
  source: variantSource,
  config: relativePath.optional(),
})

const exposureDetectorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: identifier, kind: z.literal('tool_name'), tool_name: z.string().trim().min(1) }),
  z.strictObject({ id: identifier, kind: z.literal('session_event'), event_type: z.string().trim().min(1) }),
  z.strictObject({ id: identifier, kind: z.literal('prompt_section'), text: z.string().min(1) }),
  z.strictObject({ id: identifier, kind: z.literal('service_operation'), operation: z.string().trim().min(1) }),
  z.strictObject({
    id: identifier,
    kind: z.literal('otel_attribute'),
    key: z.string().trim().min(1),
    value: jsonValue.optional(),
  }),
  z.strictObject({ id: identifier, kind: z.literal('custom_receipt'), plugin: z.string().trim().min(1).optional() }),
])

export const experimentManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  experiment: z.strictObject({
    id: identifier,
    name: z.string().trim().min(1),
    hypothesis: z.string().trim().min(1),
  }),
  target: z.strictObject({
    plugin: z.string().trim().min(1),
  }),
  variants: z.strictObject({
    control: variantSchema,
    candidate: variantSchema,
  }),
  runtime: z.strictObject({
    dsh_version: z.string().trim().min(1),
    profile: identifier,
    model: z.strictObject({
      provider: identifier,
      name: z.string().trim().min(1),
      parameters: z.record(z.string(), jsonValue).optional(),
    }),
    workspace_fixture: relativePath,
    sandbox: identifier,
  }),
  suite: z.strictObject({
    cases: relativePath,
    repetitions: z.number().int().positive().max(10_000),
  }),
  execution: z.strictObject({
    order: z.literal('counterbalanced'),
    concurrency: z.number().int().positive().max(128),
    timeout_ms: z.number().int().positive().max(86_400_000),
    require_exposure: z.boolean(),
    exposure_detectors: z.array(exposureDetectorSchema).min(1).max(128).optional(),
  }),
  decision: z.strictObject({
    minimum_valid_pairs: z.number().int().positive(),
    minimum_unique_cases: z.number().int().positive().default(2),
    hard_gates: z.strictObject({
      boot_success: z.boolean(),
      activation_success: z.boolean(),
      critical_security_violations: z.number().int().nonnegative(),
      critical_case_regressions: z.number().int().nonnegative(),
    }),
    primary: z.strictObject({
      metric: z.literal('task_success_rate'),
      policy: z.literal('superiority'),
      minimum_absolute_lift: z.number().min(0).max(1),
    }),
    guardrails: z.strictObject({
      median_token_increase_pct: z.number().nonnegative(),
      p95_latency_increase_pct: z.number().nonnegative(),
      tool_error_rate_increase_pp: z.number().nonnegative().max(100),
    }),
  }),
  extensions: z.record(z.string(), z.unknown()).optional(),
})

export type ExperimentManifest = z.infer<typeof experimentManifestSchema>
