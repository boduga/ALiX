# D9 — Scripted reviewer routing and actual tool authorization

2026-10-26. Follow-up to [the isolated boundary investigation](D9-isolated-boundary-investigation.md), using two new, controlled **actual daemon processes** and the unchanged production authorization/reviewer implementation. **LEAN-G01 remains BLOCKED; independent security review is pending.**

## Result

The instrumented baseline reproduced the previous sequence: the receipt was written once, objective review rejected a tool call in place of a verdict, and the scheduler requested another dispatch approval. With only the fixture's global reviewer scenario changed to a valid structured verdict, the worker completed on attempt 1, the receipt was written once, and no second approval was requested.

The file tool's real policy decision was **allow / `owned-path-rule` / `Write targets owned path`** in both new runs. It did not consume a separate tool approval. The dispatch grant was consumed separately. This scenario exercises the existing owned-scope authorization path; it is not a demonstration of tool-level ask → operator approval → continuation resumption.

The reviewer correctly rejected the malformed fixture response. Neither PolicyGate, ToolExecutor dispatch, the reviewer acceptance criteria nor production scenario routing was changed in this task.

## Retained evidence and controls

[Full decision records, lifecycle events, scripted traces, CLI-derived worker/results and manifests](D9-review-routing-daemon-evidence.json) retain both cases. The JSON includes original tool request identity, argument hash, canonical agent, session, owned scope, matched rule, policy revision and final ExecutionAuthorization result. These are observations of the new runs, **not a retroactive export of the original run's missing decision**.

| Field | Baseline | Corrected reviewer fixture |
|---|---|---|
| Run | `coord_70227952-a1ed-4e77-aebd-87b8a6cabef6` | `coord_3d7b6326-136f-48e4-994c-34427155ac6f` |
| Worker | `worker_dadf24ac-557c-4c79-b11e-19c048237bfd` | `worker_dfd36306-3dfc-4850-8c8f-a9a022708593` |
| Dispatch approval | `approval_1793028795116_pz1br` — consumed | `approval_1793028846304_tv845` — consumed |
| Actual file mutations | 1 | 1 |
| Worker attempt | 1, result failure | 1, completed/success |
| Reviewer response | Global worker scenario emits a tool call | Global review scenario emits structured verdict JSON |
| New dispatch approval | `approval_1793028808247_fl04l` — pending, never approved by the probe | None; total approvals remains 1 across a further 3.5-second observation window (configured poll interval: 1 second) |
| Run outcome | Blocked after objective-review protocol failure | Execution completed, aggregate generated, outcome success |
| Completion verification | Unverified | **Unverified** — not promoted to verified success |
| Daemon shutdown | SIGTERM, exit 0 | SIGTERM, exit 0 |

Both new cases used byte-identical synthetic configuration and worker scenarios. SHA-256 pins for PolicyGate, ToolExecutor, the worker executor, default-worker reviewer and scripted carrier are identical across the pair. The policy revision and file-tool argument hash also match:

- Policy revision: `817fba5cb5732d14c365a02542533264fe55ee1a7ec7076c6adf28e79f2d3db5`.
- File-tool argument hash: `6cb04ec2f93b7eaa3b3232c20c27697b9df706100d8dfd3e59ac689c32a7fe70`.
- Owned scope: `docs/d9-receipt.txt`.
- Canonical tool agent: `alix`; worker agent label: `alix#1`. The observer preserves these distinct recorded values rather than substituting a worker identity.
- Tool policy request: `sessionMode: ask`, tool `file.create`, policy capability `file.write`; ExecutionAuthorization returns `status: allowed`, `policyRuleId: owned-path-rule`, with no tool approval ID. Dispatch capability records use `filesystem.write`.

## Fixture correction

The existing worker executor wraps `runTask` in `withScriptedScenario(workerScenario, ...)`; its objective review runs afterward, outside that invocation scope. Previously the process-global carrier hydrated the same worker tool sequence from `ALIX_EVAL_SCENARIO`, so the reviewer received global step 0 (`tool`) instead of a verdict.

The corrected fixture preloads the global carrier with the review scenario while leaving `ALIX_EVAL_SCENARIO` as the worker script. The worker's invocation-local cursor remains independent. The reviewer receives its own global step 0 (`text`, containing the verdict). This uses the existing carrier API and cached-provider semantics; no production fix or authorization redesign is needed for this fixture defect.

The verdict is **scripted fixture input**, not an independent model/human judgment. The probe independently checks exact file content, a single `file.created` event, the real allowed rule, a consumed dispatch grant, attempt 1 completion and absence of additional approvals. Unit controls retain rejection of reviewer tool calls and negative verdicts even when an artifact exists.

## Observation mechanism and authorization

`tests/fixtures/d9-review-observer.mjs` is an opt-in test preload. It wraps the public PolicyGate, ExecutionAuthorization and EventLog producer methods, forwards the identical receiver and arguments to the original method, records the returned result, then returns that same result. Errors are rethrown. It neither supplies decisions nor consumes/approves records. Observations are appended outside protected runtime state. Original state remains queried through the public CLI; no `.alix/**` file was read directly.

These are **instrumented** process runs; observation can affect timing, so this is not a claim about every uninstrumented or concurrent host interleaving.

The sandbox initially rejected the daemon's private Unix socket with `listen EPERM`. That attempt did not execute a worker and was not counted as passing. The same test command was then submitted through the tool's approval review, which allowed execution with the private socket. No transport substitution, disabled safety control or automatic approval of a denied production operation was used. Child homes and workspaces are disposable; the parent/operator home is unchanged. All model calls use the explicit offline scripted fixture, with no real-provider calls or credentials.

## Changed files

- `tests/fixtures/d9-daemon-review-probe.mjs` — repeatable isolated baseline/corrected daemon probes, original CLI dispatch approval, no second-approval automation, read-only state exports and exact assertions. Only the fresh disposable fixture's first dispatch grant is approved.
- `tests/fixtures/d9-review-observer.mjs` — pass-through capture of actual decisions and lifecycle producers; fixture-only global review script preload.
- `tests/security/d9-scripted-review-routing.vitest.ts` — independent worker/global reviewer cursors, reproduction of the malformed reviewer response, and negative-verdict rejection.
- This verification record, `D9-review-routing-daemon-evidence.json`, the historical investigation's follow-up pointer and `route-parity-matrix.md`.

Existing staged/unstaged/untracked source work was preserved. No production source, approval policy, reviewer rule, model-facing tool or permission configuration was edited. Root, documentation and eval contracts were read; AGENTS.md files and child indexes are intentionally unchanged because no stable runtime interface or operating rule changed. No commit, push or merge was performed.

## Executed checks

| Check | Actual result |
|---|---|
| Baseline actual daemon reproduction, tool-calling reviewer | Probe exit 0: expected negative worker result and new pending dispatch reproduced; one file mutation; actual owned-path allow decision retained |
| Corrected actual daemon run | Probe exit 0: one successful attempt, one mutation, one consumed dispatch approval, no second grant, clean shutdown |
| Final Vitest routing/reviewer regressions | **40 passed / 0 failed**, 5 files, exit 0; 11.73 s |
| New routing tests within that set | **3 passed / 0 failed**; not counted again |
| `pnpm build` | PASS, exit 0, before process probes; the daemon executes these rebuilt production artifacts |
| Final `pnpm typecheck` | PASS, exit 0 |
| `pnpm typecheck:unused` | PASS, exit 0 |
| Fixture syntax (`node --check`), evidence JSON/read-back, `git diff --check` | PASS |

Commands:

```sh
pnpm build
node tests/fixtures/d9-daemon-review-probe.mjs baseline
node tests/fixtures/d9-daemon-review-probe.mjs corrected
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 tests/security/d9-scripted-review-routing.vitest.ts tests/scripted-mock-invocation-scope.vitest.ts tests/agents/objective-review-verdict.vitest.ts tests/agents/coordination-objective-review.vitest.ts tests/kernel/default-worker-review.vitest.ts
pnpm typecheck
pnpm typecheck:unused
node --check tests/fixtures/d9-daemon-review-probe.mjs
node --check tests/fixtures/d9-review-observer.mjs
git diff --check
```

Earlier setup failures were not success evidence: pipe-based child stdout was empty, so the first probe could not recover the planner run ID; explicit file descriptors fixed output collection without changing a command or decision. The sandbox socket rejection is retained separately above. TypeScript found four missing required `systemPrompt` fields in the new test requests; those test-only shapes were corrected. The preliminary 10-test run is a subset of the final 40, not additional successes.

## Limits and gate disposition

- The newly instrumented reproductions resolve the authorization-path question for these frozen fixtures: **existing owned-scope authorization allowed the file tool; review-fixture contamination caused the retry**. They do not reconstruct an absent raw decision for the historical run.
- This is one in-process worker hosted by actual daemon processes. It does not qualify isolated subagent workers, multiworker/multi-continuation recovery, in-flight cancellation, or receipt-to-worker-state crash recovery.
- The file tool followed owned-scope allowance, so these two runs **do not exercise a tool-level pending approval or the daemon's continuation resumer**. The earlier dedicated continuation tests remain separate evidence; they cannot be replaced by this run.
- The corrected CLI status says `execution=completed aggregation=generated outcome=success verification=unverified`. The observer captured no `coordination.aggregate.completed` event. The missing/mismatched durable completion-verification evidence remains a concrete follow-up. No success or verified flag was synthesized to hide it.
- Prior DOX automation limitations were not bypassed, and no new automated DOX pass is claimed. Independent D1–D9 review is still pending.

**The reviewer-fixture retry defect is resolved and verified in the controlled pair. D9 qualification remains incomplete; LEAN-G01 remains BLOCKED and independently unreviewed.**


## Subsequent completion-evidence fix — 2026-10-26

[The daemon completion-event follow-up](D9-daemon-completion-event-verification.md) reproduces the remaining unverified verdict, wires the existing append-only session event sink and obtains normal CLI `verification=verified` for a new actual-daemon run with exactly one matching aggregate event. It changes no authorization or reviewer algorithm and does not relabel the historical runs above. The tool-specific approval-resumption, isolated-worker and independent-review limits remain; D9/LEAN-G01 are not marked complete.
