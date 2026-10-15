# SRAP-1 P5 — independent G2-C re-review

- Date: 2026-10-15
- Baseline: `main` / `origin/main` / `HEAD` = `919c1ab0` (P1 + G2-D/E + P2 + P3 +
  P4 merged)
- Scope: the merged P-series infrastructure fixes (P1, P2, P3), the amended
  owning contracts, and the P4 physical-SSD evidence
- Mode: **independent read-only review + local verification**; the two §7
  completeness items were subsequently closed as a reviewed follow-up (see §7),
  still with no endpoint, no new authority, and no G3 opening
- Verdict: **READY (with carried caveats)** — see §7

This is a dated hand-off record (`docs/AGENTS.md`), not a live contract. The
normative rules it checks live in the owning `AGENTS.md` files and ADR-0015; this
record is the independent evidence and the remaining-risks statement.

## 1. What was re-reviewed, and against what gate

G2-C returned **BLOCKED** at `2c73b044` with six closing conditions (§8 of
`docs/2026-10-14-srap-g2-c-independent-review.md`). G2-E then proved two of the
gaps were concrete defects and ordered the P-series:

| Gate (G2-C §8) | Owning artifact checked | Status |
| --- | --- | --- |
| 1. Exact `ApprovalScope` predicate approved | `src/governance/approvals/AGENTS.md`, `src/interfaces/server/AGENTS.md` | contract complete; not implemented (G3) |
| 2. Credential-store ownership + HMAC lifecycle | `src/governance/security/credentials/AGENTS.md` | contract complete; not implemented (G3) |
| 3. Audit-owned idempotent projection repair | `src/governance/audit/AGENTS.md` | contract complete; not implemented (G3) |
| 4. FULL cost accepted after supported-storage tests | P4 evidence §2/§3 below | met on SSD, tail-latency caveat |
| 5. Doc ownership reconciled with DOX | docs root demotions, ADR-0015 | clear |
| 6. Independent G2-C re-review | this record | READY (caveats) |

P1/P2/P3 close the two discovered defects and the dead-code plumbing gap that
G2-E §F.3 ordered (`docs/2026-10-14-srap-g2-e-operational-verification.md`).

## 2. P1 — audit-chain stale-head recovery (`a0d8fda0`, PR #946)

**Claim:** a crash after the JSONL fsync but before the head sidecar write left a
stale-but-valid sidecar; head recovery ran only for a missing/malformed sidecar,
so the next append reused the committed `seq`/`prevHash` and produced a duplicate
sequence.

**Verified in `src/governance/security/audit/audit-chain-writer.ts`:**
- `reconcileHead()` runs under the caller's audit lock before any seq allocation
  (`doAppend` step 2–3, before step 4's `head.seq + 1`).
- Fast path trusts a sidecar only when it **exactly matches** the persisted,
  hash-valid tip (`isRecordHashValid`).
- Slow path fully verifies from genesis via `verifyAuditLog`, then requires the
  sidecar be genesis or a record the verified chain contains at that seq with the
  same hash (`verified.requestedRecord`).
- Fail-closed on: bounded-tail truncation, genesis-with-sidecar, legacy tail
  after activation, malformed tail, non-verifiable chain, non-ancestor sidecar,
  v2 tip with no verified records.
- Recovery writes only the sidecar (`writeHeadAtomic`); it never truncates,
  rewrites, or discards a JSONL record.

**Independent run:** `tests/audit/audit-chain-recovery.test.ts` — 14/14 pass.
**Contract:** `src/governance/audit/AGENTS.md` states the chain-verified recovery
and the O(1) fast-path trust boundary, including the caveat that historical
corruption is caught by `alix audit verify`, not by the append path.

**Observation (non-blocking):** `audit.stale_sidecar_recovered` / `audit.recovery`
now emit out-of-band recovery telemetry through the writer's optional
`onRecovery` sink (forwarded by `AuditStore`, default stderr); recovery writes no
chained record and consumes no sequence, so P1's frozen sequence semantics are
unchanged. `audit.stale_lock_recovered` / `audit.genesis` remain declared
vocabulary with no emitter. See §7 item 4(b).

## 3. P2 — ledger `BEGIN IMMEDIATE` (`52c0ea87`, PR #947)

**Claim:** the deferred `better-sqlite3` transaction took a read snapshot on the
first `SELECT`, then failed the read→write upgrade with `SQLITE_BUSY_SNAPSHOT`
(unresolvable by `busy_timeout`) when a concurrent process committed in between.

**Verified in `src/runtime-state/storage/runtime-ledger.ts`:**
- `append()` opens with `tx.immediate()`.
- `openDurableLedger()` sets `busy_timeout` **before** the WAL switch, verifies
  `journal_mode=WAL` + `synchronous=2` by read-back, and bounds retries on
  `BUSY|locked` only — a durability mismatch still fails closed.
- `append()` retries transient contention but still returns typed
  `version_conflict` / `invalid_precondition` / `duplicate_event`. Contention and
  optimistic conflict are distinct.
- No schema or public API change.

**Independent run:** `tests/storage/runtime-ledger-contention.test.ts` — 2/2
(multi-process `fork`; independent-entity throughput 0 `SQLITE_BUSY`,
same-entity optimistic conflicts). Duration ~12 s + ~10 s.

**Graph blast radius:** `detect_changes --scope compare --base-ref 2c73b044`
reports `append` touched across 59 execution flows (critical, repository-wide).
This is the expected RuntimeLedger-wide effect, already accepted in G2-D/E; the
red→green contention measurement (~18,800 busy → 0) is the supporting evidence.

**Observation (non-blocking):** retries use a synchronous `Atomics.wait`
backoff, blocking the event loop up to ~250 ms worst case. Only on sustained
contention; acceptable for this substrate but worth noting for latency-sensitive
callers.

## 4. P3 — Inspector workspace authorization (`7103ec56`, PR #950)

**Verified against the approved spec**
(`docs/superpowers/specs/2026-10-15-srap-p3-workspace-authorization-design.md`)
and plan (`.../plans/2026-10-15-srap-p3-workspace-authorization.md`):
- `canonicalWorkspaceId(root) = realpathSync.native(resolve(root))`
  (`src/governance/security/inspector/workspace-scope.ts`). `startServer`
  canonicalizes its root once and **rejects startup** before stores initialize on
  failure.
- `allowsWorkspace`: `undefined` → legacy allow; non-array → deny;
  `[]` → deny; nonempty → canonical membership required.
- Bearer: middleware calls `AuthService.verifyTokenForRequest(raw, targetWorkspace)`.
- Cookie: middleware re-reads current source credentials via
  `verifyPrincipalStatus` and applies the **same** predicate; a denied/absent
  source removes the session and fails closed (401) on protected routes — no
  downgrade to anonymous development access; public auth/logout remain reachable.
- `SecurityContext.workspaceIds` preserves absent-vs-empty; `createSecurityContext`
  copies the array.
- CLI `--workspace <path>`: every path canonicalized and deduped **before**
  `createAuthService`/`createToken`; missing, empty, flag-like, nonexistent, and
  `--workspace=` equals-form values are rejected with no credential/audit side
  effect.
- Request headers/body/query cannot set or override the target workspace.

**Independent runs:** `tests/server/workspace-authorization.test.ts` — 73/73
(48 role×transport×scope×mode parity + 16 independent-store
revocation/expiry/scope cases + malformed-scope + cookie-role + anonymous-mode +
spoofing + canonical-root); `tests/cli/inspector-workspace.test.ts` — 12/12;
`tests/server/auth-routes.test.ts` and
`tests/security/inspector/authorization.test.ts` — pass.

**Bypass check:** the only callers of the auth surfaces are
`security-middleware.ts` (bearer → `verifyTokenForRequest`; cookie →
`verifyPrincipalStatus` + `allowsWorkspace`) and `auth-routes.ts` session
exchange (`verifyToken`, no scope argument — but the minted cookie is scope-checked
on every protected request, so there is no bypass).

**Observation (non-blocking, completeness):** `AuthService.createToken`'s
write-ahead audit records `{ name, role }` but not the enrolled `workspaceIds`.
Scope is enforced, but the enrollment audit event does not itself record the
scope that was granted. Recommended follow-up (G3 or a small P3 amendment):
include the canonical scope in the `token.created` audit details.

## 5. Amended contracts and DOX ownership

- Normative SRAP rules live in the owning `AGENTS.md` files (`approvals`,
  `server`, `audit`, `credentials`) and ADR-0015; the four docs-root SRAP
  documents are demoted with explicit "dated hand-off record, not a live
  contract" banners. This resolves G2-C §7/§8(5) without moving files.
- `pnpm check:dox` on clean `HEAD` reports 0 changed. Re-scoped to the actual
  diffs it passes: base `4440e48c → 919c1ab0` = 2 claims/2 AGENTS.md resolve;
  base `a0d8fda0^ → 919c1ab0` = 32 claims/6 AGENTS.md resolve.
- `typecheck:unused`, `check:dead`, `verify:deps`, and both architecture
  boundary suites (`layer-boundaries`, `r1-boundary-freeze`) pass on the merged
  tree.

## 6. P4 — physical-SSD evidence (`919c1ab0`, PR #951)

**Independently reproduced checks** (raw evidence
`docs/audits/2026-10-15-srap-p4-ssd-results.json`):
- Report's raw-evidence SHA256 `4eeddc0e…dbdbad` matches the file.
- The four `sourceSha256` entries match `git show 7103ec56:<path> | sha256sum`
  exactly — the measured sources are the committed baseline, byte-for-byte.
- All **9** runs pass every reported threshold check (append p95 ≤ 20 ms; reader
  p95 ≤ 5 ms; 0 surfaced errors; WAL/FULL settings; integrity).
- Sustained 387.9–398.2 w/s, burst 384.4–399.1 w/s, session 15.6–15.7 w/s
  (paced); 36,817 appends total; 3/3 process-crash probes recovered every
  observed event with clean integrity.

**Tail latency — the material residual:** sustained append **max reached
5,024.784 ms** and p99 up to 83.7 ms. The report explicitly refuses to infer a
20 ms per-request bound and hands this to P5. G2-E §A.7 defined no p99/max
ceiling, so the numeric gate is met; the tail is a caller-budget question, not a
failed threshold.

**Not provable here:** these are process-crash and filesystem benchmarks on the
operator's SSD host — **not power-loss tests**, and I could not re-measure (this
checkout has no SSD and the report's `/home/babasola/Projects/Monolith` paths are
host-specific). I verified provenance and internal consistency, not the raw
numbers.

## 7. Verdict and remaining risks

**Verdict: READY (with carried caveats).** The two G2-E defects are fixed and
regression-guarded (P1, P2); the workspace-authorization plumbing is wired,
enforced for both transports, and covered by a broader-than-implementation
parity table (P3); the owning contracts are reconciled and `check:dox` passes;
and the P4 SSD run meets the proposed operational thresholds with reproducible
provenance. There is **no new architectural blocker**.

Carried caveats — none blocks opening G3, but each must be owned before the
remote endpoint ships:

1. **Sustained tail latency (SSD).** Append max ≈ 5 s, p99 ≈ 84 ms under 4-writer
   saturation. Human-rate approval/session/daemon callers tolerate this;
   coordination-scale sustained bursts need an explicit caller-budget decision
   (or group commit, which ADR-0015 keeps a separate milestone). No numeric
   p99/max ceiling was ever defined.
2. **Power-loss durability remains a storage-controller claim.** All probes are
   process-crash; `synchronous=FULL` asserts but does not prove power-loss
   behavior. Unchanged from G2-C.
3. **G3 forward items are contracts, not code.** Eligibility predicate, HMAC
   `srap-evidence` lifecycle, and audit-owned idempotent projection are specified
   in the owning DOX; no route, key, dedup index, or projector exists. G3 must
   implement them and ship the approvals parity table the contract requires.
4. **Minor completeness items — both closed (2026-10-15 P5 follow-up).**
   (a) `AuthService.createToken` / `rotateToken` now record the granted
   `workspaceIds` in the `token.created` / `token.rotated` audit details
   (`null` = undefined legacy scope, `[]` = explicit deny-all).
   (b) `audit.stale_sidecar_recovered` / `audit.recovery` now emit out-of-band
   recovery telemetry via `AuditChainWriterConfig.onRecovery` (forwarded by
   `AuditStore`, default stderr); no chained record and no sequence consumed.
   Type names (aligned to the implementation): `AuditRecoveryEvent` is the
   discriminated union of `AuditSidecarRecoveredEvent`
   (`action: "audit.stale_sidecar_recovered"`) and `AuditRecoveryFailureEvent`
   (`action: "audit.recovery"`, `outcome: "failed" | "error"`). Consumers
   discriminate on `action` and, for `audit.recovery`, on `outcome`
   (`"failed"` = fail-closed verdict, `"error"` = reconciliation defect).

**G3 remains closed.** Opening it is an explicit operator decision that this
review does not make; this record only returns the independent re-review result.

## 8. Verification performed (independent)

- `rm -rf dist && pnpm build` — pass (clean, no stale test tree).
- Focused: P1 14/14, P2 2/2, P3 server 73/73 + CLI 12/12, auth-routes and
  inspector authorization suites — pass.
- Architecture: `layer-boundaries` and `r1-boundary-freeze` — pass.
- `pnpm typecheck:unused`, `pnpm check:dead`, `pnpm verify:deps`, `pnpm check:dox`
  (clean + diff-scoped) — pass.
- P4: raw-evidence SHA256 and four `sourceSha256` reproductions — match.
- Graph: `detect_changes --scope compare --base-ref 2c73b044` — critical, 59
  flows (expected RuntimeLedger-wide effect).

## Read alongside

1. `docs/2026-10-14-srap-g2-c-independent-review.md` — original BLOCKED review.
2. `docs/2026-10-14-srap-g2-e-operational-verification.md` — P-series rationale.
3. `docs/2026-10-15-p4-ssd-benchmark.md` — P4 evidence (this review's §6).
4. `docs/architecture/adrs/ADR-0015-srap-one-ledger-decision-evidence.md`.
5. `docs/2026-10-15-srap-p2-handoff.md` — P-series status and next steps.
