# Toolshrink 上下文预算真实案例

本案例使用同一个固定社区插件提交，对比两套配置。固定 DSH headless 运行时读取可确定复现的构建日志和测试日志；两份日志都足以触发两臂的裁剪。

## 固定输入

- DSH：`@deepseek-ai/dsh@0.1.0-rc.7`
- 模型：`deepseek-official/deepseek-v4-flash`
- 模型参数：`reasoningEffort: off`、`maxTokens: 2048`
- 插件：`unclecode/toolshrink@3d654ab491146dd685f0b47fef94e78a14590860`
- Control 预算：16,000 字符 / 160 行
- Candidate 预算：4,000 字符 / 40 行
- 用例：2 个确定性 fixture、每个重复 2 次、顺序 counterbalanced

API key 只从 `DEEPSEEK_API_KEY` 读取，不进入 manifest、运行指纹、生成摘要或仓库。

## 使用 OpenAI-compatible 端点

如需通过自建网关或兼容服务复跑，请先复制一份已忽略的本地 manifest：

```bash
cp case-studies/toolshrink-context-budget/experiment.yml case-studies/toolshrink-context-budget/experiment.local.yml
```

把本地 manifest 的模型块替换为：

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

然后在已忽略的 `.env` 中提供 `GATEWAY_API_KEY`，运行命令时把 `--manifest` 改为 `experiment.local.yml`。字面 API key 不得写入 manifest。若 model 与仓库内 `pricing.json` 不同，不得套用现有 DeepSeek 费率生成可发布成本结论。

## 手工复跑

使用 Node.js `^22.19.0` 或 `>=24.0.0`、pnpm `11.19.0`，并准备有余额的 DeepSeek API key。请把 key 放进已忽略的本地 `.env` 文件，不要写进命令历史；仅在复跑 shell 中加载：

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

暴露门要求 `.toolshrink-spill/` 下新增真实 spill 文件。仅创建插件日志或空目录不能通过该门槛。

## 证据边界

生成的 `result.json` 只报告观测到的任务成功、暴露证明、token 和延迟，不声称统计显著，也不把固定环境内的结果外推成普遍因果结论。原始 session、工具输出、spill 内容、绝对路径和凭证只保留在本地，不发布。

仓库内价格快照按公开峰值费率估算成本上限。生成的成本只是估算，不是账单；供应商当前价格可能已经变化。
