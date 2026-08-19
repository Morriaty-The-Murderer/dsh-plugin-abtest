import { synchronizeIdentity } from '../../src/identity/sync.js'

const mode = process.argv.includes('--write') ? 'write' : 'check'
const result = await synchronizeIdentity(process.cwd(), mode)
if (result.changedFiles.length > 0) {
  process.stdout.write(`${mode === 'write' ? '已同步' : '发现身份漂移'}：${result.changedFiles.join(', ')}\n`)
  if (mode === 'check') process.exitCode = 1
}
