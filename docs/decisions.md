# Promotion decision

决策由纯代码规则产生，LLM 只能补充解释，不能选择或覆盖结果。每个 `RunPair` 先经过完整性、启动与激活、确定性断言、生命周期与安全、可选盲评、效率指标和 post-hoc 阶段；聚合后才运行 promotion policy。

## 优先级

1. 证据充分性：有效 pair 数、运行环境完整性、required exposure 和基础设施失败。
2. Hard gates：启动、激活、关键安全违规和关键用例回归。
3. Primary metric：Candidate 的任务成功率绝对提升。
4. Guardrails：token、P95 latency 和工具错误率增幅。

证据不足优先返回 `INCONCLUSIVE`，不会把 timeout、provider outage、会话损坏或环境不等价误算成 Candidate 失败。

## 四种结果

- `PROMOTE`：证据充分，hard gate 全部通过，质量提升达到阈值，guardrail 未越界。
- `REVIEW`：质量有正向提升，但 token、延迟、工具错误率或高波动需要人工判断。
- `REJECT`：hard gate 失败、关键回归，或收益没有达到最低门槛。
- `INCONCLUSIVE`：有效证据不足、exposure 未证实、fingerprint 不等价，或基础设施失败占主导。

阈值的等号按通过处理。统计输出包含均值、中位数和样本标准差，但 MVP 固定写入 `significance: not_claimed`，不把小样本结果描述为统计显著。

退出码不是完整决策模型：`PROMOTE` 和 `REVIEW` 都返回 `0`；`INCONCLUSIVE` 返回 `4`；`REJECT` 返回 `5`。自动化调用方必须同时读取 JSON outcome。
