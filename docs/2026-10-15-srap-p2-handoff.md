# SRAP-1 G2-E/P-series handoff — new session

Updated: 2026-10-15

## Mission and current gate

Continue the SRAP-1 remediation ordered after the G2-C BLOCKED review. **G3 is
closed.** The current work is the **P-series of standalone infrastructure fixes**
that G2-E proved are prerequisites, before SRAP-1 endpoint implementation and the
final independent G2-C re-review.

Order (from the operator): P1 audit-chain recovery → P2 RuntimeLedger immediate
transactions → P3 Inspector workspace authorization plumbing → P4 physical-SSD
benchmark → P5 independent G2-C re-review.

### Status

| Piece | State |
| --- | --- |
| P1 — audit-chain stale-head recovery | **MERGED** — PR #946, merge `a0d8fda0` |
| P2 — ledger `BEGIN IMMEDIATE` (+ open-retry, contention retry) | **MERGED** — PR #947, merge `52c0ea87` |
| G2-D/E durability + contract reconciliation | **MERGED** — PR #948, merge `68978fe8` |
| P3 — workspace authorization plumbing | **MERGED** — PR #950, merge `7103ec56` |
| P4 — physical SSD benchmark | **measurements complete, review pending** — SSD thresholds met; tail latency remains a P5 review item |
| P5 — independent G2-C re-review | not started |

Baseline: `main` == `origin/main` == `7103ec56` (P1 + G2-D/E + P2 + P3 merged).

## P2 (merged) — what landed

PR #947, merge `52c0ea87`. Two commits' worth of work squashed/rebased onto the
G2-D/E base:

- `src/runtime-state/storage/runtime-ledger.ts` — `append()` opens its
  transaction with `BEGIN IMMEDIATE` (`tx.immediate()`), so the write lock is
  taken up front instead of deferring a read→write snapshot upgrade (which
  produced `SQLITE_BUSY_SNAPSHOT`, unresolvable by `busy_timeout`). New
  `openDurableLedger()` sets `busy_timeout` before the WAL switch and retries the
  open a bounded number of times on `SQLITE_BUSY` (a fresh shared file can return
  BUSY during the WAL conversion even with `busy_timeout` set). `append()` retries
  a transient `SQLITE_BUSY` but still returns typed
  `version_conflict`/`invalid_precondition`/`duplicate_event`.
- `src/runtime-state/storage/AGENTS.md` — the BEGIN IMMEDIATE + open/append-retry
  contract.
- `tests/storage/runtime-ledger-contention.test.ts` — real multi-process (`fork`)
  tests; captured-stderr child failures, guarded construction, workload-rationale
  timeouts.
- Red→green: deferred ≈18,800 `SQLITE_BUSY`/7s → 0, stable across repeated runs.

## P1 (merged) — what landed

`fix(audit): recover stale head sidecar without reallocating sequence`, PR #946.

- `src/governance/security/audit/audit-chain-writer.ts` — `reconcileHead()` under
  the audit lock: hash-valid fast path; else verify from genesis and advance a
  stale sidecar only when it is a **verified ancestor** of the persisted tip;
  fail closed on malformed tail / seq gap / duplicate / hash break / non-ancestor
  sidecar / legacy-tail-over-chain / no-records / over-window final record.
  Bounded tail read (256 KB) with a `truncated` fail-closed flag.
- `src/governance/security/audit/audit-verifier.ts` — `tip` + `requestedRecord`
  bounded identities (captured only for **chain-valid** records); carries the
  record's own `timestamp`.
- `src/governance/audit/AGENTS.md` — chain-verified recovery + fast-path trust
  boundary (do NOT re-touch; P1 owns these lines).
- `tests/audit/audit-chain-recovery.test.ts` (14 cases), `scripts/probe-audit-chain-crash.mjs`,
  `docs/2026-10-15-p1-audit-chain-recovery.md`.

Note: P1's `audit/AGENTS.md` change deliberately contains **only** the P1 lines.

## G2-D/E work — now MERGED (#948)

The former uncommitted G2-D/E line (durability pin + contract reconciliation) is
now committed and merged on `main` via PR #948 (`68978fe8`): the `synchronous=FULL`
pin + `durabilitySettings()` in `runtime-ledger.ts`, the Child DOX Index row, the
approvals/server/audit/storage contract rules, and the new
`src/governance/security/credentials/AGENTS.md`. No uncommitted tracked work
remains on `main`.

Previous-device unrelated untracked artifacts were deliberately excluded from
SRAP work. Current main checkout is clean; P4 evidence is isolated in its review worktree.

## Key facts a new session needs

- **Current repo:** `/home/babasola/Projects/Monolith` (git remote `boduga/ALiX`). `gh` auth
  works as `boduga`; GitHub network is intermittently flaky — retry pushes/queries.
- **Previous device's disk was a rotational HDD** (`WDC WD10SPZX`, `rotational=1`).
  `synchronous=FULL` single-append ≈ 14 writes/s there; **no physical SSD present**
  on that previous device. The current device has SSD (operator confirmed); P4
  must measure the actual volume containing `.alix/runtime-ledger.db`, not tmpfs.
- **Build/test:** `pnpm build` (= `tsc -p tsconfig.json` + `copy-build-artifacts`),
  `pnpm test:node` (node:test over `dist/tests`). **Always `rm -rf dist` before a
  clean build**: a stale git-ignored `dist/tests/tests/` duplicate tree inflates
  the test count and creates fake path failures.
- Previous-device full `pnpm test:node` had 3 pre-existing timing flakes
  (`coordination-scheduler` ×2, `observability-stream` ×1); sources byte-identical
  to baseline — environmental, not code.
- Current P4 evidence worktree: `/home/babasola/Projects/Monolith/.worktrees/srap-p4`, branch
  `srap/p4-ssd-benchmark`. Locked dependencies installed locally on Node 26.11.0;
  pnpm 12 rejects the earlier handoff's node_modules symlink setup.


## Next steps

1. P1, P2 and P3 are merged (#946, #947, #950).
2. Review P4 SSD evidence in `docs/2026-10-15-srap-p4-ssd-benchmark.md` and
   `docs/audits/2026-10-15-srap-p4-ssd-results.json`. Proposed p95/read/error
   thresholds pass; saturated append maxima reach 5.02 s and remain a review risk.
3. P5: independent G2-C re-review of merged fixes, amended contracts and P4
   evidence. G3 remains closed pending that review and explicit authorization.

Do not implement the SRAP remote approval endpoint or any new approval authority,
scheduler, state machine, or ledger until G3 is explicitly opened.

## Read these first

1. `docs/2026-10-14-srap-g2-e-operational-verification.md` — the P-series rationale,
   the two defects (audit stale-head, ledger contention), and the contract details.
2. `docs/2026-10-15-p1-audit-chain-recovery.md` — P1 delivery record.
3. `docs/architecture/adrs/ADR-0015-srap-one-ledger-decision-evidence.md`.
4. `docs/2026-10-14-srap-g2-c-independent-review.md` — original BLOCKED review.
5. Root `AGENTS.md`, `docs/AGENTS.md`, and the owning subsystem AGENTS.md files.

## P3 and P4 status

Approved design and conditions:
`docs/superpowers/specs/2026-10-15-srap-p3-workspace-authorization-design.md`.
Plan: `docs/superpowers/plans/2026-10-15-srap-p3-workspace-authorization.md`.
Undefined scope preserves ordinary legacy access; explicit empty scope denies;
nonempty scope requires canonical membership. Cookies revalidate source tokens.
P3 merged as `7103ec56`; its worktree and feature branch are removed.
P4 evidence worktree: `/home/babasola/Projects/Monolith/.worktrees/srap-p4`, branch `srap/p4-ssd-benchmark`.
Nine workload runs and three complete-snapshot crash probes passed. Current
device is SSD-equipped. P5 independent review is next; G3 remains closed.
