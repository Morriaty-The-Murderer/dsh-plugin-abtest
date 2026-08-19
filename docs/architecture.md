# 架构说明

## 核心边界

控制器只负责编排，不在自身进程内加载 Control 或 Candidate。每个 `Run` 都由单独子进程执行，并获得独立的 `DSH_HOME`、profile、workspace clone、session root、环境 allowlist 和冻结插件制品。

```text
Experiment Controller
├── Control Runner process
│   ├── isolated DSH_HOME/profile
│   ├── isolated workspace/session root
│   └── FrozenArtifact(control)
└── Candidate Runner process
    ├── isolated DSH_HOME/profile
    ├── isolated workspace/session root
    └── FrozenArtifact(candidate)
```

领域层只使用 `Experiment`、`Variant`、`FrozenArtifact`、`RuntimeFixture`、`RuntimeFingerprint`、`Case`、`Run`、`RunPair`、`ExposureReceipt`、`AssertionResult`、`BlindComparison`、`PostHocAnalysis`、`PromotionPolicy` 和 `PromotionDecision`。当前公开项目名称不会进入 schema、存储路径或事件名称。

## 组件

- `identity`：读取 `project.identity.json`，生成 public metadata，并提供有边界的 rename plan。
- `manifest`：严格解析 schema v1；未知字段失败。
- `artifacts`：把 npm、GitHub commit、本地目录和本地 tarball 冻结为内容寻址制品。
- `runtime`：准备双臂目录、规范化 fingerprint、比较非目标差异、运行子进程。
- `adapters/dsh`：封装 DSH rc 版本的 profile、CLI、session-log 和事件解析。
- `evaluate`：先完整性、启动/激活、确定性断言和生命周期安全，再可选盲评。
- `decision`：纯函数计算 `PROMOTE | REVIEW | REJECT | INCONCLUSIVE`。
- `report`：从 canonical comparison/decision 生成 JSON、Markdown 和静态 HTML。
- `cli`：薄命令层；所有行为委托给 core。
- `dsh-plugin`：可选 Cordis 工具入口；不提供任意 shell 和生产 profile mutation。

## 数据流

1. `validate` 严格解析 manifest 和 fixture 路径。
2. `freeze` 将两个 variant 解析为不可变 `FrozenArtifact` 并写 `manifest.lock.json`。
3. `run` 在声明的并发上限内调度 pair，并按 counterbalanced 顺序执行每对的两臂；每臂产生 runtime fingerprint 和原始证据。
4. fingerprint 比较只允许声明的目标插件制品/配置差异；其他差异使 pair 成为 `pair_integrity_failure`。
5. session adapter 从 append-only 日志提取事件，runner 另存 workspace added/modified/deleted diff；OTel 只补充可选 exposure correlation。
6. deterministic assertions 先运行；盲评只看到 task、随机映射的匿名输出和允许的断言摘要，映射在比较结束后才单独写入。
7. paired delta 先按 pair 计算，再聚合均值、中位数和样本标准差。
8. deterministic policy engine 产生四态决策，报告层只解释、不能改写结果。

## 安全边界

- 默认拒绝未固定的 GitHub branch 作为最终制品身份。
- 不把 secret-bearing 环境值写入 fingerprint，只写 allowlist 名称和值哈希的整体摘要。
- 所有文件输出限制在显式 output root；解析路径时拒绝逃逸。
- 运行器使用 argv 数组启动进程，不经 shell 拼接命令。
- CLI 只执行用户本地 manifest 显式声明的测试命令；面向模型的 DSH 工具入口拒绝带 `command_test` 的用例。
- 冻结制品在每次 `run` 前重新计算内容哈希，冻结后发生修改会直接终止实验。
- `PROMOTE` 只是建议，不写真实 profile。
- OTel 默认不是必需输入，也不自动启用或上传。
