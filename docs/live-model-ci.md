# Protected live-model CI

The `Protected live-model smoke` workflow runs the pinned Toolshrink case study against the paid DeepSeek provider. It is intentionally separate from normal pull-request and push CI.

## Security boundary

- The workflow can only be started with `workflow_dispatch`.
- The operator must explicitly confirm that the run incurs paid model calls.
- A preflight job rejects tags and every branch except `master` before the protected job starts.
- The protected job references the `live-model` GitHub Environment and has only `contents: read` permission.
- `DEEPSEEK_API_KEY` is injected only into the step that executes the experiment.
- Raw sessions, tool output, spill files, workspace diffs, reports, and evidence directories remain in the ephemeral runner. The only uploaded artifact is the sanitized `result.json`, retained for seven days.
- `REJECT` and `INCONCLUSIVE` are valid experiment outcomes. They do not fail the workflow; validation, execution, or sanitization failures do.

Manual dispatch is a cost-control mechanism, not the protection itself. The GitHub Environment must be configured before the workflow is run.

## One-time GitHub configuration

An administrator must complete these steps in **Settings → Environments**:

1. Create an Environment named exactly `live-model`.
2. Restrict deployment branches and tags to the `master` branch.
3. Add at least one required reviewer when the repository plan and visibility support it.
4. Add an Environment secret named `DEEPSEEK_API_KEY`.
5. Add an Environment variable named `LIVE_MODEL_CI_PROTECTED` with the value `true`.

Store the provider key only as an Environment secret. Do not create a repository-level secret with the same name. If there is only one maintainer, do not enable **Prevent self-review** until another eligible reviewer is available, or the maintainer who dispatches the workflow will be unable to approve it.

Referencing a missing Environment from a workflow can create an unprotected Environment. The `LIVE_MODEL_CI_PROTECTED` guard and required secret make that incomplete setup fail before any provider call, but they do not replace GitHub protection rules.

## Run the workflow

After the workflow is present on the default branch and the Environment is configured:

1. Open **Actions → Protected live-model smoke → Run workflow**.
2. Select `master`.
3. Check **confirm_paid_run**.
4. Start the workflow and approve the `live-model` Environment when prompted.
5. Download `live-model-summary` and inspect `result.json`.

Avoid blindly re-running jobs: every successful retry of the paid step creates a new set of model calls.

## Repository-side verification

The committed workflow contract is checked without using a model key:

```bash
pnpm exec vitest run tests/ci/workflow.spec.ts
pnpm lint
pnpm typecheck
```

These commands validate the repository configuration only. They cannot prove that the remote Environment, reviewer rules, variable, or secret are configured; verify those settings in GitHub before the first dispatch.
