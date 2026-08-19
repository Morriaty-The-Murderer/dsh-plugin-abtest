import { synchronizeIdentity } from '../../src/identity/sync.js'

const result = await synchronizeIdentity(process.cwd(), 'check')
if (result.changedFiles.length > 0) {
  process.stderr.write(`项目身份未同步：${result.changedFiles.join(', ')}\n请运行 pnpm identity:sync。\n`)
  process.exitCode = 1
} else {
  process.stdout.write('项目身份已同步。\n')
}
