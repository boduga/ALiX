# LEAN-G01 D7 — Atomic approval outcome authorization

Implementation evidence for the operator-authorized D7 task, 2026-10-26.
This record supplies no independent review or LEAN-G01 completion. LEAN-G01 remains BLOCKED.

## Authorization contract

- Both `ApprovalStore.recordExecutionOutcome` and `ApprovalStore.markExecutionUnverified` validate worker ownership after the authoritative ledger reload inside the existing cross-process mutation lock, before changing status or outcome.
- `ApprovalOutcomeScope` is an optional trusted host argument. Each restricted worker port supplies a fresh scope containing the worker ID captured at construction. An unbound port supplies an explicit scope with no worker ID. Request metadata, additional call arguments, and later mutation of construction options cannot replace that captured identity.
- A worker-bound record requires a matching scoped worker ID. An unauthorized report returns `false`; unauthorized unverified classification returns `"missing"`, preserving record confidentiality. An internal denial sentinel exits the mutation before retention pruning, ledger append, projection writes, or lifecycle emission. Other errors still propagate.
- Records without a worker binding preserve the explicitly permitted legacy non-worker path. Omitted scope preserves the privileged full-store host interface used by executor, policy-gate and continuation callers. Worker ports expose neither this omission nor decision methods. Public port signatures and result unions are unchanged; the store gains optional trailing scope arguments. No persistence schema change or migration is required.
- Existing first-terminal-outcome and single-use consumption rules remain. This slice adds no outcome authorization by worker attempt, run ID, or execution receipt identity; those semantics remain independent-review questions.

## Acceptance coverage

`tests/security/worker-approval-atomic-outcome-acceptance.vitest.ts` defines 80 parity cases: two mutation operations × worker-bound/legacy records × owner/other/unbound/host callers × requested/approved/consumed-pending/succeeded/unverified states. Six additional cases cover a forced concurrent ownership rebind before locked mutation, concurrent reporting through separate store instances, ledger close/reopen, and captured identity/extra-argument handling.

`tests/security/worker-approval-atomic-restart.test.ts` adds two compiled Node tests. Each closes the creating store's ledger, launches four fresh unauthorized processes concurrently against persisted ownership, checks the consumed/pending record is unchanged, then launches the authorized owner in another fresh process and checks its transition persisted.

## Initial D7 verification — before the supplied PolicyGate follow-up

These results are historical. The follow-up below supersedes the remaining coordination-regression failure; it does not clear LEAN-G01.

Executed against the real dirty working tree on Node v26.11.0. No real model calls, commits, pushes or merges.

| Check | Result |
|---|---|
| Focused D7 Vitest acceptance | **86 passed / 0 failed**, exit 0; 127.81 s |
| Seven Vitest approval regression files | **49 passed / 0 failed**, exit 0; 61.01 s |
| Eight compiled Node approval/security files (including fresh-process D7) | **58 passed / 1 failed**, exit 1; 65.54 s; 59 tests, 9 suites, no skips/cancellations |
| Fresh-process D7 cases within that Node run | **2 passed / 0 failed** (also passed a separate receipt-based run) |
| `pnpm typecheck` after final source/test edits | PASS, exit 0 |
| `pnpm typecheck:unused` | PASS, exit 0; production source unchanged afterward |
| `pnpm build` after final source/test edits | PASS, exit 0; Node tests used these rebuilt artifacts |
| `git diff --check` | PASS |
| `pnpm check:dox` | BLOCKED / exit 2: checker reports unresolved HEAD because sandbox rejects its child `spawnSync git` with EPERM; direct `git rev-parse HEAD` succeeds. No bypass attempted. |

Final distinct test total: **193 passed / 1 failed** (194 tests). This includes the two fresh-process D7 cases once, not again as a separate success total.

Commands:

```sh
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/worker-approval-atomic-outcome-acceptance.vitest.ts
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/worker-approval-port.vitest.ts tests/security/worker-approval-identity-acceptance.vitest.ts tests/security/worker-approval-invocation-acceptance.vitest.ts tests/security/worker-approval-legacy-migration-acceptance.vitest.ts tests/security/worker-approval-visibility-acceptance.vitest.ts tests/security/approval-event-dedup.vitest.ts tests/approvals/approval-store-events.vitest.ts
node --test --test-isolation=none --test-concurrency=1 dist/tests/approvals/approval-store.test.js dist/tests/approvals/approval-binding.test.js dist/tests/approvals/approval-store-lock.test.js dist/tests/approvals/approval-ledger-dualwrite.test.js dist/tests/security/approval-crash-recovery.test.js dist/tests/security/approval-consumed-propagation.test.js dist/tests/security/legacy-approval-single-use.test.js dist/tests/security/worker-approval-atomic-restart.test.js
pnpm typecheck
pnpm typecheck:unused
pnpm build
pnpm check:dox
git diff --check
```

**Regression at the initial snapshot:** `approval consumption propagation > the coordination exact-binding branch consumes once and reports it` expects allow but receives deny. At that snapshot, `src/governance/policy/policy-gate.ts` called `consumeApproved(approved.id, bindingKey, {})` without trusted worker/attempt or expected invocation. This is a consumption integration gap before the D7 outcome methods. Production policy/consumption enforcement was not weakened or widened to hide it. Independent review must retain this failing result.

**Fixture corrections:** four crash simulations now provide `record.invocation` when claiming their invocation-bound approvals. The coordination propagation fixture now persists the exact expected invocation, retaining all original allow/single-use/replay assertions; at that snapshot its missing production consumption context still failed. Existing unrelated edits to those test files are preserved.

**Earlier attempts:** overlapping initial test/build runs were interrupted (exit 130) after slow execution and an observed 10-second Vitest timeout; they are not success evidence. The first Node regression invocation returned 5 passing / 3 failing file wrappers. Direct diagnostics exposed four crash-fixture failures, one coordination propagation failure and two new restart-test failures. A child-process probe confirmed children execute but their stdout is not captured in this environment; restart tests now require explicit per-child JSON receipt files and persisted store read-back. No child success is inferred from empty output. The final Node run disables test-file isolation to obtain actual case-level counts, while the D7 restart tests still spawn real independent Node processes.

## Limits and review disposition

- The full store remains privileged. Independent review must verify that worker composition roots provide only the restricted port and that the preserved legacy and host paths are appropriate.
- GitNexus impact returned LOW for the two store methods and port factory, with one indexed caller each and no indexed affected processes. The index is 45 commits behind and reports unresolved interface calls, so these are lower bounds. Current text inspection also located executor, policy-gate and continuation callers. No graph-based all-clear or independent security verdict is claimed.
- Existing request attribution, first-result lookup ambiguity, D6/D8 historic migration breadth, host/isolated-worker end-to-end D9, and independent D1–D9 qualification remain outside this slice.
- DOX pass: updated the closest approvals contract. Root and `docs/AGENTS.md` intentionally untouched by this task: no repository-wide workflow, ownership, or child index changed. Existing unrelated staged, unstaged and untracked work is preserved.
- No commit, push or merge performed. **D7 is ready for independent review of the atomic outcome change.** The coordination regression failed at the initial snapshot and passed in the follow-up below; the previously blocked automated DOX check remains a disclosed limitation. LEAN-G01 remains BLOCKED and independently unreviewed.


## Follow-up: coordination regression verification — 2026-10-26

**Result:** the operator-supplied PolicyGate change resolves the previously observed coordination consumption regression in the rebuilt working tree. This follow-up changes test assertions and evidence only; it makes no production authorization edits and introduces no new authorization contract.

1. Confirmed the previous Vitest session (`62904`) finished with exit 0; its retained result was 49/49 passing tests. The new Vitest run below also finished with exit 0.
2. Extended `tests/security/approval-consumed-propagation.test.ts` to reload the authoritative ledger immediately after the approved exact-binding consumption. It verifies status `consumed`, the original binding key, `consumedByWorkerId: "w1"`, `consumedAttempt: 0`, pending execution outcome, the exact persisted invocation/fingerprint, and a nonempty claim timestamp.
3. The same test evaluates the identical request again and requires deny with `consumed-binding-denied`, no replacement approval ID, then reloads the ledger again. The record remains consumed with the same timestamp, worker, attempt and invocation, and the store still contains exactly one approval. This verifies durable single-use behavior, not only an in-memory allow result.

| Executed check | Result |
|---|---|
| Coordination consumption regression, rebuilt Node test | **4 passed / 0 failed**, 1 suite, exit 0; 4.38 s |
| Combined D7 acceptance and seven Vitest approval regression files | **135 passed / 0 failed**, 8 files, exit 0; 311.62 s |
| Other seven rebuilt Node approval/security regression files | **55 passed / 0 failed**, 8 suites, exit 0; 142.09 s; includes both D7 fresh-process cases |
| `pnpm build` after the persisted-state assertions were added | PASS, exit 0 |
| `pnpm typecheck` | PASS, exit 0 |
| `pnpm typecheck:unused` | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |

**Follow-up total: 194 distinct tests passed / 0 failed; no skips or cancellations.** The targeted four tests are excluded from the other Node command, so this total does not count them twice. The 88 D7-specific cases remain green within this total.

Exact test commands (after rebuilding current source and tests):

```sh
node --test --test-isolation=none --test-concurrency=1 dist/tests/security/approval-consumed-propagation.test.js
pnpm exec vitest run --config vitest.config.mts --pool forks --maxWorkers 1 --testTimeout 30000 tests/security/worker-approval-atomic-outcome-acceptance.vitest.ts tests/security/worker-approval-port.vitest.ts tests/security/worker-approval-identity-acceptance.vitest.ts tests/security/worker-approval-invocation-acceptance.vitest.ts tests/security/worker-approval-legacy-migration-acceptance.vitest.ts tests/security/worker-approval-visibility-acceptance.vitest.ts tests/security/approval-event-dedup.vitest.ts tests/approvals/approval-store-events.vitest.ts
node --test --test-isolation=none --test-concurrency=1 dist/tests/approvals/approval-store.test.js dist/tests/approvals/approval-binding.test.js dist/tests/approvals/approval-store-lock.test.js dist/tests/approvals/approval-ledger-dualwrite.test.js dist/tests/security/approval-crash-recovery.test.js dist/tests/security/legacy-approval-single-use.test.js dist/tests/security/worker-approval-atomic-restart.test.js
```

No blocked source inspection or DOX operation was bypassed. The supplied production change was verified through executed tests; no restricted inspection was retried. GitNexus file impact for the test returned UNKNOWN (no callers resolved; stale index); direct reference search confirmed the standalone test file before assertions were extended. This is not a graph-based production safety verdict.

DOX pass: root, approvals and documentation instructions were checked. No AGENTS.md changes are needed for this verification-only extension: ownership, interfaces, workflows and child indexes are unchanged. Existing unrelated worktree changes, including the supplied PolicyGate change, were preserved. No commit, push or merge was performed.

**Gate disposition:** the coordination regression is now verified passing. D9 host/isolated-worker end-to-end integration and independent security review remain pending; other previously disclosed D1–D9 limits remain. LEAN-G01 stays **BLOCKED**, incomplete and independently unreviewed.
