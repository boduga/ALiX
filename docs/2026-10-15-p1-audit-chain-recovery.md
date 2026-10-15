# P1 — Audit-Chain Crash Recovery (standalone infrastructure fix)

- Date: 2026-10-15
- Baseline: `main` / `HEAD` = `2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e`
- Scope: **audit-chain recovery and its tests only** — no SRAP endpoint, audit
  projection, batching, or RuntimeLedger change
- Status: committed on `srap/p1-audit-chain-recovery` as `f393d8ea` (PR #946) — not merged

## Root cause

`AuditChainWriter.doAppend` appends the audit JSONL line and fsyncs it, then
writes `head.json` **last**. Head recovery (`recoverHeadFromLog`) ran **only when
the head was missing or malformed** — not when it was merely stale. A crash after
the JSONL fsync but before the head write therefore left a **stale-but-valid**
sidecar, and the next append reused the committed `seq`/`prevHash`, producing a
duplicate sequence and `verifyIntegrity()` `head_mismatch` findings.

Deterministic repro: `scripts/probe-audit-chain-crash.mjs`
(original output: `seqs [1,2,3,4,4]`, `verificationOk=false`).

## Fix

`src/governance/security/audit/audit-chain-writer.ts` — new `reconcileHead()`
runs under the existing audit lock and treats the **persisted JSONL chain as
authoritative**:

- **Fast path:** a sidecar that exactly matches the persisted, hash-valid tip is
  trusted (routine appends stay O(1)).
- **Recovery:** otherwise the chain is verified from genesis. A stale sidecar
  that is a **verified ancestor** of the persisted tip is advanced to the tip;
  `head.json` is healed, the JSONL is never touched.
- **Fail closed:** malformed tail, sequence gap/duplicate, hash break, a
  non-ancestor/conflicting sidecar, a legacy tail after the v2 chain, and a
  sidecar with no persisted records all throw. Nothing is truncated, rewritten,
  or discarded.
- **Bounded tail read** (`readPersistedTip`, ≤256 KB, short-read-safe) keeps the
  hot path from loading the whole log.

`src/governance/security/audit/audit-verifier.ts` — `streamVerify` now captures
**bounded** identity during its streaming pass: `tip` (last chain-valid record)
and, when `VerifyOptions.requestedSeq` is supplied, the single
`requestedRecord` at that seq. Identities are captured only for records that are
themselves chain-valid (correct seq, prevHash link, and recomputed hash), so
`tip`/`requestedRecord` always describe verified chain members. The earlier full
`records[]` array (reviewer point 2) was removed so the recovery path's retention
does not grow with log size. (The verifier's pre-existing `seenSeqs`
duplicate-detection set still scales with record count; that is unchanged.)

The bounded tail reader sets a `truncated` flag when the final record line
exceeds the 256 KB window, and `reconcileHead` fails closed on it rather than
misreading a partial line.

## Trust boundary (reviewer point 1)

The fast path treats an exactly-matching, hash-valid sidecar as a trusted
checkpoint; it does not re-verify the whole chain on every append. Historical
corruption remains detected by the separate verification seam —
`alix audit verify` / `AuditStore.verifyIntegrity()` (`verify --all`), which
streams the full chain — while the recovery path fully verifies from genesis
whenever the sidecar and persisted tip disagree. This assumption is stated in
`src/governance/audit/AGENTS.md`.

## Regression

`tests/audit/audit-chain-recovery.test.ts` — 13 cases: normal append, missing
head, malformed head, stale head after JSONL fsync, crash/restart + append,
corrupt tail, conflicting head (hash differs / seq ahead), final record larger
than the tail window, emptied log, bounded-identity on a larger log, **matching
ancestor in a corrupt chain never authorizes recovery**, concurrent appenders.

> Invariant (reviewer): `requestedRecord` is consulted only after the whole
> chain verifies — `reconcileHead` throws on any structural finding before it
> compares `requestedRecord` to the sidecar, so a matching ancestor inside a
> corrupt chain can never authorize recovery.

- `scripts/probe-audit-chain-crash.mjs` → `duplicateSeq:false`, `seqs [1..5]`,
  `afterRecoveryOk:true`.
- `tests/audit/*` + `security/audit/{chain-writer,verifier,activate,checkpoint}`
  → 87 passed.
- `pnpm build`, `typecheck:unused`, `check:dead`, `check:dox`, `verify:deps` pass.
- Full `pnpm test:node` — see commit gate.

### Full-suite gate result (2026-10-15)

Clean build (`rm -rf dist && pnpm build`), single `pnpm test:node` run:

- **tests 8582, pass 8573, fail 3, exit 1.**
- All 12 P1 recovery tests passed *inside* the full run.
- The 3 failures are pre-existing/environmental timing flakes, **not P1-related**:
  `coordination-scheduler` "watchdog ticks…" and "a settling worker wakes…"
  (timing cadence), and `observability-stream` "25 clients share one producer
  cycle" (passes in isolation). Proof: those tests' sources are byte-identical to
  baseline `2c73b044` (`git diff --name-only 2c73b044 -- …` is empty), P1 changes
  only `src/governance/security/audit/*` + its test/DOX, and nothing under
  `src/coordination/` or `src/interfaces/server/` imports the changed audit code.
- Note: an earlier run reported 17143 tests / 61 fail / exit 1 — that was a
  **stale git-ignored `dist/tests/tests/` duplicate tree** (712 files dated
  Oct 13, predating this work) causing doubled, mis-pathed tests. A clean rebuild
  removes it; the clean run is the authoritative gate.

## Remaining risks

- ~~`audit.stale_sidecar_recovered` / `audit.recovery` remain declared vocabulary
  with no emitter; recovery is silent. An emitter is optional follow-up.~~
  **Closed (2026-10-15 P5 follow-up):** recovery now emits out-of-band telemetry
  through `AuditChainWriterConfig.onRecovery` (`audit.stale_sidecar_recovered`
  after a repair, `audit.recovery` `outcome: "failed"` on fail-closed), forwarded
  by `AuditStore` (default: stderr). No chained record and no sequence is
  consumed, so the frozen P1 sequence semantics are unchanged. Regression:
  `tests/audit/audit-chain-recovery.test.ts` telemetry suite.
- Host power-loss durability of the JSONL/head pair is not proven here (process
  crash only), as before.
- `synchronous`/write-ordering is unchanged; this fix changes only sequence
  allocation logic, not the fsync contract.

## Not in scope

RuntimeLedger deferred-transaction contention (P2) must be a separate branch,
tests, and PR.
