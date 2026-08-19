# ADR-0004：暴露状态是独立证据维度

状态：已采纳

## 决策

暴露状态为 `installed | loaded | activated | exposed | unknown`，检测器返回带来源和证据引用的 `ExposureReceipt`。支持工具调用、session event、prompt contribution、service operation、OTel attribute 和自定义 receipt；第三方插件无需实现自定义 receipt。

当 `require_exposure: true` 且不能证实 exposed 时，run/pair 不用于“插件无效果”的结论，决策必须走 `INCONCLUSIVE`。

## 理由

安装或加载只证明插件存在，不证明任务实际经过插件能力路径。把未暴露误算作 Candidate 失败会系统性低估按需插件。

## 后果

多个 detector 的证据可以合并，但冲突不能静默覆盖；原始证据仍保留在 run 目录。
