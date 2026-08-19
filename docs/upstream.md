# 上游契约审计

审计日期：2026-08-19（Asia/Shanghai）。本页只记录实际检查过的公开源码快照；所有结论都应在升级依赖时重新核验。

## DeepSeek Harness

- 仓库：`deepseek-ai/deepseek-harness`
- 分支：`master`
- 提交：`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 提交时间：2026-08-17T19:03:17+08:00
- npm/CLI 版本：`@deepseek-ai/dsh@0.1.0-rc.7`
- Node 契约：`^22.19.0 || >=24.0.0`
- 关键源码：
  - [`apps/cli/package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/apps/cli/package.json)
  - [`packages/boot/app-boot/src/profile.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/boot/app-boot/src/profile.ts)
  - [`packages/util/home-paths/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/util/home-paths/src/index.ts)
  - [`packages/session/session-persistence-jsonl/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-persistence-jsonl/src/index.ts)

已确认的公开行为：

1. DSH 处于 developer preview，上游明确提示会发生破坏性变更。
2. `DSH_HOME` 的解析优先级是显式配置、环境变量、`~/.dsh`。
3. profile 位于 `$DSH_HOME/profiles/<name>`，其 `package.json` 声明有序 bundle 列表，`cordis.patch.yml` 是 profile 用户层。
4. 有效配置按 bundle、profile patch、home patch、CLI `--patch` 的顺序叠加。
5. `headless` 是无服务器的一次性运行入口，CLI 形式为 `dsh --profile headless <prompt>`。
6. JSONL 会话持久层是 append-only 的 durable task-level 事实源；当前默认编码可能是多帧 Zstandard。

适配策略：集成测试精确固定 `0.1.0-rc.7`；profile、会话路径和事件解析均放在 `src/adapters/dsh/`，不让 rc 版本细节进入稳定领域类型。

## DSH OpenTelemetry

- 包：`@deepseek-ai/dsh-session-telemetry-otel@0.1.0-rc.7`
- 同一 DSH 提交：`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 关键源码：
  - [`session-telemetry-otel/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-telemetry-otel/README.md)
  - [`session-telemetry/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-telemetry/README.md)

已确认的公开行为：

1. 后端直接组合 OTel JS SDK 日志管线，并没有另造 exporter 协议。
2. 默认模式为 `DISABLED`；上传需要正向显式授权。
3. OTel 记录来自 canonical session log 的投影，传输、重试和丢失策略属于 SDK。
4. 没有部署侧 redaction listener 时，事件数据可能包含消息、工具参数、工具结果、系统提示和本地路径。

本项目因此只把 OTel correlation/span/attribute 作为可选 `ExposureDetector` 输入，不依赖 OTel 完成核心实验，也不实现 Turn/Step/LLM/Tool exporter。

## Anthropic Skill Creator

- 仓库：`anthropics/skills`
- 分支：`main`
- 提交：`0a64e398ec6bb34a494f0c347e8ccae53a862f8e`
- 提交时间：2026-08-18T12:02:05-04:00
- 许可证：Apache-2.0
- 关键源码：
  - [`skills/skill-creator/SKILL.md`](https://github.com/anthropics/skills/blob/0a64e398ec6bb34a494f0c347e8ccae53a862f8e/skills/skill-creator/SKILL.md)
  - [`agents/comparator.md`](https://github.com/anthropics/skills/blob/0a64e398ec6bb34a494f0c347e8ccae53a862f8e/skills/skill-creator/agents/comparator.md)
  - [`agents/analyzer.md`](https://github.com/anthropics/skills/blob/0a64e398ec6bb34a494f0c347e8ccae53a862f8e/skills/skill-creator/agents/analyzer.md)
  - [`references/schemas.md`](https://github.com/anthropics/skills/blob/0a64e398ec6bb34a494f0c347e8ccae53a862f8e/skills/skill-creator/references/schemas.md)

采用的设计原则：同题双臂、盲化 A/B 映射、比较完成后再揭盲、确定性 expectation 优先、均值和样本标准差并列、分析器区分观测与解释。

不会复制其 agent prompt 或 viewer schema；本项目只吸收实验设计原则，并使用自己的稳定领域模型。

## 社区 dsh-eval-harness

- 仓库：`BiBoyang/dsh-eval-harness`
- 分支：`main`
- 提交：`035d1c6e1ebf918bbb7bc2a83fd3173af15ea693`
- 提交时间：2026-08-15T05:55:50+08:00
- 包版本：`dsh-eval-harness@0.3.0`
- manifest 声明许可证：MIT
- 关键源码：
  - [`package.json`](https://github.com/BiBoyang/dsh-eval-harness/blob/035d1c6e1ebf918bbb7bc2a83fd3173af15ea693/package.json)
  - [`src/runner.ts`](https://github.com/BiBoyang/dsh-eval-harness/blob/035d1c6e1ebf918bbb7bc2a83fd3173af15ea693/src/runner.ts)
  - [`src/collector.ts`](https://github.com/BiBoyang/dsh-eval-harness/blob/035d1c6e1ebf918bbb7bc2a83fd3173af15ea693/src/collector.ts)
  - [`src/assert.ts`](https://github.com/BiBoyang/dsh-eval-harness/blob/035d1c6e1ebf918bbb7bc2a83fd3173af15ea693/src/assert.ts)

复用判断：包根公开入口只注册 `eval_run`/`eval_gate` Cordis 工具，没有导出 `runEval`、collector、assertion 或 gate 函数；`package.json` 的 exports 也没有稳定子路径。直接深路径导入会绑定其私有实现和旧版 DSH 包族，不能安全复用为核心库。

本项目将定义品牌中立的 `EvalEngine` 接口并实现最小 DSH 适配器。其按用例隔离 workspace/session、读取 JSONL/Zstd、结构断言先于 LLM judge 等思路作为行为参考，但不复制源码，也不把它作为运行时依赖。

## 升级检查清单

更新任何上游版本时必须重新验证：

- DSH profile 清单和 patch 层顺序；
- `DSH_HOME`、session root 和默认压缩格式；
- session header 与事件类型/字段；
- headless CLI 参数边界和退出码；
- bundle manifest 与 Cordis entry 形状；
- OTel 的默认模式、redaction 和字段映射；
- `dsh-eval-harness` 是否新增稳定公共库 API；
- Skill Creator 盲评和 benchmark schema 是否改变。
