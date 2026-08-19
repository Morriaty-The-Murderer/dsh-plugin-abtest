# DSH 插件配对实验框架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可安全重命名、离线可复现、以配对证据和确定性 promotion gate 评估 DSH 插件的 TypeScript 单包项目。

**Architecture:** 控制器以独立子进程运行 Control/Candidate，每臂拥有独立 DSH home、profile、workspace 和 session root。核心领域模型与当前品牌解耦；DSH rc 细节封装在版本适配器；确定性断言和四态决策拥有最终裁决权，盲评与 OTel 都是可选输入。

**Tech Stack:** Node.js `^22.19.0 || >=24`、TypeScript ESM、pnpm、Vitest、Zod、Commander、YAML、esbuild/tsdown、Biome、`@deepseek-ai/dsh@0.1.0-rc.7` 集成契约。

## Global Constraints

- public identity 只来自 `project.identity.json`；稳定协议 namespace 不参与重命名。
- Control/Candidate 绝不在同一个 DSH 进程运行。
- DSH append-only session log 是 durable task-level source of truth。
- OTel 只作为可选 telemetry/exposure 输入，不实现新的 exporter。
- manifest 未知字段失败；GitHub branch 必须解析到 commit 才能成为冻结身份。
- 不记录凭据或原始 secret-bearing 环境值。
- `PROMOTE` 只给出建议，不修改真实 DSH profile。
- 默认 CI 不需要付费模型 API；live smoke 仅由环境变量显式开启。
- 不发布 npm、不创建或改名远程仓库、不执行自动生产 promotion。
- 未经用户明确确认，不执行 `git commit` 或 `git push`；因此本计划以验证检查点替代提交步骤。

## 文件职责图

- `project.identity.json`：public identity 唯一真源。
- `src/identity/`、`scripts/identity/`：身份 schema、生成、检查和有边界 rename。
- `src/domain/`：品牌中立领域类型和稳定 schema 常量。
- `src/manifest/`：严格 manifest v1 schema、加载和语义验证。
- `src/artifacts/`：variant source 解析、物化、哈希和冻结。
- `src/runtime/`：fixture、隔离目录、fingerprint、paired scheduler、child runner。
- `src/adapters/dsh/`：DSH v0.1 session/profile/CLI 适配。
- `src/exposure/`、`src/evaluate/`：暴露检测、确定性断言、盲评、聚合。
- `src/decision/`：纯函数 promotion policy。
- `src/report/`：canonical JSON、Markdown、HTML。
- `src/cli/`：命令解析、退出码和输出格式。
- `src/dsh-plugin/`：薄 Cordis tool surface。
- `fixtures/`、`evals/`：确定性插件、scripted runner 和样例实验。
- `tests/`：与模块同边界的单元、集成、rename 和 CLI 测试。

---

### Task 1: 工程基线与 public identity

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, `.gitignore`, `LICENSE`
- Create: `project.identity.json`, `src/identity/schema.ts`, `src/identity/load.ts`, `src/identity/generated.ts`
- Create: `scripts/identity/sync.ts`, `scripts/identity/check.ts`
- Test: `tests/identity/identity.spec.ts`, `tests/identity/check.integration.spec.ts`

**Interfaces:**
- Produces: `ProjectIdentity`, `loadProjectIdentity(root): Promise<ProjectIdentity>`, `renderGeneratedIdentity(identity): string`, `synchronizeIdentity(root, mode): Promise<IdentitySyncResult>`。

- [ ] **Step 1: 建立仅能运行测试的工程配置**

`package.json` 先声明 `type: module`、`packageManager: pnpm@10.11.0`、Node engine、`test/typecheck/lint/build` 脚本和精确 dev dependencies；不添加业务实现。

- [ ] **Step 2: 写身份加载失败测试并确认 RED**

```ts
it('拒绝 identityVersion 以外的未知字段', async () => {
  await expect(loadIdentityFixture({ ...validIdentity, unexpected: true }))
    .rejects.toThrow(/unrecognized key.*unexpected/i)
})
```

运行：`pnpm vitest run tests/identity/identity.spec.ts`；预期因模块不存在失败。

- [ ] **Step 3: 实现严格 identity schema 和加载器**

```ts
export interface ProjectIdentity {
  identityVersion: 1
  displayName: string
  shortName: string
  repoSlug: string
  npmScope: string | null
  npmName: string
  cliBin: string
  description: string
  legacyAliases: { npmPackages: string[]; cliBins: string[]; repoSlugs: string[] }
}
```

- [ ] **Step 4: 测试同步与检查行为**

测试 `sync` 幂等更新 `package.json`、bin mapping 和 generated constants；`check` 只读且在 drift 时非零退出。运行目标测试直至 GREEN。

- [ ] **Step 5: 验证工程基线**

运行：`pnpm identity:sync && pnpm identity:check && pnpm typecheck && pnpm lint && pnpm test`。

### Task 2: 有边界的项目重命名

**Files:**
- Create: `src/identity/rename-plan.ts`, `src/identity/stale-scan.ts`
- Create: `scripts/identity/rename.ts`, `scripts/identity/test-rename.ts`
- Create: `docs/identity.md`
- Modify: `README.md`, `package.json`, `.github/workflows/ci.yml`
- Test: `tests/identity/rename.spec.ts`, `tests/identity/rename.e2e.spec.ts`

**Interfaces:**
- Consumes: Task 1 identity loader/sync。
- Produces: `planRename(root, requested): Promise<RenamePlan>`、`executeRename(plan): Promise<RenameReport>`；report 写 `rename-report.json`。

- [ ] **Step 1: 写 dry-run 零写入测试并确认 RED**

```ts
it('dry-run 只返回结构化计划且不改变文件摘要', async () => {
  const before = await hashTree(root)
  const report = await renameProject(root, materiallyDifferentIdentity, { dryRun: true })
  expect(report.changedFiles).toContain('project.identity.json')
  expect(await hashTree(root)).toBe(before)
})
```

- [ ] **Step 2: 实现 JSON/YAML/Markdown 目标清单**

允许修改 identity、package metadata、bin、generated constants、README/docs、bundle metadata、CI 示例和 lockfile；任何未登记路径只参与 stale scan，不自动替换。

- [ ] **Step 3: 实现 rename transaction 和失败回滚**

先在临时 staging tree 应用并运行 sync/check/format/typecheck/test；成功后才原子替换授权文件，失败保留原树并写失败 report。

- [ ] **Step 4: 写真正改名的临时副本测试**

目标身份使用 `Harness Pair Lab` / `harness-pair-lab` / `hpair`，证明 metadata、CLI、generated constants、docs 改变，旧 public identity 只出现在显式 allowlist/legacy report。

- [ ] **Step 5: 验证 rename DoD**

运行：`pnpm project:rename -- --dry-run ...`、`pnpm test:rename`、`pnpm identity:check`。

### Task 3: 稳定领域模型与严格 manifest v1

**Files:**
- Create: `src/domain/types.ts`, `src/domain/protocol.ts`, `src/domain/schemas.ts`
- Create: `src/manifest/schema.ts`, `src/manifest/load.ts`, `src/manifest/validate.ts`
- Create: `docs/manifest.md`, `evals/cases.yml`, `experiment.example.yml`
- Test: `tests/manifest/manifest.spec.ts`, `tests/domain/brand-neutral.spec.ts`

**Interfaces:**
- Produces: `loadManifest(path): Promise<ExperimentManifest>`、`validateManifestSemantics(manifest, baseDir): Promise<ValidationIssue[]>`。

- [ ] **Step 1: 写未知字段和路径逃逸失败测试并确认 RED**

```ts
it('拒绝 suite 中未保留的字段', () => {
  expect(() => parseManifest({ ...validManifest, suite: { ...suite, mystery: 1 } }))
    .toThrow(/suite.*mystery/i)
})
```

- [ ] **Step 2: 定义品牌中立类型和协议常量**

类型必须包含 GOAL 指定的 14 个领域名；schema id 固定为 `urn:dsh:plugin-experiment:manifest:v1`。

- [ ] **Step 3: 实现 Zod strict schema 与语义验证**

验证 case id 唯一、repetitions 正整数、timeout 有界、artifact source 形状、fixture 存在、policy threshold 合法、GitHub mutable ref 只能作为待解析输入。

- [ ] **Step 4: 写品牌泄漏行为测试**

序列化一个样例 manifest/run/decision，递归键和值不得包含默认 repo/npm/display/CLI 名；协议白名单不计为泄漏。

- [ ] **Step 5: 运行 manifest 单测和类型检查**

运行：`pnpm vitest run tests/manifest tests/domain && pnpm typecheck`。

### Task 4: variant 解析与 FrozenArtifact

**Files:**
- Create: `src/artifacts/source.ts`, `src/artifacts/hash.ts`, `src/artifacts/materialize.ts`, `src/artifacts/freeze.ts`
- Create: `src/artifacts/resolvers/local.ts`, `npm.ts`, `github.ts`, `tarball.ts`
- Test: `tests/artifacts/local.spec.ts`, `tests/artifacts/tarball.spec.ts`, `tests/artifacts/resolution.spec.ts`

**Interfaces:**
- Produces: `ArtifactResolver.resolve(source, context): Promise<ResolvedArtifact>`、`freezeVariant(variant, context): Promise<FrozenArtifact>`。

- [ ] **Step 1: 写相同内容同 hash、修改文件变 hash 的测试并确认 RED**

- [ ] **Step 2: 实现 canonical tree hashing**

路径排序、模式/大小纳入摘要；忽略 VCS、`node_modules` 和声明的非制品文件；symlink 记录 link target 且拒绝逃逸。

- [ ] **Step 3: 实现 local directory 与 packed tarball resolver**

复制到 controller-owned cache 后再 hash，避免执行期间源目录变化。

- [ ] **Step 4: 实现 npm 与 GitHub resolver**

npm 通过 `pnpm pack`/registry metadata 固定 exact version 和 integrity；GitHub 输入必须得到 commit SHA，最终 metadata 不保留 mutable branch 身份。测试使用本地 fake registry/git fixture，默认 CI 不联网。

- [ ] **Step 5: 检查 secret 不进入 artifact metadata**

环境变量只记录 allowlist 名称集合的摘要；测试注入 sentinel secret 并证明 JSON 不含原文。

### Task 5: RuntimeFixture 与 RuntimeFingerprint

**Files:**
- Create: `src/runtime/fixture.ts`, `src/runtime/fingerprint.ts`, `src/runtime/integrity.ts`
- Test: `tests/runtime/fingerprint.spec.ts`, `tests/runtime/integrity.spec.ts`

**Interfaces:**
- Produces: `createRuntimeFingerprint(input): RuntimeFingerprint`、`compareFingerprints(control, candidate, allowed): PairIntegrityResult`。

- [ ] **Step 1: 写非目标 plugin 版本差异导致 invalid 的测试并确认 RED**

```ts
expect(compareFingerprints(control, changedNonTarget, allowed)).toEqual({
  valid: false,
  failure: { code: 'pair_integrity_failure', paths: ['nonTargetPlugins.memory.version'] },
})
```

- [ ] **Step 2: 实现 canonical JSON/hash**

规范化 DSH/Node/OS/bundles/profile/model/parameters/prompt/tools/skills/sandbox/workspace/environment 字段；数组是否排序由字段语义决定。

- [ ] **Step 3: 实现 path-aware diff 和 allowlist**

只允许 target artifact identity 与 target config hash 差异；任何额外差异给出稳定 path 列表。

- [ ] **Step 4: 覆盖缺失 observable 字段**

不可观测 prompt/tool/skill hash 使用显式 `unknown` 状态，不能与空值混淆。

### Task 6: 隔离 paired runner 与证据目录

**Files:**
- Create: `src/runtime/layout.ts`, `src/runtime/scheduler.ts`, `src/runtime/process.ts`, `src/runtime/runner.ts`
- Create: `src/adapters/dsh/profile.ts`, `src/adapters/dsh/command.ts`
- Test: `tests/runtime/scheduler.spec.ts`, `tests/runtime/process.spec.ts`, `tests/runtime/runner.integration.spec.ts`

**Interfaces:**
- Produces: `schedulePairs(cases, repetitions): ScheduledPair[]`、`runPair(input): Promise<RunPair>`。

- [ ] **Step 1: 写 counterbalanced 顺序测试并确认 RED**

`pair 0` 为 Control/Candidate，`pair 1` 为 Candidate/Control，重复后保持确定性。

- [ ] **Step 2: 实现受限 output layout**

所有 path 由经过 slug/escape 检查的 experiment/case/repetition 生成；输出严格落在 experiment root。

- [ ] **Step 3: 实现每臂隔离准备**

为每个 run 创建不同的 home/profile/workspace/session；复制 fixture；写只包含允许变量的环境；profile 插入冻结 target plugin 和 isolated persistence patch。

- [ ] **Step 4: 实现无 shell child process**

捕获 stdout/stderr、启动时间、总时长、退出码、signal、timeout；timeout 后先温和终止再强杀，并分类为 infrastructure error。

- [ ] **Step 5: 用 scripted child 验证隔离**

fixture child 回写看到的 cwd/home/profile/session；测试断言双臂四类路径互不相同且制品 hash 正确。

### Task 7: DSH session adapter、evidence collector 与 exposure

**Files:**
- Create: `src/adapters/dsh/v0_1/session.ts`, `zstd.ts`, `events.ts`
- Create: `src/collect/collector.ts`, `src/exposure/types.ts`, `src/exposure/detectors.ts`
- Test: `tests/adapters/dsh-session.spec.ts`, `tests/collect/collector.spec.ts`, `tests/exposure/exposure.spec.ts`

**Interfaces:**
- Produces: `SessionLogAdapter.collect(path): Promise<RunEvidence>`、`detectExposure(evidence, config): ExposureReceipt`。

- [ ] **Step 1: 写 torn line、未知事件和多 session 父子选择测试并确认 RED**

- [ ] **Step 2: 实现 append-only JSONL 读取与版本 gate**

保留未知事件原始引用；坏尾行计入 warning；无法安全识别版本时返回 adapter error，不猜字段。

- [ ] **Step 3: 实现 Zstd adapter 边界**

优先调用上游公开 decoder；若无稳定公开 API，使用项目自有最小 frame decoder 并以固定真实 fixture 做兼容测试。

- [ ] **Step 4: 实现 exposure 状态机**

检测器输出 `installed/loaded/activated/exposed/unknown`、detector id、evidence refs；自定义事件名固定 `dsh.plugin-experiment/exposure`。

- [ ] **Step 5: 验证 required exposure**

loaded-but-unexposed fixture 在 `require_exposure: true` 时使 pair invalid/inconclusive，而非 Candidate loss。

### Task 8: 确定性断言与生命周期/安全检查

**Files:**
- Create: `src/evaluate/assertions.ts`, `src/evaluate/lifecycle.ts`, `src/evaluate/pipeline.ts`
- Test: `tests/evaluate/assertions.spec.ts`, `tests/evaluate/order.spec.ts`

**Interfaces:**
- Produces: `evaluateDeterministic(run, caseDef): AssertionResult[]`、`evaluatePairEvidence(pair, policy): EvaluatedRunPair`。

- [ ] **Step 1: 写“deterministic fail 不调用 comparator”测试并确认 RED**

- [ ] **Step 2: 实现 assertion registry**

支持退出成功、文件存在、JSON schema、命令测试、forbidden tool、critical security、session readability、unload cleanup 和 required value。

- [ ] **Step 3: 实现固定评估顺序**

完整性、boot/activation、deterministic、lifecycle/safety、blind、efficiency、post-hoc、decision；每阶段显式记录 skipped reason。

- [ ] **Step 4: 覆盖 infrastructure 与 task failure 分类**

timeout/provider outage/corrupt fixture 可使 pair invalid；断言失败才是 task failure。

### Task 9: BlindComparison 与 PostHocAnalysis

**Files:**
- Create: `src/evaluate/blind.ts`, `src/evaluate/comparator.ts`, `src/evaluate/posthoc.ts`
- Test: `tests/evaluate/blind.spec.ts`, `tests/evaluate/posthoc.spec.ts`

**Interfaces:**
- Produces: `BlindComparator.compare(input): Promise<AnonymousComparison>`、`revealComparison(result, mapping): BlindComparison`。

- [ ] **Step 1: 写身份泄漏测试并确认 RED**

测试 comparator input 深度扫描，禁止 control/candidate label、版本、commit、config 和含 variant 名的 path。

- [ ] **Step 2: 实现 seeded A/B randomization**

mapping 单独写入受限证据文件，comparison 完成前 evaluator 无法读取 reveal 信息。

- [ ] **Step 3: 实现 mock comparator 和 live adapter 接口**

默认测试使用纯函数 mock；live comparator 没有配置时明确 skipped，不影响 deterministic core。

- [ ] **Step 4: 实现三层 post-hoc 结论**

输出分别包含 `observedEvidence`、`likelyExplanations`、`unprovenCausalClaims`，trace correlation 不得进入第一层事实。

### Task 10: 配对指标与四态决策

**Files:**
- Create: `src/evaluate/metrics.ts`, `src/evaluate/statistics.ts`
- Create: `src/decision/policy.ts`, `src/decision/decide.ts`
- Create: `docs/decisions.md`
- Test: `tests/evaluate/metrics.spec.ts`, `tests/decision/decision.spec.ts`

**Interfaces:**
- Produces: `aggregatePairs(pairs): Comparison`、`decidePromotion(comparison, policy): PromotionDecision`。

- [ ] **Step 1: 写四个 outcome fixture 测试并确认 RED**

分别覆盖质量提升且 guardrail 通过、critical regression、有益但昂贵/高方差、有效证据不足。

- [ ] **Step 2: 实现 per-pair delta 后聚合**

质量、执行和效率指标先以 candidate-control 计算，再输出 count/mean/median/sample stddev；样本不足时 significance 为 `not_claimed`。

- [ ] **Step 3: 实现 deterministic policy precedence**

优先级严格遵循 ADR-0005，并把每条触发规则写入 `reasons` 和 `triggeredRules`。

- [ ] **Step 4: 覆盖边界值**

阈值等号、零 baseline、缺失 token、invalid pairs、critical case 子集、百分比与百分点单位分别测试。

### Task 11: 报告和存储合同

**Files:**
- Create: `src/report/json.ts`, `markdown.ts`, `html.ts`, `write.ts`
- Test: `tests/report/report.spec.ts`, `tests/report/storage.integration.spec.ts`

**Interfaces:**
- Produces: `writeExperimentReport(result, root): Promise<ReportPaths>`。

- [ ] **Step 1: 写 canonical 文件树测试并确认 RED**

断言 manifest lock、两份 artifact、pair/control/candidate、comparison、decision、report.md/report.html 的稳定路径。

- [ ] **Step 2: 实现 canonical JSON 和 Markdown**

Markdown 必须呈现有效/无效 pair、暴露、hard gates、primary、guardrails、证据边界和最终 outcome。

- [ ] **Step 3: 实现无外部脚本的静态 HTML**

数据以内嵌转义 JSON 呈现；CSP 禁止网络与 inline executable script，或用纯 HTML details/table。

- [ ] **Step 4: secret/stale identity 扫描**

报告不得包含 sentinel secret；领域 JSON 不包含 public identity。

### Task 12: CLI 与稳定退出码

**Files:**
- Create: `src/cli/main.ts`, `commands/*.ts`, `output.ts`, `exit-codes.ts`
- Test: `tests/cli/cli.spec.ts`, `tests/cli/workflow.e2e.spec.ts`

**Interfaces:**
- Produces: `dsh-ab init|validate|freeze|run|status|compare|report|decision`，支持适用的 `--json`、`--output`。

- [ ] **Step 1: 写命令帮助和退出码测试并确认 RED**

- [ ] **Step 2: 实现薄命令适配**

命令只组装 core 调用；不复制业务规则。退出码：成功 0、验证错误 2、执行失败 3、inconclusive 4、reject 5、内部错误 10。

- [ ] **Step 3: 实现原子状态文件和 resume-safe status**

status 只读 canonical evidence，报告 completed/valid/failed/pending；不通过猜测修改状态。

- [ ] **Step 4: 跑完整离线 CLI workflow**

`init → validate → freeze → run → status → compare → report → decision`，验证 JSON 和文本模式一致。

### Task 13: 薄 DSH/Cordis plugin surface

**Files:**
- Create: `src/dsh-plugin/index.ts`, `src/dsh-plugin/tools.ts`, `cordis.patch.yml`
- Modify: `package.json`
- Test: `tests/dsh-plugin/tools.spec.ts`, `tests/dsh-plugin/bundle.spec.ts`

**Interfaces:**
- Produces: `apply(ctx)` 注册七个 `plugin_experiment_*` 工具；entry id 为 `plugin-experiment-controller`。

- [ ] **Step 1: 写工具 schema 不包含任意命令字段的测试并确认 RED**

- [ ] **Step 2: 实现 core delegation**

工具参数只接受 manifest/output/experiment id 和安全选项；不接受 shell、env map 或真实 profile mutation。

- [ ] **Step 3: 验证 bundle metadata 可随 identity 同步**

public package name 由 identity sync 更新，稳定 Cordis id 不变。

### Task 14: 离线 fixture plugins 与真实 DSH 集成门

**Files:**
- Create: `fixtures/plugins/control-v1/`, `candidate-v2/`, `candidate-regressed/`, `candidate-unexposed/`, `candidate-boot-failure/`
- Create: `fixtures/scripted-dsh/`, `tests/integration/paired-experiment.e2e.spec.ts`, `tests/integration/dsh-contract.spec.ts`
- Modify: `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 全部 core/CLI。
- Produces: 可重复样例 experiment 和固定 DSH `0.1.0-rc.7` compatibility gate。

- [ ] **Step 1: 写五类 fixture 的期望 outcome 测试并确认 RED**

- [ ] **Step 2: 实现 scripted offline DSH 进程**

它读取 isolated profile/artifact，发出真实形状的 append-only session evidence，覆盖 tool call、exposure、usage、boot failure 和 cleanup。

- [ ] **Step 3: 增加固定真实 DSH contract test**

精确依赖 `@deepseek-ai/dsh@0.1.0-rc.7`，只验证 profile 初始化、`DSH_HOME` 隔离、headless 参数与 session persistence 边界；provider 使用本地 scripted OpenAI-compatible server，不访问付费 API。

- [ ] **Step 4: live smoke 环境门**

只有 `DSH_PLUGIN_EXPERIMENT_LIVE=1` 时运行；默认 CI 明确 skip 并报告原因。

### Task 15: Definition of Done 总验收

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/manifest.md`, `docs/decisions.md`, `docs/upstream.md`
- Create: `docs/verification.md`

- [ ] **Step 1: 执行全量静态与测试门**

```bash
pnpm identity:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:rename
pnpm build
pnpm pack --dry-run
```

- [ ] **Step 2: 对照 20 条 DoD 生成逐项证据表**

每条记录命令、fixture、产物路径和结果；证据不足标记未通过，不能用建议替代事实。

- [ ] **Step 3: 检查 diff 与禁止操作**

运行 `git status --short`、`git diff --check`、`git diff --stat`，确认只包含项目产物；证明没有 publish、remote mutation、生产 profile mutation 或 commit/push。

- [ ] **Step 4: 形成交付摘要**

列出实现、架构、精确验证命令、测试结果、已知限制和后三个最高价值里程碑；仅当 20 条 DoD 全部有通过证据时完成 Goal。

## 自审结果

- 规格覆盖：identity/rename、manifest/artifact、fingerprint、isolated pair、exposure、deterministic-before-LLM、blind/post-hoc、metrics/decision、reports、CLI/DSH plugin、fixtures/CI/pack 均有对应任务。
- 占位扫描：计划不含未定义的实现占位；live smoke 的 skip 是明确产品行为，不是缺失实现。
- 类型一致性：`RunPair` 是运行与评估核心；`Comparison` 是聚合输出；`PromotionDecision` 只由 `decidePromotion` 产生；CLI、报告和 DSH tool 均消费同一 core。
- 执行方式：由于当前会话明确禁止主动委派，采用 `executing-plans` 在本任务内逐项执行和检查。
