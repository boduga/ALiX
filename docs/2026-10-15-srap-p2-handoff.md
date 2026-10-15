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
| P3 — workspace authorization plumbing | **next** — not started |
| P4 — physical SSD benchmark | not started (no SSD on this host) |
| P5 — independent G2-C re-review | not started |

Baseline: `main` == `origin/main` == `52c0ea87` (P1 + G2-D/E + P2 all merged).

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

## P2 (PR #947) — what is proposed

`fix(storage): open the ledger append transaction with BEGIN IMMEDIATE`,
commit `eb2a553a`, branch `srap/p2-ledger-immediate-txn`.

- `src/runtime-state/storage/runtime-ledger.ts` — `append()` now calls
  `tx.immediate()` (was `tx()`); comment explains the deferred read→write upgrade
  that yields `SQLITE_BUSY_SNAPSHOT` (not resolvable by `busy_timeout`).
- `src/runtime-state/storage/AGENTS.md` — the BEGIN IMMEDIATE contract note.
- `tests/storage/runtime-ledger-contention.test.ts` — real multi-process `fork`
  tests: independent-entity throughput (0 `SQLITE_BUSY`) and same-entity
  optimistic conflicts. **Red on deferred (~18,800 busy), green on immediate (0).**

P2 is independent of the uncommitted G2-B `synchronous=FULL` change (different
lines), so it is a clean standalone PR against `main`.

## G2-D/E work — now MERGED (#948)

The former uncommitted G2-D/E line (durability pin + contract reconciliation) is
now committed and merged on `main` via PR #948 (`68978fe8`): the `synchronous=FULL`
pin + `durabilitySettings()` in `runtime-ledger.ts`, the Child DOX Index row, the
approvals/server/audit/storage contract rules, and the new
`src/governance/security/credentials/AGENTS.md`. No uncommitted tracked work
remains on `main`.

Remaining untracked, deliberately NOT committed (unrelated to SRAP): the
screenshots/`alix-header.png`/`no-render-md*.png` images, the two workbench
handoffs, and `tests/cli/commands/governance-workbench-trace-wiring.vitest.ts`.

Do NOT `git add .` in the main worktree — it sweeps those unrelated untracked
files in.

## Key facts a new session needs

- **Repo:** `/home/babasola/Projects/ALiX` (git remote `boduga/ALiX`). `gh` auth
  works as `boduga`; GitHub network is intermittently flaky — retry pushes/queries.
- **This host's disk is a rotational HDD** (`WDC WD10SPZX`, `rotational=1`).
  `synchronous=FULL` single-append ≈ 14 writes/s here; **no physical SSD present**
  — P4 needs real SSD hardware.
- **Build/test:** `pnpm build` (= `tsc -p tsconfig.json` + `copy-build-artifacts`),
  `pnpm test:node` (node:test over `dist/tests`). **Always `rm -rf dist` before a
  clean build**: a stale git-ignored `dist/tests/tests/` duplicate tree inflates
  the test count and creates fake path failures.
- Local full `pnpm test:node` had 3 pre-existing timing flakes
  (`coordination-scheduler` ×2, `observability-stream` ×1); sources byte-identical
  to baseline — environmental, not code.
- Worktree helper: `tools.opencode.worktree_create` + `git switch -c`. In a fresh
  worktree, symlink `node_modules` → main worktree (`ln -sfn …/node_modules`),
  build with `node node_modules/typescript/bin/tsc -p tsconfig.json`.

## Next steps

1. ~~P2 merge~~ — **done** (#947 merged `52c0ea87`).
2. **P3 — Inspector workspace authorization** (from G2-E §B):
   - derive one canonical workspace identity at `startServer` —
     `realpathSync.native(resolve(root))` (today it uses raw `process.cwd()`);
   - carry the principal's `workspaceIds` through `SecurityContext`
     (`security-context.ts` — currently dropped in `security-middleware.ts`);
   - wire the existing-but-unused `AuthService.verifyTokenForRequest`; add a
     `--workspace` enrollment surface for `alix inspector auth create`;
   - fail-closed: missing/empty scope denies; request input never sets scope.
   The predicate + binding parity requirement now live (merged) in
   `src/governance/approvals/AGENTS.md`; the case matrix is in
   `docs/2026-10-14-srap-g2-e-operational-verification.md` §B.3.
3. **P4:** run `scripts/benchmark-runtime-ledger-workloads.mjs` on a physical SSD;
   confirm the G2-E acceptance thresholds (§A.7 of the G2-E report).
4. **P5:** independent G2-C re-review of the merged fixes + contracts.

Do not implement the SRAP remote approval endpoint or any new approval authority,
scheduler, state machine, or ledger until G3 is explicitly opened.

## Read these first

1. `docs/2026-10-14-srap-g2-e-operational-verification.md` — the P-series rationale,
   the two defects (audit stale-head, ledger contention), and the contract details.
2. `docs/2026-10-15-p1-audit-chain-recovery.md` — P1 delivery record.
3. `docs/architecture/adrs/ADR-0015-srap-one-ledger-decision-evidence.md`.
4. `docs/2026-10-14-srap-g2-c-independent-review.md` — original BLOCKED review.
5. Root `AGENTS.md`, `docs/AGENTS.md`, and the owning subsystem AGENTS.md files.
