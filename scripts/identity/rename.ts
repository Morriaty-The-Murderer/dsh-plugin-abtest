import { isAbsolute, resolve } from 'node:path'
import { loadProjectIdentity } from '../../src/identity/load.js'
import { renameProject } from '../../src/identity/rename.js'
import { parseRenameArguments } from '../../src/identity/rename-arguments.js'
import { runRenameVerification } from '../../src/identity/verification.js'

const parsed = parseRenameArguments(process.argv.slice(2))
const root = process.cwd()
const current = await loadProjectIdentity(root)
const npmScope =
  parsed.values['npm-scope'] === undefined
    ? current.npmScope
    : parsed.values['npm-scope'] === 'none'
      ? null
      : parsed.values['npm-scope']
const repoSlug = parsed.values['repo-slug'] ?? current.repoSlug
const requested = {
  ...current,
  displayName: parsed.values['display-name'] ?? current.displayName,
  shortName: parsed.values['short-name'] ?? current.shortName,
  repoSlug,
  npmScope,
  npmName: parsed.values['npm-name'] ?? (npmScope === null ? repoSlug : `${npmScope}/${repoSlug}`),
  cliBin: parsed.values['cli-bin'] ?? current.cliBin,
  description: parsed.values.description ?? current.description,
}
const configuredReport = parsed.values.report
const reportPath =
  configuredReport === undefined
    ? undefined
    : isAbsolute(configuredReport)
      ? configuredReport
      : resolve(root, configuredReport)
const report = await renameProject(root, requested, {
  dryRun: parsed.dryRun,
  verify: runRenameVerification,
  ...(reportPath === undefined ? {} : { reportPath }),
})
if (parsed.json) {
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
} else {
  process.stdout.write(`${parsed.dryRun ? '重命名计划' : '重命名结果'}：${report.status}\n`)
  for (const file of report.changedFiles) process.stdout.write(`- ${file}\n`)
  for (const result of report.verification) {
    process.stdout.write(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.command}\n`)
  }
}
if (report.status === 'rolled_back') process.exitCode = 1
