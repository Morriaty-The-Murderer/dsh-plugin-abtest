<p align="center">
  <img src="./assets/social-preview.jpg" alt="DSH Plugin A/B Test：配对实验、可审计证据与更安全的发布建议" width="100%">
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

# DSH Plugin A/B Test

> 在发布 DSH 插件改动前，先用同一组任务验证它是否真的更好。

DSH Plugin A/B Test 会把当前版本（Control）和候选版本（Candidate）放进彼此隔离的 DSH 环境，逐题配对运行，再生成可复核的证据与发布建议。它适合回答三个很实际的问题：

- 新版本是否提高了任务成功率？
- 提升是否伴随明显的 token、延迟或工具错误回退？
- 结果能否由其他人用同一批输入重新跑出来？

最终结果只有四种：`PROMOTE`、`REVIEW`、`REJECT`、`INCONCLUSIVE`。其中 `PROMOTE` 也只是一项离线建议；本项目不会修改真实 DSH profile，也不会替你执行发布。

## 先看结果

下面是本仓库离线样例的一次真实输出（省略无关字段）：

```json
{
  "outcome": "PROMOTE",
  "validPairCount": 2,
  "invalidPairCount": 0,
  "triggeredRules": ["primary.superiority"]
}
```

除了这条结论，你还会得到每次运行的 session 证据、断言结果、配对差值，以及 JSON、Markdown、HTML 三种报告。结论不靠模型拍板，而是由 manifest 中的确定性规则计算。

## 快速开始

当前 MVP 从源码运行，要求 Node.js `^22.19.0 || >=24.0.0` 和 pnpm `11.19.0`。初始化样例使用离线 scripted provider，不需要模型 API key。

```bash
pnpm install --frozen-lockfile

node --import tsx src/cli/bin.ts init --output ./my-experiment --json
node --import tsx src/cli/bin.ts freeze --manifest ./my-experiment/experiment.yml --output ./evidence --json
node --import tsx src/cli/bin.ts run --manifest ./my-experiment/experiment.yml --output ./evidence --json
node --import tsx src/cli/bin.ts decision --manifest ./my-experiment/experiment.yml --output ./evidence --json
node --import tsx src/cli/bin.ts report --manifest ./my-experiment/experiment.yml --output ./evidence --json
```

打开 `./evidence/<experiment-id>/report.html` 即可查看静态报告。要测试自己的插件，只需修改初始化目录里的 `experiment.yml`、`evals/cases.yml` 和两个 variant 配置。

## 可复现真实案例

[Toolshrink 上下文预算案例](case-studies/toolshrink-context-budget/README.zh-CN.md)固定了 DSH、模型参数、社区插件 commit、确定性 fixture 和峰值费率快照。可发布摘要不会包含原始 session、工具输出、spill 内容、绝对路径或凭证。

## 怎么判断

| 结果 | 含义 | 常见下一步 |
| --- | --- | --- |
| `PROMOTE` | 证据充分、质量达到目标且 guardrail 通过 | 进入人工发布流程 |
| `REVIEW` | 有改善，但成本、延迟、错误率或波动需要判断 | 阅读 pair 证据后人工复核 |
| `REJECT` | hard gate 失败、关键用例回退或收益不足 | 修复 Candidate 后重跑 |
| `INCONCLUSIVE` | 有效样本不足、插件暴露未证实或运行环境不可比 | 补齐证据，不把它当作失败 |

默认比较任务成功率，并可约束 token、P95 延迟和工具错误率。阈值、最小有效 pair 数、重复次数与并发数都写在 manifest 中；详细字段见 [manifest 文档](docs/manifest.md)，规则优先级见 [决策文档](docs/decisions.md)。

## 为什么结果可信

- **同题配对**：Control 与 Candidate 使用相同 case、workspace fixture 和模型参数。
- **顺序平衡**：运行顺序按 pair 交替，减少固定先后顺序带来的偏差。
- **环境隔离**：每个 arm 拥有独立的 `DSH_HOME`、profile、workspace、session root 和冻结插件制品。
- **制品可追溯**：支持本地目录、tarball、精确 npm 版本和固定 GitHub commit；运行前会再次校验制品哈希。
- **暴露可证明**：从 session 事件、工具调用、插件 receipt 或 workspace 变更判断目标插件是否真正参与了运行。
- **盲评不泄露身份**：可选 comparator 只看到匿名的 A/B 输出，映射在比较完成后才揭示。
- **失败不伪装成回退**：provider outage、损坏会话、环境差异等基础设施问题进入无效证据或 `INCONCLUSIVE`。

证据默认写入：

```text
<output>/<experiment-id>/
├── manifest.lock.json
├── control-artifact.json
├── candidate-artifact.json
├── pairs/<case-id>-<repetition>/
│   ├── pair.json
│   ├── measurement.json
│   ├── control/
│   └── candidate/
├── comparison.json
├── decision.json
├── report.md
└── report.html
```

已完成的 pair 会被后续 `run` 复用；部分状态不会被静默覆盖。输入变化或证据受损时，应使用新的 output root。

## 接入真实 DSH

非 `mock` provider 会调用精确固定的 `@deepseek-ai/dsh@0.1.0-rc.7`。模型凭证等环境变量必须按名称加入 `extensions.environment_allowlist`；fingerprint 和制品元数据只记录 allowlist 哈希，不记录原始值。插件与测试命令的 stdout、stderr 和 session log 会作为原始证据保存，因此接入方仍应避免主动输出 secret。

OpenAI-compatible Chat Completions 端点可使用 `provider: openai-compatible`，并显式配置 `parameters.host`、`parameters.apiKeyEnv` 和模型 `name`。API key 实际值只留在被引用的环境变量中；manifest 中的字面密钥会被拒绝。精确字段和协议边界见 [manifest 契约](docs/manifest.md#runtime)。

CLI 是可信的本地自动化边界，可运行 manifest 中显式声明的测试命令。可选 DSH/Cordis 工具入口面向模型调用，因此会拒绝包含 `command_test` 的实验，避免把模型工具变成任意命令执行入口。

完整 CLI 包含 `init`、`validate`、`freeze`、`run`、`status`、`compare`、`decision` 和 `report`。稳定退出码及真实模型 smoke 的运行方法见 [验收记录](docs/verification.md)。

## 开发与验证

```bash
pnpm identity:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:rename
pnpm build
pnpm pack --dry-run
```

项目仍处于 MVP 阶段，当前不发布 npm 包。架构、上游契约与安全边界分别见 [架构说明](docs/architecture.md) 和 [上游审计](docs/upstream.md)。

公开名称、npm 包名和 CLI 名称由 `project.identity.json` 统一管理，并有实质 rename 测试防止旧身份残留；详见 [身份文档](docs/identity.md)。稳定协议标识不会随品牌改名。
