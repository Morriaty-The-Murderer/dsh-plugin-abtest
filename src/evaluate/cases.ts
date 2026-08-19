import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { Case } from '../domain/types.js'

const assertionSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  kind: z.string().min(1),
  critical: z.boolean(),
  config: z.record(z.string(), z.unknown()),
})

const caseSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  task: z.string().min(1),
  critical: z.boolean(),
  assertions: z.array(assertionSchema),
  rubric: z.string().min(1).optional(),
})

const suiteSchema = z.strictObject({ schema_version: z.literal(1), cases: z.array(caseSchema).min(1) })

export async function loadCases(path: string): Promise<Case[]> {
  const result = suiteSchema.safeParse(parseYaml(await readFile(path, 'utf8')))
  if (!result.success) throw new Error(`Invalid case suite: ${result.error.message}`, { cause: result.error })
  const ids = new Set<string>()
  for (const caseDef of result.data.cases) {
    if (ids.has(caseDef.id)) throw new Error(`Duplicate case id: ${caseDef.id}`)
    ids.add(caseDef.id)
  }
  return result.data.cases.map((caseDef) => ({
    id: caseDef.id,
    task: caseDef.task,
    critical: caseDef.critical,
    assertions: caseDef.assertions,
    ...(caseDef.rubric === undefined ? {} : { rubric: caseDef.rubric }),
  }))
}
