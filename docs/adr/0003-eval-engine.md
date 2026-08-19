# ADR-0003：自有 EvalEngine 与版本化 DSH 适配器

状态：已采纳

## 决策

核心定义：

```ts
export interface EvalEngine {
  executePair(input: ExecutePairInput): Promise<RunPair>
  evaluatePair(pair: RunPair, context: EvaluationContext): Promise<EvaluatedRunPair>
}
```

MVP 实现 `DshEvalEngine`，但所有 `0.1.0-rc.7` 特定 profile/session/event 逻辑放入 `src/adapters/dsh/v0_1.ts`。

## 理由

`dsh-eval-harness@0.3.0` 没有公开 runner/collector/assertion 库 API，直接深路径导入会依赖私有实现和旧版 DSH 包族。复制其源码也会形成分叉维护。小型自有接口能保留未来接入稳定公共 API 的空间。

## 后果

当前只实现 MVP 所需 adapter；不抽象在线流量、factorial experiment、bandit 或自动 rollout。
