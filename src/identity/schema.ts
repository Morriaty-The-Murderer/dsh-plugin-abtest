import { z } from 'zod'

const slugPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const scopePattern = /^@[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/

const uniqueStrings = z.array(z.string().min(1)).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message: 'aliases must be unique' })
  }
})

export const projectIdentitySchema = z
  .strictObject({
    identityVersion: z.literal(1),
    displayName: z.string().trim().min(1),
    shortName: z.string().trim().min(1),
    repoSlug: z.string().regex(slugPattern),
    npmScope: z.union([z.string().regex(scopePattern), z.null()]),
    npmName: z.string().min(1),
    cliBin: z.string().regex(slugPattern),
    description: z.string().trim().min(1),
    legacyAliases: z.strictObject({
      npmPackages: uniqueStrings,
      cliBins: uniqueStrings,
      repoSlugs: uniqueStrings,
    }),
  })
  .superRefine((identity, context) => {
    const expectedNpmName = identity.npmScope === null ? identity.repoSlug : `${identity.npmScope}/${identity.repoSlug}`
    if (identity.npmName !== expectedNpmName) {
      context.addIssue({
        code: 'custom',
        path: ['npmName'],
        message: `npmName must be ${expectedNpmName}`,
      })
    }
  })

export type ProjectIdentity = z.infer<typeof projectIdentitySchema>
