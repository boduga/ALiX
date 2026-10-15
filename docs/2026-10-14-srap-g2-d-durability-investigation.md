# SRAP-1 G2-D — Durability Performance and Contract Resolution (investigation)

- Date: 2026-10-14
- Baseline: `main` / `HEAD` = `2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e`
- Mode: **investigation only** — no production code, no endpoint, no commit/merge
- Scope: the five G2-C blockers (`docs/2026-10-14-srap-g2-c-independent-review.md` §8)
- Prior status: G2-C **BLOCKED**; G3 remains closed

This is a dated hand-off record (`docs/AGENTS.md`). The exact `ApprovalScope`
predicate, HMAC-key ownership, and audit-projection recovery contract below are
**recommendations requiring operator approval**, not a live contract. A live
contract belongs in the owning `AGENTS.md`; see §7 for the document-ownership
resolution that would make them binding.

---

## 1. Root cause of the FULL throughput regression

**The regression is an artifact of the *test host's storage hardware*, not a
defect in the durability choice.**

Evidence:

- Target filesystem `/dev/sda2` (ext4, `/`) is backed by
  `WDC WD10SPZX-24Z`, a **1 TB 5400 RPM rotational disk**
  (`/sys/block/sda/queue/rotational` = `1`, `write_cache` = `write back`).
- Raw `write()+fsync()` cost on that filesystem measures **172.6 ms/fsync**
  (5.8 fsyncs/s) under load.
- `strace -c -e fsync,fdatasync` over a 20-commit FULL probe shows ~1.7 `fsync`
  per commit — i.e. **one WAL flush per commit**, as the WAL design intends.
- Per-append timing of `RuntimeLedger.append` under FULL is a flat **~49 ms**
  per commit (measured 30 appends: min 48.2, max 106.1, steady 49.2 ms). That
  is one rotational flush of the WAL.

Reproduced baseline (workspace filesystem):

| Setting | writes/s | ms/write |
| --- | ---: | ---: |
| WAL + NORMAL | 279.7 (prior) / 726.6 (synthetic this run) | 3.59 |
| WAL + FULL | 14.0 (prior) / 9.4 (this run) | 76.86 / 106 |

The absolute numbers drift with device cache state, but the mechanism is fixed:

> `synchronous=FULL` makes the durability point "WAL flushed to platter".
> On rotational media one flush costs tens of milliseconds. One transaction per
> runtime event therefore caps the ledger at *device-flush rate* (~10–20/s here).

**Transaction *frequency* × device flush latency = throughput ceiling.**
NORMAL does not block on the platter flush, hence ~20× higher.

### What this does and does not mean

- It does **not** mean FULL is wrong. FULL is the only setting that keeps
  committed approval evidence durable across host power loss; the G2-C verdicts
  correctly refuse to weaken it.
- It **does** mean the "20× slower shared runtime ledger" framing over-weights a
  synthetic sequential-append loop. The real deciding number is **transactions
  per second of *real* workloads**, measured in §2.
- On an SSD/tmpfs the same code shows no FULL penalty at all (11,152/s NORMAL vs
  12,455/s FULL, single-append) — so the cost is storage-class-specific, not
  universal.

---

## 2. Comparative benchmarks and safe optimization options

### 2.1 Who actually writes the ledger, and how often

Every durable write goes through `appendFact` → `RuntimeLedger.append` → **one
SQLite transaction** (`src/runtime-state/storage/runtime-ledger.ts:137,143`).
There is **no batching seam anywhere** — the only `db.transaction` wraps a single
append.

| Logical operation | Ledger appends | Cadence |
| --- | --- | --- |
| Single approval resolve | 1 | human-rate (rare) |
| `resolveGroup` (N members) | N | human-rate |
| Coordination worker patch | 1 per transition + heartbeat | per scheduler tick |
| Session iteration persist | k messages + 2 | per agent loop iteration |
| Daemon task transition | 1 | per task state change |
| Graph persist / attempt | 1 each | per graph event |

Real workload envelope:

- **Approval decisions:** human-driven; a busy operator produces single-digit
  decisions per hour. This is the *only* path SRAP-1 adds. Even at 1 decision/s
  (not a real rate) FULL on this HDD has headroom.
- **Agent session persistence:** `k+2` appends **per loop iteration**, and
  iterations are separated by model latency (seconds to minutes). Bounded bursts
  of tens of writes at multi-second intervals.
- **Coordination:** the highest-volume writer — one commit per worker-state
  transition plus heartbeats. A large run can emit dozens–hundreds of sequential
  single-row commits. This, not approvals, is the path that could stress FULL on
  rotational storage.

Net: the **sustained** rate of the shared ledger is far below 14/s in normal
operation. The regression matters only if a burst (large coordination run) must
complete faster than ~50 ms/event, or if the deployment host uses rotational
storage.

### 2.2 Synthetic comparison matrix (this run, same code shape)

| Storage | `synchronous` | batch | writes/s |
| --- | --- | ---: | ---: |
| ext4 HDD | NORMAL | 1 | 726.6 |
| ext4 HDD | FULL | 1 | 18.2 |
| ext4 HDD | FULL | 10 | 185 |
| ext4 HDD | FULL | 50 | **1,016.9** |
| ext4 HDD | FULL | 100 | 759.3 |
| tmpfs | NORMAL | 1 | 11,152 |
| tmpfs | FULL | 1 | 12,455 |
| tmpfs | FULL | 50 | 71,002 |

Two findings with opposite engineering consequences:

1. On rotational storage the single-append FULL penalty is real and large.
2. **Group commit at FULL can exceed NORMAL single-append throughput**
   (1,017/s vs 727/s) while losing *nothing* in durability — one fsync amortized
   across many rows still commits atomically. Batching is therefore not a
   durability compromise; it is the correct way to keep FULL.

### 2.3 Safe optimization options (recommendation — not implemented)

Constraint from the operator: do not silently change the approved durability
contract; do not add a separate ledger; do not move mandatory evidence to
best-effort JSONL. All options below preserve WAL + FULL and one atomic commit
per logical fact-set.

- **Option A — group commit inside `RuntimeLedger` (recommended target).**
  Add a bounded `appendMany(events[])` (or a transaction-scoped collector) so
  events produced by one logical operation share **one** FULL commit. Preserve
  the optimistic version precondition per event, the outbox row per event, and
  all-or-nothing rollback. No caller loses atomicity; the durability point moves
  from per-row to per-batch.
  - Natural call sites: coordination `updateRun`/`patchWorker` bursts under the
    existing per-run lock (`coordination-store.ts:369`); session
    `saveMessages` (`src/session/persist.ts:140`), which today appends one fact
    per message; `resolveGroup` (`approval-store.ts:900`).
  - Payoff on this HDD: 10-row batches already reach ~185/s; 50-row batches
    exceed NORMAL single-append throughput.
  - Requires review: it changes batch boundaries at multiple call sites and must
    not reorder cross-entity preconditions. Per the operator's constraint, this
    is a **proposal**, not a change.
- **Option B — storage guidance.** Require SSD-backed storage for hosts running
  coordination at scale, or accept FULL cost on rotational hosts. On SSD the
  FULL penalty is within noise.
- **Option C — heartbeat de-amplification.** Coordination heartbeats write a
  ledger row each tick. A dedicated low-value heartbeat cadence (or coalescing
  heartbeats into the next state commit) removes a steady low-information write
  load without touching durability semantics.
- **Explicitly rejected:** relaxing `synchronous` to NORMAL on the shared ledger;
  moving approval evidence into JSONL; a second SRAP ledger; a write-behind
  cache that acks before the WAL flush.

### 2.4 Workload-level acceptance test still required

G2-C asked for representative, not synthetic, measurement. Missing and still
required before acceptance: **concurrent multi-process writers** (scheduler +
CLI + Inspector share one file, `runtime-ledger.ts:110-112`), **reader latency
under FULL write load**, and **WAL checkpoint behavior**. `scripts/benchmark-runtime-ledger.mjs`
is the reusable harness; it must be extended to drive a real coordination run,
not just a synthetic append loop.

---

## 3. Exact `ApprovalScope` eligibility predicate (recommendation — operator approval required)

### 3.1 What exists

Verified facts (file:line):

- The authenticated context is `SecurityContext { requestId, authenticated,
  tokenId?, permissions[], route, startTime }`
  (`src/governance/security/inspector/security-context.ts:25-43`). It carries
  **no workspace, principal, role, run, or session**.
- The token record *does* carry workspace scope: `StoredToken.workspaceIds?`
  (`src/governance/security/inspector/auth-store.ts:57`), surfaced as
  `AuthPrincipal.workspaceIds?` (`auth-service.ts:75`). It is **dropped** at the
  middleware boundary before any handler sees it
  (`src/interfaces/server/security-middleware.ts:351-356,381-386`).
- A workspace-check capability already exists but is **unused**:
  `AuthService.verifyTokenForRequest(raw, targetWorkspace)`
  (`auth-service.ts:543-567`) returns `workspace_mismatch` when the token has
  scopes and the target is absent. No caller in `src/`.
- An approval carries only **execution-side** facts: `coordinationRunId,
  workerId, workerAttempt, graphId, nodeId, sessionId, agentId, ownershipClaims,
  groupId, capabilities, bindingKey, policyRevision, expiresAt, status`
  (`src/governance/approvals/approval-types.ts:17-63`). **No workspace, no
  principal, no operator field.** `decidedBy` is a free-form `string`
  (`:53`), set today only by `resolveGroup` (`approval-store.ts:921`).
- Ownership identity is `agentId` only; path scope is decided by
  `scopeContains` / `isWithinOwnedScope`
  (`src/coordination/ownership/path-scope.ts:36-43,202-211`). No
  principal↔run/worker mapping exists.
- The approval store is **project-local by `cwd`**: `.alix/approvals/approvals.json`
  (`approval-store.ts:79-81`); schedule proposals live in a separate global store.

**Conclusion: there is no existing operator→approval relation.** Any predicate
that pretends one exists would be inventing an approval-grant authority, which
the operator forbids. The only defensible predicate uses facts that already
exist: the token's workspace scope (once plumbed) plus approval-side execution
and ownership facts.

### 3.2 Recommended predicate (no new authority)

```
eligible(principal, approval) :=
    authenticated
  ∧ token.hasPermission("approvals:decide")
  ∧ principal.status == "active"
  ∧ principal.workspaceIds is non-empty                       // explicit scope required
  ∧ canonicalWorkspace ∈ principal.workspaceIds               // server-derived, never request input
  ∧ approval.status == "pending"
  ∧ approval.expiresAt > now
  ∧ token.workspaceIds (or approval-recorded workspace) == canonicalWorkspace   // same project
```

Where:

- `canonicalWorkspace` = the server's canonical workspace identity (the resolved
  project root the Inspector/ApprovalStore is bound to), **not** a client-supplied
  value.
- `principal.status == "active"` covers revoked/disabled principals (the
  disablement path already rejects every bound credential).
- **No `approvalScope` beyond the workspace+state+expiry facts above.** There is
  no basis to require that the deciding operator own the run/worker/agent that
  produced the approval — operators are not run ownership. Inventing a
  run-owner requirement would be new authority and would also break legitimate
  operator decisions on approvals raised by agents they do not "own".

This requires **plumbing `workspaceIds` (and principal status) into the route's
authorization context** — new work, but it uses an existing fact and an existing
`verifyTokenForRequest` seam, not a new authority.

### 3.3 Positive and negative cases (parity table seed)

| # | Case | Verdict | Basis |
| --- | --- | --- | --- |
| P1 | Active operator, `approvals:decide`, workspace in scope, pending, unexpired | allow | all conjuncts |
| P2 | Active admin, same | allow | admin also holds `approvals:decide` |
| P3 | Exact retry: same principal+nonce+decision+content, already terminal | idempotent `200` | §9 exact-retry rule after re-authorization |
| N1 | Anonymous / no token | deny | `authenticated` fails |
| N2 | `readonly` role | deny | lacks `approvals:decide` |
| N3 | Operator without `approvals:decide` | deny | permission fail-closed |
| N4 | Revoked / disabled principal (credential still valid) | deny | principal status |
| N5 | **Cross-workspace**: token scoped to W1, approval in W2 | deny | `canonicalWorkspace ∉ workspaceIds` |
| N6 | **Missing scope**: token has no `workspaceIds` | deny | SRAP requires explicit match (stricter than generic Inspector routes) |
| N7 | **Cross-run / cross-record**: approval id ≠ authorized target | deny | record-level check precedes disclosure |
| N8 | Expired / consumed / already-decided approval | deny (`409`/`410`) | state + expiry |
| N9 | Conflicting retry (different principal/nonce/decision/content) | `409` | no mutation, no disclosure |
| N10 | Loopback-dev posture, no token | deny | dev bypass never applies to this route |
| N11 | Cookie session (not bearer) | deny | bearer-only |

Parity-table tests must be **broader than the implementation** (root
`AGENTS.md` rule: "Authorization changes get a parity check, never a spot
check"), covering the full role × workspace × state × retry matrix.

### 3.4 What is deliberately NOT proposed

- No per-approval principal allowlist/grant (that is a new approval-ownership
  authority; G2-C option 2, rejected).
- No run/worker-owner requirement (no such fact exists; inventing it is new
  authority).
- No interpretation of `ApprovalRecord.metadata` as authorization input.

---

## 4. HMAC key ownership proposal (recommendation)

### 4.1 What exists

- The protected secret facility is the **credential store**
  (`src/governance/security/credentials/`): a `CredentialStore` with backends
  `PlainFileProvider` (`credential-store.json`, atomic write, mode `0o600`),
  OS-keychain `KeychainProvider` (`@napi-rs/keyring`), and passphrase-encrypted
  `EncryptedFileProvider` (AES-256-GCM + Argon2id).
- A credential entry is keyed by `provider` (namespace) + `keyLabel`; the store
  has a schema `version` but **no per-entry version, no rotation/retire
  lifecycle**.
- The Inspector auth store is **hash-only** and owns no secret keys
  (`auth-store.ts:10-11,47-68`) — correctly not a key authority.
- There is **no versioned-HMAC-key primitive anywhere**, and no `createHmac` in
  `src/`. This must be built, but it does **not** require a new authority.

### 4.2 Proposal

Reuse the existing credential store as the single key authority. Do **not** add
a separate key service.

- **Namespace:** a dedicated provider namespace, e.g. `srap-evidence`. Keys are
  distinct from provider API keys by namespace, and access is limited to trusted
  auth/audit code paths.
- **Versioning without a schema change:** encode the key version in `keyLabel`
  — `hmac-key:v<N>`. `keyLabel` is already the store's discriminator, so
  versioned keys coexist as ordinary entries. `credentialRef` becomes
  `hmac-sha256:v<N>:<base64url(HMAC(key_vN, credentialRecordId))>`.
- **Generation:** a new random 32-byte key written as `hmac-key:v<N+1>`.
- **Activation:** decision code writes with the **current** version only.
- **Rotation overlap:** old versions remain resolvable for verification/correlation
  through the approval-retention window; both versions coexist in the store.
- **Retirement:** delete `hmac-key:v<old>` only after the approval retention
  window has elapsed; document the retention bound.
- **Unavailable-key behavior:** computing `credentialRef` at decision time with
  no active key is **fail-closed** (no decision committed). Verifying an *old*
  ref whose key version has been retired reports the record **unverifiable** —
  never silently accepted, never an authority reversal.
- **Access control / audit:** only the approval/audit code resolves `srap-evidence`;
  key-store reads are logged. The store's `0o600` / keychain protections carry over.
- **HMAC creation is new code but not a new authority:** it is a function over an
  existing stored secret, in the owning subsystem.

### 4.3 Alternatives considered (if the operator rejects the above)

- Extend `CredentialEntry` with an explicit `keyVersion`/`retiredAt` schema — more
  invasive (store schema + all backends), but makes versioning first-class.
- A dedicated encrypted file protected by the existing passphrase backend — same
  authority question, still not a separate secret service.
- Reusing the Ed25519 `ConfigSigner`/audit-checkpoint keypairs — **rejected**: those
  are signature keys with a single current `keyId`, not secret-derived HMAC keys,
  and have no overlap/retire lifecycle.

Report: the existing facility can hold versioned HMAC keys **if versioning is
encoded in `keyLabel`**; it has no native version/rotation lifecycle, so the
lifecycle above is new contract attached to an existing authority, not a new one.

---

## 5. Audit projection recovery design (recommendation)

### 5.1 Constraints

- Audit is authoritative for audit facts and **must not be mirrored into the R2
  ledger** (`src/governance/audit/AGENTS.md:22-30`). The projection direction is
  **ledger → audit JSONL**, one-way.
- The audit subsystem **owns** mutation (`audit-store.ts` "Owns both persistence
  and integrity"); approval code must not write audit directly.
- The current `approval.updated` audit append is best-effort
  (`approval-store.ts:651-655`, `.catch(() => {})`); the existing
  `approval-ledger-reconcile.ts` is **read-only**; there is **no
  `decisionId`-keyed idempotent append** and no audit startup hook. All of this
  is missing today.

### 5.2 Design

**Authority.** SQLite `approval.updated` event (transition + `remoteDecisionEvidence`)
is authoritative. JSONL audit is an idempotent projection keyed by `decisionId`.

**Append seam (audit-owned).** Add an idempotency key to `AuditStore.append`, e.g.
`append(input, { idempotencyKey })`, valid only when the v2 chain is active. Under
the existing `audit.lock`:

1. If `idempotencyKey` is already recorded → return the existing record (no
   duplicate seq, no chain rewrite).
2. Otherwise extend the chain exactly as today: seq = head.seq + 1, prevHash =
   head.recordHash, canonicalize, hash, append JSONL line, `fsyncSync`, atomically
   write `head.json`.
3. Record the key in the same atomic step as `head.json` (a bounded sidecar
   `projection-keys.json` written with temp+rename+fsync), or derive it by a
   bounded tail scan. Crash between steps is recovered by the chain writer's
   existing tail-recovery, extended to re-derive the key.

**Projection ownership.** A ledger→audit projector owned by the **audit**
subsystem (not approvals). It reads `approval.updated` events, extracts
`remoteDecisionEvidence.decisionId`, and calls the idempotent append seam.

**Cursor and delivery semantics.**

- Cursor = the last projected ledger `ledger_seq` (audit-owned checkpoint, written
  atomically with the key sidecar).
- Delivery is **at-least-once** with a `decisionId` dedup key, which makes the
  audit rows effectively **exactly-once**.
- Overlap window: re-scan from `cursor - overlap` to absorb any event committed
  just before a crash but not yet reflected.

**Inline vs repair.**

- After the authoritative commit returns, attempt one inline projection. Inline
  failure never changes the approval outcome.
- Bounded repair trigger: **Inspector startup** and an explicit operator command
  (extend `alix approvals reconcile` with an explicit `--repair-projection`, or add
  `alix audit project-approvals`). **No new scheduler.**
- Repair scans ledger from the checkpoint (bounded by approval retention), appends
  only missing `decisionId`s, and reports duplicates/lag.

**Failure, restart, integrity.**

- Restart: read checkpoint; if absent/corrupt, re-derive by bounded scan from the
  oldest retained approval event.
- Duplicate suppression: `decisionId` key.
- Integrity chain: projection appends through `AuditChainWriter`, so seq/prevHash
  stay monotonic and verifiable; a corrupt row is reported by `verifyIntegrity`,
  never repaired by rewrite (append-only).
- The generic `runtime_outbox.delivered_at` is **not** projection state and must
  **not** be marked delivered for SRAP (it has no production consumer and is not
  multi-consumer).

**Retention and repair procedures.**

- Retention: audit rows follow the audit retention policy; the projection scan
  window is bounded by the approval retention window.
- Repair: re-run the projector; append missing rows only; never delete.

**Observability.**

- Counters: `projected`, `skipped_duplicate`, `projection_failed`.
- Lag = ledger high-water `ledger_seq` − checkpoint.
- Alerts on lag growth, duplicate detection, or chain-verification failure.
- Surface via existing metrics and the audit CLI.

**Cross-subsystem ownership.** The projector may *read* the ledger and the
approval record; it must not write the ledger, must not authorize/reverse an
approval, and must stay under `src/governance/audit/`.

---

## 6. Root cause summary (one line each)

1. **FULL cost** = one WAL fsync per commit × ~49 ms rotational flush = ~10–20
   writes/s on the test host. Storage-class artifact; no FULL penalty on SSD/tmpfs.
2. **No batching seam exists**; group commit at FULL can exceed NORMAL
   single-append throughput while preserving atomicity.
3. **No operator→approval relation exists**; predicate must use token workspace
   scope + approval state/expiry, requiring workspace plumbing but no new authority.
4. **No versioned HMAC-key facility exists**; encode version in credential-store
   `keyLabel` under the existing credential authority.
5. **No audit projection exists**; add an audit-owned `decisionId`-keyed idempotent
   append + checkpoint/recovery, no new ledger/scheduler.

---

## 7. Documentation / DOX resolution (recommendation)

### 7.1 Problem

`docs/AGENTS.md` defines root-level `docs/*.md` as **dated hand-off records —
history, not live contracts**. `2026-10-14-srap-1-contract-proposal.md` and
`2026-10-14-srap-1-implementation-plan.md` sit at the docs root but are written as **live
contracts** (normative MUST/shall rules). That is an ownership violation, and it
is why G2-C could not treat them as binding.

### 7.2 Resolution

- **Durable normative contract moves to the owning DOX.** Fold the approval-scope
  predicate, evidence schema/durability ordering, and bearer/identity rules into
  `src/governance/approvals/AGENTS.md` (already amended in this worktree with the
  narrow browser-write exception). Fold the audit projection contract into
  `src/governance/audit/AGENTS.md`.
- **ADR-0015 stays** in `docs/architecture/adrs/` as the decision record.
- **Contract/plan at the docs root are demoted** to dated hand-off history (or
  moved under `docs/architecture/`, which own architecture plans), preserving
  references. Do not move silently; explain the ownership change.
- **Do not broaden** the approved browser-write exception. The two existing DOX
  amendments (`src/governance/approvals/AGENTS.md`, `src/interfaces/server/AGENTS.md`)
  are narrow and correct: one default-off, non-executing decision POST, resolving
  only through `ApprovalStore`, granting no execution authority. Keep them.
- The storage DOX amendment (WAL + `synchronous=FULL` repository-wide,
  `src/runtime-state/storage/AGENTS.md`) is correct and stays.

### 7.3 Plan text corrections required

- `2026-10-14-srap-1-implementation-plan.md` §5 and `2026-10-14-srap-1-contract-proposal.md` §4 imply the
  audit projection/reconcile "already exists" / "extend existing infrastructure".
  In fact the reconciler is read-only and there is no `decisionId` dedup seam.
  Reword to "implement, owned by the audit subsystem" per §5 above.
- Any plan wording that implies `verifyTokenForRequest` is already wired for
  approvals is incorrect — it has no callers today.

---

## 8. Revised G2-D verdict and remaining operator decisions

### Verdict

**BLOCKED — but the blocking reason has changed.** G2-C's "20× slower shared
runtime ledger" is confirmed as a **rotational-storage artifact with no SSD/tmpfs
penalty** and, against real workloads (human-rate approvals, multi-second
iteration bursts), no evidence yet of an unacceptable *sustained* cost. The
correct response is not to accept or reject FULL wholesale; it is to:

1. prove FULL supports representative concurrent workloads (§2.4), and
2. adopt group commit (Option A) where bursts need throughput — **without**
   weakening FULL.

G3 stays closed until the operator decisions below are made and an independent
G2-C re-review returns READY.

### Remaining operator decisions

1. **Storage policy:** accept FULL on rotational storage given workload math;
   and/or require SSD-backed storage for coordination-scale hosts; and/or approve
   **group-commit batching** (Option A) for review. (No production optimization
   without review.)
2. **ApprovalScope predicate:** approve the exact predicate in §3.2 and its
   parity table (§3.3), including the requirement to plumb `workspaceIds` into the
   route authorization context.
3. **HMAC key ownership:** approve the credential-store `srap-evidence` namespace
   with `keyLabel` versioning (§4.2), or choose the explicit `keyVersion` schema
   alternative.
4. **Audit projection:** approve the audit-owned `decisionId`-keyed idempotent
   append + checkpoint/recovery design (§5).
5. **Document ownership:** approve relocating the durable contract into the owning
   DOX and demoting the root contract/plan to history (§7).
6. **Operational acceptance:** commission the representative concurrent
   workload benchmark (§2.4) before G2-C re-review.

### Constraints honored

No SRAP endpoint implemented. No new approval authority, scheduler, state machine,
or ledger. No production performance optimization applied (batching described but
not implemented). No commit or merge. Unrelated untracked files and branches
preserved. Baseline `2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e` verified.

---

## Appendix A — Reproduced evidence

Environment: `WDC WD10SPZX-24Z` on `/dev/sda2` (ext4, rotational=1,
write_cache=write back); Node v26.11.0.

- `node scripts/benchmark-runtime-ledger.mjs 2 200` → settings
  `{journalMode:"wal", synchronous:2}`, rounds 9.08 / 9.76 writes/s,
  110.2 / 102.4 ms/write, mean 9.42 writes/s.
- Raw `write+fsync` probe: 172.6 ms/fsync, 5.8 fsyncs/s.
- Per-append timing (30 appends): steady ~49 ms/commit.
- `strace -c -e fsync,fdatasync` over 20 commits: 34 `fsync` calls (~1.7/commit).
- Synthetic comparison matrix: §2.2.

## Appendix B — Files read (no edits)

`src/runtime-state/storage/runtime-ledger.ts`, `runtime-state/storage/AGENTS.md`,
`governance/approvals/*` (types, store, binding, reconcile), `governance/audit/*`,
`governance/security/credentials/*`, `governance/security/inspector/*`
(security-context, auth-store, auth-service), `interfaces/server/security-middleware.ts`,
`coordination/ownership/*`, `session/persist.ts`, `operations/daemon/*`,
`docs/2026-10-14-srap-1-contract-proposal.md`, `docs/2026-10-14-srap-1-implementation-plan.md`,
`docs/architecture/adrs/ADR-0015-*.md`, G2-A/G2-C reports, `scripts/benchmark-runtime-ledger.mjs`.
