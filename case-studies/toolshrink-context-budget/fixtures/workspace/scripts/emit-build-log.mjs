for (let index = 1; index <= 260; index += 1) {
  const moduleName = `module-${String(index).padStart(3, '0')}`
  process.stdout.write(
    `2026-08-21T00:00:00.000Z INFO build ${moduleName} compiled files=18 warnings=0 cache=miss duration=42ms\n`,
  )
}
process.stdout.write('BUILD_RESULT=BUILD_LOG_OK\n')
