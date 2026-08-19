import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/bin.ts', 'src/dsh-plugin/index.ts'],
  format: ['esm'],
  fixedExtension: false,
  hash: false,
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'lib',
})
