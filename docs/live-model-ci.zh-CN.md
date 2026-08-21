# 受保护的真实模型 CI

`Protected live-model smoke` 工作流会用付费 DeepSeek provider 运行固定的 Toolshrink 案例。它与普通 PR、push CI 分离，不会因为日常提交自动产生模型费用。

## 安全边界

- 只能通过 `workflow_dispatch` 手工启动。
- 操作者必须明确勾选“本次运行会调用付费模型”。
- 前置 job 会在进入受保护 job 前拒绝 tag 和除 `master` 外的所有分支。
- 付费 job 引用 `live-model` GitHub Environment，工作流权限只有 `contents: read`。
- `DEEPSEEK_API_KEY` 只注入实际执行实验的步骤。
- 原始 session、工具输出、spill 文件、workspace diff、报告和 evidence 目录只存在于临时 runner；唯一上传的产物是脱敏后的 `result.json`，保留 7 天。
- `REJECT`、`INCONCLUSIVE` 是合法实验结论，不会让 CI 失败；配置、执行或脱敏失败才会失败。

手工触发只负责控制运行时机与费用，并不等于安全保护。首次运行前必须先配置 GitHub Environment。

## GitHub 一次性配置

仓库管理员需要在 **Settings → Environments** 中完成：

1. 创建名称严格为 `live-model` 的 Environment。
2. 把允许部署的 branch/tag 限制为 `master` 分支。
3. 在仓库套餐和可见性支持时，配置至少一名 required reviewer。
4. 添加 Environment Secret：`DEEPSEEK_API_KEY`。
5. 添加 Environment Variable：`LIVE_MODEL_CI_PROTECTED=true`。

API Key 只放在 Environment Secret 中，不要再创建同名的 repository-level Secret。如果仓库只有一名维护者，在有第二名合格 reviewer 前不要启用 **Prevent self-review**，否则发起者无法审批自己触发的 job。

workflow 引用一个尚不存在的 Environment 时，GitHub 可能自动创建一个没有保护规则的 Environment。`LIVE_MODEL_CI_PROTECTED` 和 Secret 缺失检查会让这种不完整配置在调用 provider 前失败，但它们不能替代 GitHub 的保护规则。

## 手工运行

workflow 已进入默认分支且 Environment 配置完成后：

1. 打开 **Actions → Protected live-model smoke → Run workflow**。
2. 选择 `master`。
3. 勾选 **confirm_paid_run**。
4. 启动工作流，并在提示时审批 `live-model` Environment。
5. 下载 `live-model-summary`，复核其中的 `result.json`。

不要无判断地点击 rerun：每次成功重跑付费步骤都会产生一组新的模型调用。

## 如何解读结果

GitHub Actions 显示绿色，只代表受保护 workflow 已完整执行并生成脱敏产物，不代表 Candidate 已通过实验。必须把 workflow 状态与 `result.decision.outcome` 分开看。

每个付费任务开始前，runner 会先在独立 workspace 中执行不调用模型的 DSH 启动审计：启动专用的 `experiment-startup` profile，使用相同的 base 与目标插件 entry，但移除 headless 任务 runner；等待整棵插件树加载完成后主动关闭。这个过程不提交任务，也不调用 provider。公开摘要的 `execution` 区域会分别报告：

- 实际执行及通过的启动检查数；
- 付费任务进程成功数与失败数；
- 因启动失败而未执行的任务数；
- 成功采集 session 的运行数；
- `startup_check_failed`、`task_process_failed`、`session_collection_failure` 等脱敏失败分类。

`startup_check_failed` 表示 DSH 或插件 activation 在付费任务前失败，该任务不会继续执行；`task_process_failed` 表示启动成功，但付费任务进程未成功完成。因此 `usage.runsWithUsage` 可能小于 `usage.runs`；只要存在缺失的 usage 证据，`cost.complete` 就是 `false`，此时成本估算不能当作本次运行的完整费用。

## 仓库侧验证

以下命令不需要模型 Key，用于验证提交到仓库的 workflow 契约：

```bash
pnpm exec vitest run tests/ci/workflow.spec.ts
pnpm lint
pnpm typecheck
```

这些命令只能验证仓库文件和不调用模型的启动审计契约，不能证明远端 Environment、reviewer 规则、Variable、Secret 或付费 provider 任务正常；首次触发前必须在 GitHub 设置页单独复核，并在运行后单独检查产物结论。
