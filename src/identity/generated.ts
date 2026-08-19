// 本文件由 pnpm identity:sync 生成，请勿手工编辑。
import type { ProjectIdentity } from './schema.js'

export const PROJECT_IDENTITY = {
  identityVersion: 1,
  displayName: 'DSH Plugin A/B Test',
  shortName: 'Plugin AB',
  repoSlug: 'dsh-plugin-abtest',
  npmScope: null,
  npmName: 'dsh-plugin-abtest',
  cliBin: 'dsh-ab',
  description: 'Paired experiments and promotion gates for DSH plugins.',
  legacyAliases: {
    npmPackages: [],
    cliBins: [],
    repoSlugs: [],
  },
} as const satisfies ProjectIdentity
