# Promotion decision

决策由纯代码规则产生，LLM 只能补充解释，不能选择或覆盖结果。每个 `RunPair` 先经过完整性、启动与激活、确定性断言、生命周期与安全、可选盲评、效率指标和 post-hoc 阶段；聚合后才运行 promotion policy。

## 优先级

1. 证据充分性：有效 pair 数、有效 unique case 数、运行环境完整性、required exposure 和基础设施失败。
2. Hard gates：启动、激活、关键安全违规和关键用例回归。
3. Primary metric：Candidate 的任务成功率绝对提升。
4. Guardrails：token、P95 latency 和工具错误率增幅。

证据不足优先返回 `INCONCLUSIVE`，不会把 timeout、provider outage、会话损坏或环境不等价误算成 Candidate 失败。同一个 case 的多次 repetition 仍只计为一个 unique case；只有有效 pair 对应的 case 才计入 `validUniqueCaseCount`。

## 四种结果

- `PROMOTE`：证据充分，hard gate 全部通过，质量提升达到阈值，guardrail 未越界。
- `REVIEW`：质量有正向提升，但 token、延迟、工具错误率或高波动需要人工判断。
- `REJECT`：hard gate 失败、关键回归，或收益没有达到最低门槛。
- `INCONCLUSIVE`：有效证据不足、exposure 未证实、fingerprint 不等价，或基础设施失败占主导。

阈值的等号按通过处理。统计输出包含均值、中位数和样本标准差，但 MVP 固定写入 `significance: not_claimed`，不把小样本结果描述为统计显著。

## Case stability

对至少有两个有效 repetition 的 case，聚合器比较其 paired task-success delta。只要同一 case 出现不同 delta，该 case 就计为 unstable；有正向总体收益但存在 unstable case 时，决策进入 `REVIEW`。没有任何 case 达到两个有效 repetition 时，状态为 `not_evaluable`，不会伪装成 stable。

这是一项描述性一致性检查，不是独立性检验或统计显著性结论。同一 provider 的缓存、限流或残留状态可能让 repetition 相关；因此 repetition 不会被当成新的 unique case，后续置信区间也应按 case 聚类处理。

## Blind outcomes

只有实际完成并揭盲的有效 pair 才进入 `blindOutcomes`。报告分别保留 Candidate 胜、Control 胜和 tie 的数量；`blindWinRate` 的分母排除 tie。没有可用盲评，或盲评结果全部为 tie 时，胜率保持 `null`，不会写成 `0`。

退出码不是完整决策模型：`PROMOTE` 和 `REVIEW` 都返回 `0`；`INCONCLUSIVE` 返回 `4`；`REJECT` 返回 `5`。自动化调用方必须同时读取 JSON outcome。
