export interface DshCommand {
  executable: string
  args: string[]
}

export function createHeadlessCommand(dshExecutable: string, task: string, profile = 'experiment'): DshCommand {
  if (task.trim() === '') throw new Error('DSH task must not be empty')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) throw new Error(`Invalid DSH profile name: ${profile}`)
  return { executable: dshExecutable, args: ['--profile', profile, task] }
}
