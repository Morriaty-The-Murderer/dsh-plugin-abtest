# ADR-0001：公开身份与稳定协议分离

状态：已采纳

## 决策

`project.identity.json` 是 display name、repo slug、npm name、CLI bin 和描述的唯一真源。构建时生成 `src/identity/generated.ts`，其他 public metadata 由同步脚本更新。

以下标识不随品牌重命名：

- protocol namespace：`dsh.plugin-experiment`
- manifest schema：`urn:dsh:plugin-experiment:manifest:v1`
- default data root：`$DSH_HOME/experiments`
- Cordis entry id：`plugin-experiment-controller`
- telemetry namespace：`dsh.plugin_experiment`
- exposure event：`dsh.plugin-experiment/exposure`

## 理由

品牌重命名不应破坏持久 manifest、历史实验目录、事件消费者或 Cordis patch。显式分离还能让 stale-name 检查只扫描 public identity surface，不误改协议兼容标识。

## 后果

rename 命令只能更新允许的结构化目标；legacy alias 在首次公开发布后成为兼容合同，MVP 只准备数据结构、不发布别名。
