# PR 1003 remaining fixes — OpenCode handoff

Point-in-time record: 2026-10-30 (continued). Workspace `/home/babasola/Projects/ALiX-d9-remediation-v2`, branch `fix/d9-phase-f-remediation-v2`, baseline HEAD `16a88366`. Node used: 26.11.0.

Supersedes the earlier revision of this file, which recorded three unresolved full-qualification failures. They are now diagnosed, fixed, and re-verified; **full qualification passes** (counts below). No commit or push was performed.

## Objective and current state

The operator asked to fix the remaining PR 1003 findings, then rerun Node live-step tests, targeted Vitest tests, and full qualification. Findings concerned atomic approval precedence (including equal timestamps), uncertain deletion effects bypassed by a new replay ID, and fixtures expecting execution on unsupported platforms. Those fixes and parity tests are already committed.

Recent committed baseline:

- `7142a40d`: approval precedence, replay-effect quarantine, and associated fixes.
- `f35d2448`: close MCP clients when registration fails.
- `6049fbe9`: publish daemon startup status without a second truncating write.
- `16a88366`: isolate reconciliation crash checkpoints.

`src/runtime-state/storage/mutation-queue.ts` already provides the shared process-local FIFO: approval and coordination mutations use it before acquiring their existing cross-process locks, canonicalizing resource paths, serializing separate store instances, refreshing a monotonic idle-progress budget, expiring stalled waiters without running their callbacks, and releasing admission after errors. Cross-process locking, authoritative re-reads, CAS, and fail-closed behavior are unchanged.

## What was actually wrong (measured, not hypothesized)

The prior handoff called I/O contention a hypothesis. It was measured here and split into two independent causes plus one test-budget defect.

1. **The audit writer paid two `fsync`s per append.** This host's fsync costs ~100–250 ms (`/sys/block/sda/queue/rotational` = 1, disk at ~83% util). `AuditChainWriter.doAppend` fsyncs the JSONL record (the real durability barrier), then `writeHeadAtomic` fsynced the head sidecar temp file before renaming. A/B on the built tree, same box: 150 appends cost 41.6 s / 33.2 s unfixed vs 21.6 s / 16.3 s without the sidecar fsync. That is the whole difference between passing and exceeding the 600 s and 60 s budgets.
2. **The ledger schema cost six fsyncs per fresh open.** Under `synchronous=FULL` every implicit commit fsyncs, so `db.exec(SCHEMA)` committed each `CREATE` separately: measured 1056 ms unwrapped vs 243 ms wrapped. A fresh `getSharedLedger` open measures ~1.0–1.2 s, and the D9 parity fixture opens one per test.
3. **The D9 parity row had no workload-scaled budget.** It inherited the global `testTimeout: 10000`. Each row rebuilds a whole durable fixture (ledger open, approval resolve, one full approved execution, run patch, mutation, resume). Measured solo on this box: fixture ≈1.3–2.2 s, total ≈3.0–3.9 s against a 10 s budget — 3× headroom solo, which the full parallel suite exhausted at 10.887 s. The file already uses explicit workload budgets for exactly this reason (one row sets `{ timeout: 30_000 }`); this row was simply missing one.

## Fixes applied

- `src/governance/security/audit/audit-chain-writer.ts` — `writeHeadAtomic` no longer fsyncs the sidecar temp file. The sidecar is a **recoverable fast path, not durable evidence**: the fsynced JSONL append is the durability barrier, and `reconcileHead` already re-derives the head when it is missing, zero-length, malformed, or stale, failing closed on a corrupt chain. Rename still makes publication atomic. No lock, authorization, tie-break, or fail-closed behavior was weakened.
- `src/runtime-state/storage/runtime-ledger.ts` — the `SCHEMA` DDL batch runs in one `db.transaction(...)`. Behaviour-preserving (`IF NOT EXISTS` is idempotent; a half-applied schema is now unobservable) and it removes five fsyncs per fresh open.
- `tests/security/daemon-tool-continuation-acceptance.vitest.ts` — the `consumed recovery parity: <fault>` rows get `{ timeout: 30_000 }`, matching the sibling scheduler row's documented rationale. Assertions are untouched; only the wall-clock budget changed.

No budget was raised for the two audit cases, and no lock or authorization assertion was relaxed.

## Uncommitted changes to preserve

Inspect `git diff` before changing or committing anything; preserve unrelated operator work.

- `tests/stress/approval-store-stress.test.ts` — close the shared ledger before deleting fixture workspaces; require all deduplicated requests to succeed and exactly one pending approval record.
- `tests/stress/coordination-store-stress.test.ts` — close the shared ledger before cleanup; assert that completion/failure/running updates return a record, so a fulfilled `null` is not counted as success. Intentional stale-CAS rejection remains expected.
- `src/governance/approvals/AGENTS.md`, `src/coordination/kernel/AGENTS.md` — document those stress assertions and ledger cleanup.
- `src/governance/audit/AGENTS.md` — record that the sidecar is a recoverable fast path and that re-adding a sidecar fsync would be a regression.
- `src/runtime-state/storage/AGENTS.md` — record the single-transaction schema rule.
- `tests/audit/audit-chain-recovery.test.ts` — new case asserting that every post-crash sidecar shape a non-fsynced publication can expose (zero-length, stale ancestor, garbage, missing) is re-derived onto the existing chain and the log still verifies. It guards the safety condition that makes the dropped fsync permissible; it is not a cost assertion (it also passes with the fsync re-added).
- `tests/storage/runtime-ledger.test.ts` — new case asserting one open installs a complete, immediately usable, idempotently re-openable schema. Like the audit case, it pins the behaviour the single-transaction schema change must preserve, not the fsync count itself.
- `tests/security/daemon-tool-continuation-acceptance.vitest.ts` — the parity-row budget described above.

## Executed evidence

Targeted lanes, run sequentially (never concurrent) from the rebuilt tree:

| Case | Before | After |
|---|---|---|
| `verifies a 1000-record v2 chain correctly` | 626,745 ms → timeout | 128,880 ms → pass |
| `100 concurrent appends produce contiguous sequence` | `LOCK_TIMEOUT` @60 s | 11,871 ms → pass |
| `consumed recovery parity: session` (Vitest) | timeout @10,887 ms | pass, file 61/61 in 283 s |

- `node --test --test-concurrency=1 dist/tests/stress/audit-concurrency.test.js dist/tests/security/audit/audit-large-log.test.js` → **7 passed, 0 failed, 0 cancelled, 0 skipped** (159 s). Log: `/tmp/opencode/audit-fixed.log`.
- `npx vitest run --config vitest.config.mts tests/security/daemon-tool-continuation-acceptance.vitest.ts` → **61 passed** (283 s). Log: `/tmp/opencode/d9-fixed.log`.
- Crash-recovery and ledger suites (recovery, integrity, security/audit, `runtime-ledger`, `runtime-ledger-contention`) → **131 passed, 0 failed**; then **35 passed** after adding the two regression cases. Logs: `/tmp/opencode/recovery-verify.log`.

Gates after the changes:

| Check | Result |
|---|---|
| `pnpm build` | pass |
| `pnpm typecheck` | pass |
| `pnpm typecheck:unused` | pass |
| `tsc -p tsconfig.tests.json --noEmit` | pass |
| `pnpm check:dead` | pass |
| `pnpm verify:deps` | 24 pins |
| `pnpm check:dox` | 8 AGENTS files, 32 tokens resolve |
| `git diff --check` | pass |
| `detect_changes --scope all` | 11 files, 8 symbols, 0 affected processes, risk low, no `partial`/`truncated` |

Full qualification — `pnpm test:ci`, run on an otherwise idle machine after the fixes:

- Node: **9,152 passed, 0 failed, 0 cancelled, 4 skipped; 9,156 tests.**
- Vitest: **737 files passed, 2 skipped; 8,086 tests passed, 0 failed, 10 skipped.**
- Exit code **0**. Log: `/tmp/opencode/opencode-full-qualification-clean.log`.

An earlier attempt at the same command (log `/tmp/opencode/opencode-full-qualification.log`) exited 1 with 5 Node failures in two unrelated files — `tests/daemon/daemon-universal.test.ts` (`Daemon did not start within 5s`) and `tests/governance/governance-report.test.ts` (`CLI execution succeeds with valid bundle`, a 30 s `npx tsx` spawn). Both passed standalone immediately afterwards (daemon case 3.1–4.0 s; governance case 2.7 s against its 30 s budget), and the daemon itself reaches `listening` in ~100 ms idle. That run was **contaminated by this session**: verification scripts and standalone suites were executed while `pnpm test:ci` was running, which is exactly the "do not run duplicate full suites concurrently" hazard — the added load pushed two spawn-budget-guarded cases over their fixed limits. The clean rerun with nothing else running is the authoritative result. Recorded here so the false red is not mistaken for a product defect later.

Vitest now passes the formerly failing D9 parity row without any product change to that path; only the row's budget changed.

## Code review (2026-10-30, two-axis) — outcomes

A two-axis review of `git diff main...HEAD` (60 commits, 152 files) produced 3 hard standards violations, 5 standards judgement calls, and 6 spec findings. Every finding was verified against the code before acting. Durable outcomes:

**Fixed**
- **Untyped event vocabulary.** `ownership.state_invalid` was emitted as a raw string outside `OWNERSHIP_EVENT_TYPES`. `STATE_INVALID` is now in both constant copies (`ownership-types.ts`, `runtime-state/events/types.ts`), the registry emits the constants, and the event-contract count table records 9 ownership types.
- **Replay route bypassed the effect journal.** `file.create` and `patch.apply` on the approved-live replay route wrote directly; only shell and delete were journaled, contradicting Slice D's "no alternate unguarded dispatch route". Both are now wrapped. `patch.apply` (high risk) genuinely journals — pinned by a non-vacuous test that fails if the journal is bypassed. `file.create` (medium risk) remains a pass-through because journal membership is governed by `requiresEffectJournal`, unchanged.
- **Slice F had no production entry point.** `reconcileEffectRecord` was test-only, so a quarantined effect had no operator remedy. Added `alix effects list|request|reconcile` (`src/interfaces/cli/commands/effects.ts`). It adds no authorization semantics: it recomputes the original invocation identity and delegates every authority/evidence/identity decision to the journal. Verified end-to-end: list → request (pending) → reconcile refused before approval → approve → reconcile → `reconciled_success`. Pinned by `tests/security/effects-cli.vitest.ts`.
- **Approval "newest wins" comparators disagreed.** `list()` broke no ties while the binding index and `consumeApproved` did, so `claimLiveStep` could select a different record than the store's own authority check. `list()` and `findResolved` now break ties by id, matching precedence.
- **Duplicated `approval.created` emission.** Extracted `emitBlockedStepApprovalCreated` beside `claimLiveStep`; replay and rollback executors both use it.
- **Dead construct.** Removed the `try/catch → rethrow` no-op in `effect-journal.ts`.
- **Four timing-sensitive vitest cases lacked explicit budgets** (`CONTRIBUTING.md` requires them): three in `effect-journal-dispatch-matrix.vitest.ts`, one in `d9-phase-f-shell-counterexamples.vitest.ts`, one ordering case in `effect-journal.vitest.ts`; plus the missing rationale comment in `remote-decision-parity.test.ts`.
- **DOX closeout** for three changed contracts: ownership lock semantics, the `ApprovalStoreLock` `lockPath` override used by the effect journal and ownership, and the continuation deny re-check.

**Deliberately not changed (finding was wrong)**
- **Shell should record `terminal_failure` for non-zero exit.** Rejected. `terminal_failure` and `started_unknown` block replay identically, so the change alters no safety — it would only mislabel a compound command that may have mutated before failing. `outcomeUnknown` is the correct classification and is now documented as such.
- **Audit sidecar fsync removal called scope creep.** Kept, per operator decision. It is a measured fix (two qualification cases from timeout to pass) and is documented in `src/governance/audit/AGENTS.md` and this record; reverting it re-breaks full qualification.

**Accepted as known open items (not defects to fix here)**
- Linux ARM64 native qualification is still absent; `docs/prd/evidence/lean-01/D9-phase-f-slice-g-governance-reconciliation-2026-10-29.md` records it as a Phase F blocker. It requires an ARM64 host, not a code change.
- The Harness PRD v1.2 status/acceptance rewrite and the repeated expiry tri-state cascade across nine authorization sites remain judgement calls. The cascade is intentional: each site applies its own fail-closed outcome (deny / fresh request / allow), and collapsing them would touch nine security-critical decision paths for readability alone.

**Found while fixing (not in either review)**
- The new `alix effects` handler first imported the protected approval store directly, which the R1 boundary freeze rejects (`status-store-writes`). It now uses the sanctioned `openApprovalStores` CLI helper, so the command adds no direct status-store write edge. Caught by `tests/architecture/r1-boundary-freeze.test.ts`, not by either reviewer.
- `check:dox` rejected two claims in the first draft of the AGENTS.md update: model-facing tool names must use the `alix_*` vocabulary (`alix_file_create` / `alix_patch_apply`, not executor IDs), and added paths only resolve once committed. Both fixed.

## Verification after the review fixes

Full qualification, run clean with nothing else on the machine:

- `pnpm test:ci` → exit **0**. Node **9,153 passed, 0 failed, 0 cancelled, 4 skipped** (9,157 tests). Vitest **738 files passed, 2 skipped; 8,090 passed, 0 failed, 10 skipped** (8,100 tests). ~489 s. Log: `/tmp/opencode/final-full-qualification.log`.
- Build, `pnpm typecheck`, `pnpm typecheck:unused`, `tsc -p tsconfig.tests.json --noEmit`, `pnpm check:dead`, `pnpm verify:deps` (24 pins), `pnpm check:dox` (8 AGENTS files, 40 tokens), `git diff --check` — all pass.
- Architecture gates pass: `r1-boundary-freeze` and `layer-boundaries` (8/8).
- `detect_changes --scope all` on a clean tree reports no changes; `--scope compare --base-ref main` reports 159 files / 12 affected processes / risk high for the **whole 61-commit branch**, not this change set. The per-symbol graph query returned `UNKNOWN` because the MCP index is stale, so callers were confirmed by text search (`claimLiveStep`, `executeWithEffectJournal`, `emitBlockedStepApprovalCreated`, `OWNERSHIP_EVENT_TYPES` — all bounded and exercised).

Two commits: `3c94d5b0` (review findings) and `c6e1bb3b` (R1 boundary fix). Nothing pushed.

## Limitations

- The measured per-append cost is a property of this host's rotational disk. The fixes remove redundant durability work and a missing budget rationale; they do not make the suite independent of disk speed. Anything that pays a real fsync per operation stays latency-bound here, so future budget decisions should cite a measured per-operation cost rather than a peak-run duration.
- GitNexus MCP reported an index four commits behind HEAD and could not resolve several symbols; the CLI against this absolute path resolved them (`AuditChainWriter` → 628 impacted, CRITICAL, depth 1 = 1). Another registered checkout also uses the name ALiX — always pass the absolute path.
- Private stress-fixture helpers still resolve as `UNKNOWN` pre-edit impact; text checks confirmed local callers. That is not evidence of no impact.

## Continue here

1. Read the full-qualification log and report its real counts. If a case still fails, diagnose it from evidence rather than raising a budget.
2. Keep OS-lock ownership, denial, timestamp-tie, exact-binding, uncertain-effect, and unsupported-platform behavior fail-closed.
3. Preserve the local stress assertions; fulfilled `null` updates must not count as success.
4. Complete DOX and graph change checks before committing (already run for this change set).

The operator requires EGM as the sole agent workflow framework; use direct tools for routine verification, repository safety, GitNexus, and DOX checks. Provider secrets stay in the credential store; real-model tests use the operator's current configured default model. Local `/tmp` logs are session evidence and may not survive transfer; copy relevant failure evidence into a durable record if needed.
