# Public identity 与稳定协议

`project.identity.json` 是 display name、仓库 slug、npm 名、CLI bin、描述和兼容别名的唯一真源。`package.json`、`src/identity/generated.ts`、README、DSH bundle metadata 与 CI 示例都是受控派生内容。

## 同步与检查

```bash
pnpm identity:sync
pnpm identity:check
```

`identity:sync` 只更新登记过的派生文件；`identity:check` 是只读检查，发现 drift 时返回非零退出码。

## 重命名

先查看零写入计划：

```bash
pnpm project:rename -- --dry-run \
  --display-name "Harness Pair Lab" \
  --short-name "Pair Lab" \
  --repo-slug harness-pair-lab \
  --npm-name harness-pair-lab \
  --cli-bin hpair \
  --description "Paired harness plugin experiments."
```

去掉 `--dry-run` 后，命令只修改明确登记的 JSON、TypeScript、Markdown 和 YAML 文件，并依次运行 identity check、格式检查、类型检查、测试和构建。任一验证失败会回滚受控文件；结果写入机器可读的 `rename-report.json`。该流程不访问 registry、不发布包，也不创建或重命名远程仓库。

`pnpm test:rename` 会把项目复制到临时目录，改成一组实质不同的公开身份，再验证 package metadata、CLI、生成常量、文档、构建、测试和 stale-name scan。

`legacyAliases` 为首次公开发布后的兼容入口预留。MVP 不发布这些 alias。

## 不参与重命名的标识

以下标识是协议契约，与当前 public identity 分离：

- protocol namespace：`dsh.plugin-experiment`
- manifest schema：`urn:dsh:plugin-experiment:manifest:v1`
- default data root：`$DSH_HOME/experiments`
- Cordis entry id：`plugin-experiment-controller`
- telemetry namespace：`dsh.plugin_experiment`

这些值只能通过独立兼容性设计升级，不能由 public rename 命令替换。
