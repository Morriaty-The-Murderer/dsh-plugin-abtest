import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadProjectIdentity } from './load.js'
import type { ProjectIdentity } from './schema.js'

export type IdentitySyncMode = 'check' | 'write'

export interface IdentitySyncResult {
  changedFiles: string[]
}

function quoteTypeScript(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\r', '\\r').replaceAll('\n', '\\n')}'`
}

function renderStringArray(values: readonly string[]): string {
  return `[${values.map(quoteTypeScript).join(', ')}]`
}

export function renderGeneratedIdentity(identity: ProjectIdentity): string {
  const scope = identity.npmScope === null ? 'null' : quoteTypeScript(identity.npmScope)
  return [
    '// 本文件由 pnpm identity:sync 生成，请勿手工编辑。',
    "import type { ProjectIdentity } from './schema.js'",
    '',
    'export const PROJECT_IDENTITY = {',
    '  identityVersion: 1,',
    `  displayName: ${quoteTypeScript(identity.displayName)},`,
    `  shortName: ${quoteTypeScript(identity.shortName)},`,
    `  repoSlug: ${quoteTypeScript(identity.repoSlug)},`,
    `  npmScope: ${scope},`,
    `  npmName: ${quoteTypeScript(identity.npmName)},`,
    `  cliBin: ${quoteTypeScript(identity.cliBin)},`,
    `  description: ${quoteTypeScript(identity.description)},`,
    '  legacyAliases: {',
    `    npmPackages: ${renderStringArray(identity.legacyAliases.npmPackages)},`,
    `    cliBins: ${renderStringArray(identity.legacyAliases.cliBins)},`,
    `    repoSlugs: ${renderStringArray(identity.legacyAliases.repoSlugs)},`,
    '  },',
    '} as const satisfies ProjectIdentity',
    '',
  ].join('\n')
}

export function renderPackageIdentity(packageJson: Record<string, unknown>, identity: ProjectIdentity): string {
  const currentBin = packageJson.bin
  const cliTarget =
    currentBin !== null && typeof currentBin === 'object' && !Array.isArray(currentBin)
      ? Object.values(currentBin as Record<string, unknown>).find((value): value is string => typeof value === 'string')
      : undefined
  const synchronized = {
    ...packageJson,
    name: identity.npmName,
    description: identity.description,
    bin: { [identity.cliBin]: cliTarget ?? './lib/cli/bin.js' },
  }
  return `${JSON.stringify(synchronized, undefined, 2)}\n`
}

export function renderCordisPatchIdentity(identity: ProjectIdentity): string {
  return `- insert:\n    - id: plugin-experiment-controller\n      name: ${identity.npmName}/dsh-plugin\n`
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export async function synchronizeIdentity(root: string, mode: IdentitySyncMode): Promise<IdentitySyncResult> {
  const identity = await loadProjectIdentity(root)
  const packagePath = join(root, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>

  const targets = [
    { relative: 'package.json', content: renderPackageIdentity(packageJson, identity) },
    { relative: 'src/identity/generated.ts', content: renderGeneratedIdentity(identity) },
  ]
  if ((await readText(join(root, 'cordis.patch.yml'))) !== '') {
    targets.push({ relative: 'cordis.patch.yml', content: renderCordisPatchIdentity(identity) })
  }
  const changedFiles: string[] = []
  for (const target of targets) {
    const path = join(root, target.relative)
    if ((await readText(path)) === target.content) continue
    changedFiles.push(target.relative)
    if (mode === 'write') await writeFile(path, target.content)
  }
  return { changedFiles }
}
