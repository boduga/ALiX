# DOX — Approvals

## Purpose

File-backed approval queue management — create, resolve, list, and lookup pending/resolved approvals.

## Ownership

- `approval-store.ts` — File-backed store at `.alix/approvals/approvals.json`. Supports create, resolve, list, listPending, findPending, findResolved, get. `ApprovalRequestInput.metadata` carries a structured payload for non-tool approvals (e.g. `alix_schedule_propose`), copied onto the record.
- `approval-ledger-reconcile.ts` — R2.4 read-only comparison of the approvals projection (snapshot + journal replay) against the transactional ledger; reports `missing_in_ledger` / `record_mismatch` / `projection_stale` / `projection_missing` / `version_behind` / `ledger_payload_invalid`, counts unknown event types, reports truncated reads.
- `global-store.ts` — `openGlobalApprovalStore()`: the cross-project store at `~/.alix/approvals`. Schedule proposals live here so the daemon and the human see them regardless of cwd; `src/interfaces/cli/helpers/approval-stores.ts` unions it with the project store for the one-inbox `alix approvals` surface.
- CLI commands in `src/cli.ts` — `alix approvals {list|pending|show|approve|deny|reconcile}` (unions project + global stores; `reconcile` is project-ledger scoped).

## Local Contracts

- Approvals are CLI-first. Sole browser write exception: default-off
  `POST /api/approvals/:id/decision` for SRAP-1 (`src/interfaces/server/remote-decision-route.ts`;
  `ui.security.remoteDecisions.enabled`, default false). It is bearer-only and
  may only resolve through `ApprovalStore`; requires `approvals:decide`, an
  active persistent operator principal, explicit nonempty workspace scope
  containing the canonical server workspace, trusted TLS transport, an unexpired
  pending approval, and idempotency evidence. It attempts the audit projection
  inline and supports repair at server startup and via `alix approval project`;
  JSONL projection success is not approval authority. No other browser approval
  write is allowed, and this exception grants no execution authority.
- **Remote-approval workspace eligibility is canonical and fail-closed.** The
  canonical workspace identity and how the server derives it are owned by
  `src/interfaces/server/AGENTS.md` (server-derived from the resolved project
  root; never a request-supplied value). This store requires that a token
  explicitly list that identity in `workspaceIds`; a token with missing or empty
  scope is denied for remote decision even where other Inspector routes accept an
  unscoped token. Eligibility is `authenticated ∧ approvals:decide ∧
  activePrincipal ∧ canonicalWorkspace ∈ token.workspaceIds ∧ approval pending ∧
  unexpired`. Exact idempotent retries re-run the same authorization and scope
  checks before returning `200`; a conflicting retry is `409` without state
  disclosure. No per-approval principal grant and no per-agent/per-run operator
  ownership is introduced.
  - **Parity requirement (implemented).** The route ships the authorization
    parity table `tests/approvals/remote-decision-parity.test.ts` broader than the
    handler — role × workspace scope × transport × principal × approval state ×
    exact-retry identity — covering allow (active operator/admin with scope), and
    fail-closed deny for anonymous, `readonly`, missing `approvals:decide`, cookie
    session, unbound legacy credential, non-TLS/untrusted transport, missing/empty
    scope, cross-workspace, cross-record, unknown/expired/decided approval, and
    conflicting retry. A bound credential whose principal is disabled or revoked is
    already denied at authentication (A′), so it never reaches this route.
    `tests/server/derive-permissions.test.ts` pins the `approvals:decide` grant
    (admin + operator, never `readonly`).
- **`approval.created` has exactly one producer per composition root, chosen by
  capability.** The store emits it from its committed creation transition, but
  only when the store itself was constructed with an `EventLog`
  (`ApprovalStore.emit()` is a no-op otherwise); `ApprovalStore.emitsLifecycleEvents`
  reports that construction state. `PolicyGate` emits `approval.created` itself
  **only** when the store positively reports it has no log, and never on top of a
  store that emits — duplicate creation events inflate approval-volume counters
  (F1-B), while silence on both paths erases the approval lifecycle entirely
  (headless `alix run` built the store without a log, so the gate must supply it).
  `approval.reused` is always the gate's: the store emits nothing on reuse.
  Pinned in both directions by `tests/security/approval-event-dedup.vitest.ts`.
- Approval records are durable JSON — full history preserved.
- **The approval ledger is authoritative (R2.5); JSON/journal is a
  compatibility projection.** `mutate()` appends its classified diff to the
  shared transactional ledger (`.alix/runtime-ledger.db`,
  `src/runtime-state/storage/runtime-ledger.ts`) INSIDE the per-file lock and BEFORE the
  projection write — the append IS the commit:
  `approval.created` / `approval.updated` (full `ApprovalRecord` payload) /
  `approval.removed` (retention-prune tombstone). Append failure throws (no
  JSON-only mutation can exist); projection failure is tolerated and counted
  in `ledgerStatus().projectionFailures`. `load()` rebuilds in-memory state
  from `readLatestByEntityType("approval")`, consulting snapshot+journal only
  for legacy zero-fact records — so every reader (`get`, `list`, `findPending`,
  `findResolved`, `findExact`, …) and every subsequent `mutate()` sees ledger
  truth. Ledger db errors THROW from `load()` (counted, never masked).
  `APPROVAL_LEDGER_EVENT_TYPES` lives in `approval-types.ts` (the store is a
  protected import under the R1 freeze).
- Approval records preserve optional canonical `agentId` correlation from execution authorization through created/resolved lifecycle events; never derive it from `workerId` or display labels.
- **Coordination approvals are created with the canonical binding atomically.** `PolicyGate.handleAskDecision` commits them through `requestOrReusePending` (see `src/governance/policy/AGENTS.md`); the store persists `bindingKey`, `requestFingerprint`, `policyRevision`, `capabilities`, `ownershipClaims`, and `coordinationRunId`/`workerId`/`workerAttempt` in the one authoritative `approval.created` ledger payload. `findExact`/`findPendingByBindingKey` are indexed from that committed record, so a freshly reloaded store sees the coordination binding. A post-commit field patch on a `request()` result is NOT a valid way to set these — the legacy `request()` binding would be the committed truth.
- **Isolated worker processes reach the ledger through a RESTRICTED port, never a store.** A coordination subagent runs as its own OS process spawn-time-cwded to the parent's workspace, so it cannot receive the parent's in-memory `ApprovalStore`. `createWorkerApprovalPort` (`worker-approval-port.ts`) opens the child's own store against that SAME authoritative workspace and exposes only request / observe / consume / report-outcome. It deliberately has NO reachable decision method (`resolve`, `resolveWithEvidence`, `resolveGroup`, `revoke`, `invalidate`, `mutate`) — handing a child a full store would let a compromised worker approve its own request, i.e. grant itself any capability. The facade self-checks at construction and throws if a forbidden method ever becomes reachable. Decisions stay operator-controlled because no reachable method records one. Cross-process atomicity is the store's, not the port's: `consumeApproved` re-reads and re-validates under the cross-process lock, so two processes cannot both consume one single-use approval. An unopenable or unloadable ledger wires no port and emits `subagent.approval_store_unavailable` — gated tools then stay denied; an inaccessible store is never implicit permission.
- **Single-use approval consumption is one claim at one seam.** `consumeApproved` is the only atomic claim. `ToolExecutor.dispatch` claims a cited tool approval; the coordination exact-binding branch inside `PolicyGate` consumes in-gate and reports `approvalConsumed: true`, so dispatch does not claim twice. A legacy prior approval with no invocation fingerprint fails closed and is re-asked, never reused; a `consumed` approval is denied with an exact reason naming the recorded outcome.
- **A consumed approval carries a durable post-claim execution outcome.** The claim sets `executionOutcome: "pending"`; the executor then reports `recordExecutionOutcome` (`succeeded`/`failed`/`cancelled`), and only the first terminal transition from `pending` is accepted so a duplicated report cannot rewrite a resolved claim. A claim whose holder never reported back stays `pending`; a later replay classifies it `unverified` via `markExecutionUnverified` — terminal, fail-closed, never reissued. `listUncertainConsumptions` reports `pending`/`unverified` claims without a wall-clock sweep. Events: `APPROVAL_EVENT_TYPES.EXECUTION_SUCCEEDED`/`EXECUTION_FAILED`/`EXECUTION_CANCELLED`/`EXECUTION_UNVERIFIED`.
- **Approval authority binds to the exact invocation, not the request id.** `ApprovalRequestInput.invocation` (`InvocationIdentity`: capability, toolName, workspace, argsHash, sessionId, agentId) is persisted with a deterministic `computeInvocationFingerprint`; `consumeApproved` takes an optional `expectedInvocation` and refuses on mismatch. `invocationMatches` returns false for a record with no fingerprint, so a legacy record is never reused on a request-id match alone.
- **Remote-decision evidence is bounded and lives in the ledger payload.** `RemoteDecisionEvidence` (`approval-types.ts`) is persisted on the `ApprovalRecord` inside the authoritative `approval.updated` ledger event via `ApprovalStore.resolveWithEvidence`; `resolve` (no evidence) is unchanged for CLI/local decisions. Fields: `decisionId` (idempotency key for audit projection), `principalId`, `credentialRef` (versioned HMAC over the credential record id — never a raw token/credential id), `decision`, `nonce`, `decidedAt`, `transport`. `remoteDecisionRetryKey` is the bounded exact-retry identity (`principalId`+`nonce`+`decision`).
  - **A′ landed (SRAP-1 G3-A′).** `principalId` resolves to a `PrincipalRecord`
    (`src/governance/security/inspector/principal-store.ts`) bound via
    `StoredToken.principalId` (the single binding authority); it is never the
    token/credential id. The remote decision route (G3-C) remains unbuilt and
    blocked behind its own review.
- `findPending` returns first match (expect at most one pending per graph/node/capability key).
- `findResolved` returns most recent resolved record for a key.
- `--enforce-capabilities` in graph run/sop run triggers approval creation via RuntimeGate.

## Work Guidance

- RuntimeGate (`src/governance/policy/runtime-gate.ts`) is the primary consumer of `findPending` and `findResolved`.
- Adding new fields to ApprovalRecord means updating the type, all call sites, and the audit emission.
- CLI commands mirror the store methods: list, pending, show, approve, deny.

## Verification

- `tests/approvals/approval-store.test.ts` — all CRUD, persistence, lookup methods.
- `tests/kernel/coordination-approval-binding.test.ts` — coordination binding persisted and matched through the real chain (see `src/coordination/kernel/AGENTS.md`).
- `tests/approvals/approval-ledger-dualwrite.test.ts` — ledger authority (create/resolve/journal path/prune tombstone), append-failure fail-closed, projection-failure tolerance, tampered-projection ignored, reconciliation drift (legacy/mismatch/tamper).
- `tests/audit/remote-decision-projection.test.ts` — SRAP remote-decision projection: idempotent re-run, duplicate drop, chain-anchored dedup after checkpoint loss, fail-closed on unverifiable chain, lag counter.
- `tests/security/legacy-approval-single-use.test.ts` — single-use across the ordinary retry and continuation routes, changed args/capability/agent, legacy unbound re-ask, and concurrent duplicate execution.
- `tests/security/approval-crash-recovery.test.ts` — crash-after-consume classification (`pending` → `unverified`), outcome reporting, duplicate-outcome rejection, and the continuation seam.
- `tests/security/approval-consumed-propagation.test.ts` — `approvalConsumed` propagation through `decisionAllowed`/`ExecutionAuthorization`.

## Child DOX Index

None.
