export interface ParsedRenameArguments {
  dryRun: boolean
  json: boolean
  values: Record<string, string>
}

export function parseRenameArguments(args: readonly string[]): ParsedRenameArguments {
  const values: Record<string, string> = {}
  let dryRun = false
  let json = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') continue
    if (argument === '--dry-run') dryRun = true
    else if (argument === '--json') json = true
    else if (argument?.startsWith('--')) {
      const value = args[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} 需要一个值`)
      values[argument.slice(2)] = value
      index += 1
    } else {
      throw new Error(`无法识别的参数：${String(argument)}`)
    }
  }
  return { dryRun, json, values }
}
