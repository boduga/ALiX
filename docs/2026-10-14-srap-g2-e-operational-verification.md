# SRAP-1 G2-E — Operational Verification and Contract Finalization

- Date: 2026-10-14
- Baseline: `main` / `HEAD` = `2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e` at investigation time
- Mode: **investigation + narrow DOX/contract amendments** — no endpoint, no new authority/ledger/scheduler/state machine, no production batching, no commit/merge
- Inputs: G2-D investigation, operator approval of the six decisions, and three required refinements
- Verdict: **CONDITIONAL** (see §7)
- Post-hoc (2026-10-15): the P1 audit-chain stale-head fix this report ordered (§F.3.1) is **merged** (`srap/p1-audit-chain-recovery`, PR #946, `a0d8fda0`); its probe/test live in that PR, not this one. See "Post-hoc status" below.

This is a dated hand-off record (`docs/AGENTS.md`). The normative rules produced
here were written into the **owning** AGENTS.md contracts, not into this file;
this record is the evidence and the remaining-risks statement.

## Post-hoc status (2026-10-15)

The two defects this investigation ordered are fixed on separate branches, not in
this record's commit:

- **§F.3.1 audit-chain stale-head fix** — merged as `srap/p1-audit-chain-recovery`
  (PR #946, `a0d8fda0`). Its regression test
  (`tests/audit/audit-chain-recovery.test.ts`) and probe
  (`scripts/probe-audit-chain-crash.mjs`) ship in that PR, **not** this one.
- **§F.3.2 ledger deferred-transaction `SQLITE_BUSY` fix** — opened as
  `srap/p2-ledger-immediate-txn` (PR #947).

§F.3.1/§F.3.2 remain the ordered requirements; the risk items in §F.4 that name
them are satisfied once those PRs merge.

---

## Task A — Representative workload benchmarks

### A.1 Harness

`scripts/benchmark-runtime-ledger-workloads.mjs` (new, reusable) drives the real
`dist` `RuntimeLedger`:

- **N concurrent OS processes** writing one shared `.alix/runtime-ledger.db`
  (models scheduler + CLI + Inspector + daemon), mirroring how callers obtain
  `expectedVersion` via an authority read.
- **Modes:** `sustained` (back-to-back), `burst` (N back-to-back bursts),
  `session` (k events + scope + state per iteration, with model-latency
  `--think-ms`).
- **Measures:** aggregate writes/s; append-latency p50/p95/p99/max; reader
  (authority-read) latency percentiles during writes; WAL growth; checkpoint
  behavior; `SQLITE_BUSY` counts; failure/recovery.
- `scripts/benchmark-runtime-ledger.mjs` (G2-D, single-process sequential) remains.

`BENCH_STORAGE_LABEL` records the storage under test; `tmpfs` is explicitly **not**
labelled as durable SSD.

### A.2 Single-process baseline (context, G2-D)

| Storage | sync | batch | writes/s |
| --- | --- | ---: | ---: |
| ext4 HDD | NORMAL | 1 | 726.6 |
| ext4 HDD | FULL | 1 | 18.2 |
| ext4 HDD | FULL | 10 | 185 |
| ext4 HDD | FULL | 50 | 1,016.9 |
| tmpfs | FULL | 1 | 12,455 |

### A.3 Concurrent workloads (ext4 HDD, `synchronous=FULL`, 4 writers)

| Mode | aggregate w/s | append p50 | append p95 | append p99 | reader p50/p95 | WAL max | checkpoint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sustained (20 s) | 11.8 | 143 ms | 196 ms | 297 ms | 0.66 / 1.43 ms | 9.07 MB | 0.4 ms |
| session ×4 (k=6, 1.5 s think) | 7.6 | 49 ms | 169 ms | 277 ms | 0.64 / 1.04 ms | 4.29 MB | 0.38 ms |
| burst ×4 (25/burst) | 12.8 | 60 ms | 197 ms | 343 ms | 0.69 / 1.41 ms | 9.07 MB | 0.47 ms |

Findings:

1. **Aggregate FULL throughput under concurrent writers ≈ 8–13 writes/s** on the
   rotational HDD — device-flush bound, as G2-D established. Concurrency does not
   raise *throughput* (the platter is the bottleneck); it adds latency and
   `SQLITE_BUSY` retries.
2. **Reads are unaffected:** authority-read p95 ≤ ~1.5 ms during heavy writes
   (WAL readers never block on the writer). Read paths are not a concern.
3. **WAL stays bounded** (< 10 MB here) and checkpoints in < 1 ms; checkpointing
   is not a full-writer stall in this regime.
4. **`SQLITE_BUSY` is a normal outcome** (~10/s sustained). See A.4 — this is the
   most actionable G2-E finding.

### A.4 NEW FINDING — deferred-transaction `SQLITE_BUSY` storm

The errors are `SQLITE_BUSY` / `SQLITE_BUSY_SNAPSHOT` **despite
`busy_timeout = 5000`** (`runtime-ledger.ts:112`). Isolated with
`/tmp/opencode/probe-tx.mjs`, 4 processes, FULL, 8 s:

| Transaction start | successes | SQLITE_BUSY |
| --- | ---: | ---: |
| default (**deferred**, current `RuntimeLedger`) | 127 | **269,800** |
| `.immediate` | 143 | **3** |

Root cause: `better-sqlite3`'s `.transaction()` issues `BEGIN` (deferred). The
first statement in `RuntimeLedger.append` is a `SELECT` (`runtime-ledger.ts:144`),
so the transaction takes a **read snapshot** and, on the later `INSERT`, must
upgrade read→write. If another process committed in between, SQLite returns
`SQLITE_BUSY_SNAPSHOT`, which **`busy_timeout` cannot resolve** (it is not a lock
wait). A write-first `BEGIN IMMEDIATE` transaction avoids the upgrade.

- This is **independent of `synchronous`** and does **not** weaken durability: it
  changes only *when* the write lock is taken, not the flush guarantee.
- It is a **production code change**, so per the constraints ("no production
  performance optimization without review") it is reported as a **required,
  separately-reviewed fix**, not implemented here. Recommended fix: make the
  append transaction `immediate` (or issue an explicit write statement first),
  and add a multi-process contention regression test.

### A.5 Failure / recovery under concurrent load

`/tmp/opencode/crash-probe.mjs`, 4 writers SIGKILL'd mid-stream, reopen + verify,
3 runs:

| Run | `integrity_check` | duplicate ids | WAL checkpoint | committed rows kept |
| --- | --- | ---: | --- | ---: |
| 1 | ok | 0 | clean | 23 |
| 2 | ok | 0 | clean | 23 |
| 3 | ok | 0 | clean | 25 |

SIGKILL recovery of the SQLite ledger is sound: no corruption, no duplicates,
committed rows survive. (Process-crash only; host power loss remains a
storage-controller claim, not proven here.)

### A.6 Physical SSD

**Not available on this host** (only `/dev/sda`, rotational, `WDC WD10SPZX`).
The G2-D tmpfs comparison establishes "no software-level FULL penalty", **not**
SSD power-loss durability or SSD performance. A physical-SSD run of
`scripts/benchmark-runtime-ledger-workloads.mjs` is **required** before any
throughput claim for SSD-backed deployment.

### A.7 Deployment recommendation and acceptance threshold

- **Rotational HDD:** FULL is operationally acceptable for **approval**,
  **session**, and **daemon** workloads (human-rate and multi-second bursts).
  For **coordination-scale** sustained bursts, the ceiling is ~8–13 writes/s with
  append p99 up to ~0.48 s; acceptable only if run-level steps tolerate p99
  ~0.5 s. **Recommend SSD for coordination-scale deployments.**
- **Proposed acceptance threshold** (to be confirmed with the SSD run):
  - no data-integrity failure under concurrent load (met today);
  - append p95 ≤ 200 ms on rotational HDD, ≤ 20 ms on SSD;
  - reader p95 ≤ 5 ms under write load (met today: ≤ 1.5 ms);
  - `SQLITE_BUSY` must be eliminated by the A.4 fix, not tolerated;
  - sustained aggregate ≥ ~10 writes/s on rotational HDD; ≥ several hundred/s on
    SSD once measured.
- `synchronous=FULL` is retained; **group commit is a separate investigation**
  (own ADR/PR), not part of SRAP-1.

---

## Task B — Final `ApprovalScope`

Normative rule written to **`src/governance/approvals/AGENTS.md`** (eligibility)
and **`src/interfaces/server/AGENTS.md`** (canonical identity).

### B.1 Predicate

```
eligible(principal, approval) :=
    authenticated
  ∧ token.hasPermission("approvals:decide")
  ∧ principal.status == "active"
  ∧ canonicalWorkspace(token) ∈ principal.workspaceIds        // explicit, non-empty
  ∧ approval.status == "pending"
  ∧ approval.expiresAt > now
```

- `canonicalWorkspace = realpathSync.native(resolve(serverRoot))` — derived
  server-side from the resolved project root the `ApprovalStore` is bound to;
  **never** `process.cwd()` as typed and **never** a request-supplied value.
- Exact idempotent retries re-run authentication, authorization, and the **same**
  scope checks before returning `200`; conflicting retries are `409` without
  state disclosure.
- No per-approval principal grant; no per-agent/per-run operator ownership.

### B.2 Verified wiring gaps (must close before the route exists)

| Gap | Evidence |
| --- | --- |
| No canonical identity is computed | `startServer(root,…)` and `new ApprovalStore(root)` use raw `process.cwd()` (`server.ts:102-110,470-472`); no `resolve`/`realpath` at the boundary |
| `SecurityContext` drops workspace scope | `security-context.ts:25-43` has no `workspaceIds`; middleware discards it (`security-middleware.ts:351-356,381-386`) |
| Workspace-check seam is dead code | `AuthService.verifyTokenForRequest` (`auth-service.ts:543-567`) has **no callers** |
| No enrollment surface for scope | `alix inspector auth create` never passes `workspaceIds` (`security-ops.ts:315-346`); `createToken` accepts it but the CLI omits it |
| Global vs project store union lacks provenance | `approval-stores.ts:21-32` unions by `id` only; Inspector uses project store only (`server.ts:471`) |

Enrollment must set the canonical identity value at token creation; the route
must read scope from a `SecurityContext` that carries `workspaceIds`.

### B.3 Case matrix (parity — broader than the handler)

P1 active operator+scope+pending+unexpired → allow. P2 admin same → allow.
P3 exact retry (same principal/nonce/decision/content) → idempotent `200`.
N1 anonymous → deny. N2 `readonly` → deny. N3 operator without `approvals:decide`
→ deny. N4 revoked/disabled principal → deny. N5 cross-workspace → deny.
N6 missing/empty scope → deny. N7 cross-run/record → deny. N8 expired/decided →
`409`/`410`. N9 conflicting retry → `409`. N10 loopback-dev no token → deny.
N11 cookie session → deny. Parity table to be added to
`tests/ownership/path-scope.test.ts`-style broader-than-implementation coverage.

---

## Task C — HMAC lifecycle

Normative rule written to new **`src/governance/security/credentials/AGENTS.md`**.

- **Owner:** the existing CredentialStore. No second secret/key authority.
- **Namespace:** provider `srap-evidence`; **version in the label**
  (`hmac-key:v<N>`), because the store has no per-entry version field
  (`credential-store.ts:164-172`, `memory-credential-provider.ts:69-76`
  overwrite-in-place). Old versions coexist as ordinary entries.
- **credentialRef:** `hmac-sha256:v<N>:<base64url(HMAC(key_vN, credentialRecordId))>`.
- **Generation** random 32-byte key `hmac-key:v<N+1>`; **activation** sign only
  with current; **rotation overlap** keep old versions resolvable through the
  approval-retention window; **retirement** delete `hmac-key:v<old>` only after
  that window; **unavailable active key → fail-closed** (no decision committed);
  retired-version ref → **unverifiable**, never silently accepted.
- **Access:** only trusted approval/audit code resolves `srap-evidence`; reads
  logged. HMAC is computed in the owning subsystem.
- **Backends verified:** plain-file (default, `0o600`, atomic, symlink-rejected;
  `MAX_CREDENTIAL_ENTRIES = 256`), OS keychain (`@napi-rs/keyring`, Linux Secret
  Service), passphrase-encrypted (AES-256-GCM + Argon2id, no silent fallback).
- **Rejected:** Inspector auth store (hash-only); Ed25519 `ConfigSigner`/
  audit-checkpoint keys (signature keys, single current `keyId`, no
  overlap/retire).

---

## Task D — Audit projection recovery proof

Normative invariant written to **`src/governance/audit/AGENTS.md`**.

### D.1 Deterministic crash-consistency proof (new)

`scripts/probe-audit-chain-crash.mjs` reproduces the exact crash window between
`AuditChainWriter.doAppend` step 9–10 (JSONL append + fsync) and step 11 (head
sidecar write), by rolling `head.json` back one record after the JSONL commit:

```
seqs: [1, 2, 3, 4, 4]        ← duplicate seq 4 after reopen
verifyIntegrity(): ok=false
  head_mismatch: sidecar seq 3 vs last verified record seq 4
  head_mismatch: recordHash differs
```

**Proven:** a crash after the JSONL fsync but before the head write leaves a
stale-but-valid head; `recoverHeadFromLog()` runs **only when the head is
missing or malformed** (`audit-chain-writer.js:308-319`), so the next append
reuses `seq`/`prevHash` and corrupts the chain. The duplicate is **detectable**
(`verifyIntegrity`) but **not auto-repaired**.

### D.2 Recovery design (chain-anchored)

- **Authority:** verified JSONL chain + authoritative ledger. Dedup index and
  checkpoint are **advisory**.
- **Step order:** ledger commit → audit chain append (fsync) → dedup record →
  checkpoint. The checkpoint **advances last**, and only to a seq/`decisionId`
  **provably present in the verified chain**.
- **Crash between each step:** re-derive by `verifyIntegrity()` + bounded ledger
  scan; never trust an unverified checkpoint. Missing `decisionId` → append;
  duplicate → drop; conflict → report.
- **Stale-head prerequisite:** any projection on this chain **must** first fix
  `AuditChainWriter` to detect a stale head by comparing with the JSONL tail and
  recover from the tail before allocating the next seq. Until then the chain is
  not a sound idempotency anchor.
- **Ownership:** all of this stays under `src/governance/audit/`; approval code
  only requests projection. The generic `runtime_outbox.delivered_at` is **not**
  projection state and must not be marked delivered for SRAP.

---

## Task E — DOX reconciliation

| Action | File |
| --- | --- |
| Tightened eligibility predicate + canonical workspace + exact-retry scope | `src/governance/approvals/AGENTS.md` |
| Canonical workspace identity + `SecurityContext` requirement | `src/interfaces/server/AGENTS.md` |
| Audit projection contract + chain-anchored crash invariant + known stale-head window | `src/governance/audit/AGENTS.md` |
| HMAC `srap-evidence` lifecycle (new owning contract) | `src/governance/security/credentials/AGENTS.md` (new) |
| Added CredentialStore row to the root Child DOX Index | `AGENTS.md` |
| Reconciliation note + crash-consistency plan step | `docs/2026-10-14-srap-1-implementation-plan.md` |
| G2-E reconciliation appendix | `docs/architecture/adrs/ADR-0015-*.md` |

- `pnpm check:dox` → **OK** (14 claim tokens across 4 AGENTS.md, all resolve).
- `docs/2026-10-14-srap-1-contract-proposal.md` and `docs/2026-10-14-srap-1-implementation-plan.md`
  are now marked as dated hand-off history; normative rules live in the owning
  contracts above (resolves G2-C blocker 5 without moving files).
- No browser-write exception was broadened.

---

## Task F — Verdict and remaining work

### F.1 Verdict: **CONDITIONAL**

The architecture is approved with the three refinements folded in. G3 stays
**blocked** until the items below close. There is **no new blocker in the
approved architecture**; there is one **newly discovered defect** (audit-chain
stale-head) and one **newly discovered operational defect** (deferred-transaction
`SQLITE_BUSY`) that must be fixed first.

### F.2 Deliverable summary

1. **Benchmarks / thresholds:** §A — FULL is acceptable for human-rate and
   iteration-burst workloads; ~8–13 writes/s concurrent on rotational HDD;
   reads unaffected; WAL bounded; proposed thresholds in §A.7; physical SSD run
   still required.
2. **ApprovalScope predicate:** §B (canonical server-derived workspace; explicit
   non-empty token scope; exact-retry re-check; no new authority).
3. **HMAC lifecycle:** §C (`srap-evidence` namespace, `keyLabel` versioning,
   fail-closed, retirement after retention).
4. **Audit recovery proof:** §D (duplicate-seq corruption deterministically
   reproduced; chain-anchored recovery design; stale-head repair is a prerequisite).
5. **DOX ownership:** §E (4 amended + 1 new owning contract; check:dox passes).
6. **Remaining risks:** §F.4.
7. **Verdict:** CONDITIONAL (§F.1).

### F.3 Required before G3 (ordered)

1. **Fix the audit-chain stale-head window** (detect stale head vs JSONL tail;
   recover from tail before seq allocation) + regression test using
   `scripts/probe-audit-chain-crash.mjs`. Owner: audit subsystem.
2. **Fix the deferred-transaction `SQLITE_BUSY` storm** (immediate write
   transaction) + multi-process contention regression test. Owner: storage
   subsystem. Separate review; not batching.
3. **Plumb the canonical workspace identity** through `startServer` →
   `SecurityContext.workspaceIds` → `verifyTokenForRequest`, and add a
   `--workspace` enrollment surface. Owner: Inspector server/auth.
4. **Physical-SSD representative benchmark** + confirm the §A.7 acceptance
   threshold. Owner: operator/benchmark.
5. **Independent G2-C re-review** against the amended owning contracts.

### F.4 Remaining risks

- **Rotational-HDD coordination throughput:** ~8–13 writes/s, append p99 ~0.5 s.
  Mitigation: SSD requirement for coordination-scale hosts; group commit is a
  separate milestone.
- **Host power-loss durability** is asserted by `synchronous=FULL` but the local
  probes only exercise process death, not power loss / storage-controller
  behavior.
- **Audit-chain stale-head window** — fixed in P1 (#946, merged); a projection may
  rely on the recovered chain once that PR is on the base branch.
- **`SQLITE_BUSY` under concurrent writers** — fixed in P2 (#947, open).
- **Workspace enforcement is dead code today** (`verifyTokenForRequest`
  unreferenced; no enrollment surface); the predicate is unimplementable until
  F.3.3.
- **HMAC + projection code is unbuilt:** this contract describes required
  behavior; no HMAC, dedup index, or projector exists yet.

### F.5 Constraints honored

No remote approval endpoint. No new approval authority, ledger, scheduler, or
state machine. No production batching change and no production performance
optimization applied (both reported for separate review). No commit or merge.
Unrelated untracked files and branches preserved. Baseline `2c73b044` verified at
investigation time; the two fixes landed later on their own branches (see
"Post-hoc status").

---

## Appendix — artifacts

- `scripts/benchmark-runtime-ledger-workloads.mjs` — concurrent-workload harness (new; this PR).
- `scripts/benchmark-runtime-ledger.mjs` — single-process baseline (G2-D; this PR).
- `tests/storage/srap-approval-durability.test.ts` — durability probes (this PR).
- `scripts/probe-audit-chain-crash.mjs` — deterministic audit-chain crash-window
  probe; **ships in P1 (#946), not this PR**.
- Probe scratch (not committed): `/tmp/opencode/probe-tx.mjs`, `/tmp/opencode/crash-probe.mjs`.
- DOX/contract edits: `src/governance/approvals/AGENTS.md`,
  `src/interfaces/server/AGENTS.md`, `src/governance/audit/AGENTS.md`,
  `src/governance/security/credentials/AGENTS.md` (new), `AGENTS.md`,
  `docs/2026-10-14-srap-1-implementation-plan.md`,
  `docs/architecture/adrs/ADR-0015-*.md`.
