# 实验清单 v1

实验清单使用严格 YAML/JSON schema。顶层 `schema_version` 当前只能是 `1`；未知字段会直接失败，只有显式 `extensions` 保留区允许扩展数据。完整示例见 `experiment.example.yml`，稳定 schema 标识为 `urn:dsh:plugin-experiment:manifest:v1`。

## Variant 来源

`variants.control.source` 与 `variants.candidate.source` 支持：

- `npm:<package>@<exact-version>`
- `github:<owner>/<repo>#<40-character-commit-sha>`
- `local:<relative-directory>`
- `tarball:<relative-file.tgz>`

npm 输入必须是精确版本；GitHub 输入必须直接固定到 40 位 commit SHA。MVP 不会把 branch 或 tag 静默解析成最终实验身份。所有 fixture、case 和 config 路径都相对于 manifest 所在目录解析，不允许绝对路径或 `..` 逃逸。

## Runtime

真实 DSH 执行只支持：

```yaml
runtime:
  dsh_version: 0.1.0-rc.7
```

其他版本会在校验阶段失败，避免 manifest 声明的契约与实际 adapter 不一致。`runtime.model.provider: mock` 使用仓库内 scripted provider；其他 provider 调用固定的 DSH CLI，并要求调用方完成相应模型配置。

`deepseek-official` 当前只接受会实际写入隔离 profile 的 `reasoningEffort` 和 `maxTokens`。未接入 profile 的字段会在校验阶段失败，避免参数只进入 fingerprint、却没有影响真实请求。

OpenAI-compatible Chat Completions 端点使用固定 provider 路由 `openai-compatible`：

```yaml
runtime:
  model:
    provider: openai-compatible
    name: gateway-model-v1
    parameters:
      host: https://gateway.example/v1
      apiKeyEnv: GATEWAY_API_KEY
      contextWindow: 128000
      maxTokens: 2048

extensions:
  environment_allowlist:
    - GATEWAY_API_KEY
    - LANG
    - TZ
```

`name` 是实际发送的 model id；`host` 会映射到 DSH pi-ai adapter 的 `baseURL`，必须是无内嵌凭据、query 或 fragment 的绝对 HTTP(S) URL。`apiKeyEnv` 只保存环境变量名，并且该变量名必须同时进入 `environment_allowlist`；字面 `apiKey`/`api_key` 会被拒绝。可选 `contextWindow` 和 `maxTokens` 必须是正安全整数。该路由固定使用 `openai-completions` 协议，不声称兼容 Responses API、Azure API key 认证或 OAuth。

## 并发与暴露证明

`execution.concurrency` 限制同时运行的 pair 数量；单个 pair 内仍按 counterbalanced 顺序依次执行两臂。

不配置 `exposure_detectors` 时，默认查找稳定的自定义 receipt：

```text
dsh.plugin-experiment/exposure
```

第三方插件不必实现该 receipt，可以改用 session 中已有的工具或事件：

```yaml
execution:
  order: counterbalanced
  concurrency: 2
  timeout_ms: 600000
  require_exposure: true
  exposure_detectors:
    - id: memory-tool-used
      kind: tool_name
      tool_name: memory_lookup
    - id: retrieval-event
      kind: session_event
      event_type: memory/retrieved
```

支持的 detector 类型为：

| `kind` | 必填字段 | 证据来源 |
| --- | --- | --- |
| `tool_name` | `tool_name` | DSH session tool call |
| `session_event` | `event_type` | DSH session event |
| `custom_receipt` | 可选 `plugin` | 稳定 receipt event |
| `workspace_file_change` | `path`、`change`，可选 `match` | 运行前后 workspace diff |
| `prompt_section` | `text` | 调用方提供的 system prompt |
| `service_operation` | `operation` | 调用方提供的 service operation |
| `otel_attribute` | `key`，可选 `value` | 调用方提供的 OTel attribute |

前三类可由标准 CLI 的 append-only session 证据直接判断。`workspace_file_change` 使用标准 CLI 生成的工作区变更清单，不读取文件内容；`match: prefix` 可证明未知文件名的受控副作用，例如插件实际生成的 spill 文件。其余三类通过公开 core detector API 支持；若标准 CLI 没有相应可选证据，它们会保持未匹配。`require_exposure: true` 时，未证实暴露的 pair 不参与效果结论，并最终进入 `INCONCLUSIVE`。

## 环境变量

只有 `extensions.environment_allowlist` 中列出的变量名会传入实验子进程：

```yaml
extensions:
  environment_allowlist:
    - LANG
    - TZ
    - MODEL_API_KEY
```

fingerprint 和制品元数据只记录 allowlist 的规范化哈希，不保存原始环境变量值。子进程的 stdout、stderr 与 session log 会原样作为运行证据保存；插件和测试命令不得主动输出 secret。

## 证据充分性门槛

`decision.minimum_valid_pairs` 限制可进入结论的有效配对数量；`decision.minimum_unique_cases` 进一步限制这些配对必须覆盖多少个不同 case。repetition 只增加同一 case 的重复观测，不会增加 unique-case 数，因此不能靠重复运行单一 case 满足跨用例证据门槛。为保持 schema v1 manifest 可读取，旧清单省略该字段时采用保守默认值 `2`；新清单应显式填写。
