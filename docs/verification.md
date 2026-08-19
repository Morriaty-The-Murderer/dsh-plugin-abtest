# 验收记录

本页记录 Definition of Done 的可复现验证入口。以下结果来自 2026-08-19、Node.js `24.19.0` 与 pnpm `11.19.0`；live model smoke 不属于默认 CI。

## 验收结果

- `pnpm identity:check`：通过。
- `pnpm lint`：115 个文件通过。
- `pnpm typecheck`：通过。
- `pnpm test`：34 个测试文件通过；97 项通过，1 项 live smoke 按设计跳过。
- `pnpm test:integration`：2 个测试文件通过；7 项通过，1 项 live smoke 按设计跳过。
- `pnpm test:rename`：临时副本完成实质改名，并在副本内通过 identity、格式、类型、测试和构建。
- `pnpm build`：生成 CLI、core library 与 Cordis plugin 的 13 个 JavaScript、类型声明和 source map 文件。
- `node lib/cli/bin.js --help`：八个命令均可发现。
- `pnpm pack --dry-run`：通过；清单仅含 `lib/`、bundle patch、identity、README、LICENSE 与 package metadata，未生成本地 tarball。
- README 快速开始：用源码入口完整执行 `init → freeze → run → decision → report`，得到 `PROMOTE`、2 个有效 pair 和 JSON/Markdown/HTML 报告。

## 全量命令

```bash
pnpm install --frozen-lockfile
pnpm identity:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:rename
pnpm build
node lib/cli/bin.js --help
pnpm pack --dry-run
```

## DoD 证据映射

| DoD | 自动化证据 |
| ---: | --- |
| 1 | `tests/artifacts/` 覆盖 local directory、tarball、exact npm、固定 GitHub commit 与 frozen metadata |
| 2–3 | `tests/runtime/runner.integration.spec.ts` 与 `tests/integration/paired-experiment.e2e.spec.ts` |
| 4 | `tests/runtime/integrity.spec.ts` |
| 5–9 | paired experiment fixtures 与 `tests/decision/decision.spec.ts`，包括有益但高波动的 `REVIEW` |
| 10 | `tests/evaluate/order.spec.ts` |
| 11 | `tests/evaluate/blind.spec.ts` 与随机 A/B 映射测试 |
| 12 | scripted provider 默认测试与 `.github/workflows/ci.yml` |
| 13 | `tests/report/` |
| 14 | `pnpm identity:check` |
| 15–16 | `pnpm test:rename` |
| 17 | `tests/domain/brand-neutral.spec.ts` |
| 18 | CLI/DSH tool surface 测试；模型工具拒绝 `command_test`，无 production mutation 路径 |
| 19 | lint、typecheck、unit、integration 全量命令 |
| 20 | `pnpm pack --dry-run` 文件清单 |

补充回归覆盖包括：冻结制品篡改拦截、manifest 并发上限、可配置 exposure detector、每臂 workspace diff、session evidence、环境 allowlist、GitHub Actions pnpm 启动顺序和稳定 CLI 退出码。

## 真实 DSH 与可选 live smoke

默认集成测试已固定 `@deepseek-ai/dsh@0.1.0-rc.7`，并在隔离的双臂 profile 上执行真实 `--dump-config`。它验证 DSH 包、profile 与 CLI 契约，但不产生付费模型调用。

可选 live smoke 会读取调用方显式提供的非 `mock` manifest，在临时 evidence root 中真实执行 `freeze` 和 `run`：

```bash
DSH_PLUGIN_EXPERIMENT_LIVE=1 \
DSH_PLUGIN_EXPERIMENT_LIVE_MANIFEST=/absolute/path/to/experiment.yml \
pnpm exec vitest run tests/integration/dsh-contract.spec.ts
```

调用方需要自行准备模型 provider 与凭证 allowlist。此次验收没有提供真实模型 manifest 或凭证，因此 live smoke 未执行；这项跳过不应被表述为真实模型链路已通过。
