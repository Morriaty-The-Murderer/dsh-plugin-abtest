# ADR-0005：四态决策由确定性代码拥有

状态：已采纳

## 决策

决策顺序固定为：证据充分性/完整性 → hard gates → primary quality policy → guardrails → `PROMOTE | REVIEW | REJECT | INCONCLUSIVE`。

- 完整性失败、有效 pair 不足、暴露不足或基础设施失败占主导：`INCONCLUSIVE`
- hard gate 或 critical regression 失败：`REJECT`
- primary 通过且 guardrails 全部可接受：`PROMOTE`
- primary 有益但非关键成本、延迟或高波动需要人工判断：`REVIEW`
- 没有足够收益覆盖新增成本：`REJECT`

LLM 只能生成 `BlindComparison` 或解释 `PostHocAnalysis`，不能选择或覆盖最终 outcome。

## 理由

决策合同必须可测试、可回放、可审计；把 gate 交给生成模型会让同一证据得到不稳定结论。

## 后果

每个 outcome 都需要专门 fixture 和单元测试，报告必须同时呈现规则输入和触发原因。
