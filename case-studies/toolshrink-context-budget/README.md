# Toolshrink context-budget case study

This case compares two configurations of the same pinned community plugin commit. It asks the pinned DSH headless runtime to inspect deterministic build and test logs that are large enough to trigger both variants.

## Pinned inputs

- DSH: `@deepseek-ai/dsh@0.1.0-rc.7`
- Model: `deepseek-official/deepseek-v4-flash`
- Model parameters: `reasoningEffort: off`, `maxTokens: 2048`
- Plugin: `unclecode/toolshrink@3d654ab491146dd685f0b47fef94e78a14590860`
- Control budget: 16,000 characters / 160 lines
- Candidate budget: 4,000 characters / 40 lines
- Cases: two deterministic fixtures, two repetitions, counterbalanced order

The API key is read only from `DEEPSEEK_API_KEY`. It is not stored in the manifest, runtime fingerprint, generated summary, or repository.

## Use an OpenAI-compatible endpoint

To rerun through a self-hosted gateway or compatible service, first copy an ignored local manifest:

```bash
cp case-studies/toolshrink-context-budget/experiment.yml case-studies/toolshrink-context-budget/experiment.local.yml
```

Replace the local manifest's model block with:

```yaml
runtime:
  model:
    provider: openai-compatible
    name: gateway-model-v1
    parameters:
      host: https://gateway.example/v1
      apiKeyEnv: GATEWAY_API_KEY
      contextWindow: 128000
      maxTokens: 2048

extensions:
  environment_allowlist:
    - GATEWAY_API_KEY
    - LANG
    - TZ
```

Then provide `GATEWAY_API_KEY` in the ignored `.env` file and point each command's `--manifest` option at `experiment.local.yml`. Never put a literal API key in the manifest. If the model differs from the checked-in `pricing.json`, do not reuse the DeepSeek rates for a publishable cost conclusion.

## Reproduce

Use Node.js `^22.19.0` or `>=24.0.0`, pnpm `11.19.0`, and a funded DeepSeek API key. Put the key in an ignored local `.env` file instead of command history, then load it only for the run:

```bash
pnpm install --frozen-lockfile
set -a
source .env
set +a
node --import tsx src/cli/bin.ts validate --manifest case-studies/toolshrink-context-budget/experiment.yml --output .plugin-experiments/toolshrink-live --json
node --import tsx src/cli/bin.ts freeze --manifest case-studies/toolshrink-context-budget/experiment.yml --output .plugin-experiments/toolshrink-live --json
node --import tsx src/cli/bin.ts run --manifest case-studies/toolshrink-context-budget/experiment.yml --output .plugin-experiments/toolshrink-live --json
node --import tsx src/cli/bin.ts decision --manifest case-studies/toolshrink-context-budget/experiment.yml --output .plugin-experiments/toolshrink-live --json
node --import tsx src/cli/bin.ts report --manifest case-studies/toolshrink-context-budget/experiment.yml --output .plugin-experiments/toolshrink-live --json
pnpm case-study:summarize --manifest case-studies/toolshrink-context-budget/experiment.yml --evidence .plugin-experiments/toolshrink-live --output case-studies/toolshrink-context-budget/result.json
```

The exposure gate requires a newly created file below `.toolshrink-spill/`. Creating the plugin log or spill directory alone does not satisfy the gate.

## Evidence boundary

The generated `result.json` reports observed task success, exposure, token and latency measurements. It does not claim statistical significance or a causal result beyond this pinned environment. Raw session logs, tool output, spill contents, absolute paths, and credentials remain local and are never published.

The checked-in pricing snapshot uses the published peak rates as an upper-bound assumption. The generated cost estimate is not an invoice, and current provider pricing may differ.
