import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface DshCommand {
  executable: string
  args: string[]
}

export function createHeadlessCommand(dshExecutable: string, task: string, profile = 'experiment'): DshCommand {
  if (task.trim() === '') throw new Error('DSH task must not be empty')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) throw new Error(`Invalid DSH profile name: ${profile}`)
  return { executable: dshExecutable, args: ['--profile', profile, task] }
}

const STARTUP_AUDIT_SCRIPT = `
const profileBoot = await import(process.argv[1]);
const { loadLayeredEnv } = await import(process.argv[2]);
if (typeof profileBoot.runProfile !== 'function') throw new Error('Pinned DSH profile boot entry is unavailable');
const { shutdown } = await profileBoot.runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: process.argv[3],
  patchFiles: [],
  args: [],
});
await shutdown.shutdown(0);
`

function profileBootModule(dshExecutable: string): string {
  const launcher = readFileSync(dshExecutable, 'utf8')
  const match = launcher.match(/import\("\.\/(profile-boot-[^"]+\.js)"\)/)
  if (match?.[1] === undefined) throw new Error('Pinned DSH profile boot entry is unavailable')
  return pathToFileURL(join(dirname(dshExecutable), match[1])).href
}

export function createProfileStartupCommand(
  nodeExecutable: string,
  dshExecutable: string,
  profile = 'experiment-startup',
): DshCommand {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) throw new Error(`Invalid DSH profile name: ${profile}`)
  const resolvedDshExecutable = realpathSync(dshExecutable)
  return {
    executable: nodeExecutable,
    args: [
      '--input-type=module',
      '--eval',
      STARTUP_AUDIT_SCRIPT,
      profileBootModule(resolvedDshExecutable),
      pathToFileURL(createRequire(resolvedDshExecutable).resolve('@deepseek-ai/dsh-app-boot')).href,
      profile,
    ],
  }
}
