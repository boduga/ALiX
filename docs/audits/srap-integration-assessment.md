# ALiX — SRAP & Option B Integration Assessment

> **Limitation:** `2026-10-14-srap-option-b-design.md` is **not present** in the repo
> (`glob **/2026-10-14-srap-option-b-design.md` → no files; `grep -rE "SRAP|AUT-[0-9]|VOICE-|EDGE-"` → zero hits).
> This is therefore a **readiness assessment against the verified implementation**, not a
> compatibility review of the proposal. Request the design doc before detailed sign-off.
> Rule: no second approval authority; no mobile/agent direct-authorize outside governance lifecycle.

## Existing lifecycle (what SRAP must reuse)

- Single boundary: `ExecutionAuthorization.evaluate()`
  (`src/runtime-state/runtime/execution-authorization.ts:32-124`) → `PolicyGate` →
  approval lifecycle → ownership → audit/event. All tool, graph (`evaluateRuntimeGate`),
  daemon (`daemon-server.ts:480-531`), and Inspector (`coordination-routes.ts`) paths converge here.
- Queue: `ApprovalStore` (`src/governance/approvals/approval-store.ts`):
  `.alix/approvals/approvals.json` + journal, ledger authoritative (R2.5 append-is-commit),
  `bindingKey`+`requestFingerprint` dedup, `requestId` retry dedup, `usePolicy`
  (`single_use|worker_attempt|coordination_run|session`), `expiresAt` (default 30 min),
  statuses `pending|approved|denied|consumed|expired|revoked|invalidated`
  (`approval-types.ts`). Reconciliation: `approval-ledger-reconcile.ts`.
- Presentation: CLI-first (`alix approvals {list|pending|show|approve|deny|reconcile}`,
  `cli/helpers/approval-stores.ts` unions project+global); TUI resolver+manager
  (`approval-resolver.ts`, `approval-manager.ts`, `recordLocally:false`); Inspector
  coordination routes (detached `POST /api/coordination/run`, poll GET).
- Identity/auth: Inspector tokens `alix_<id>_<secret>` SHA-256, roles
  `readonly|operator|admin`+`workspaceIds`, per-request revalidation, fail-closed audit
  (`governance/security/inspector/`); provider keys store-only (`cred://` or config file).
  `decidedBy` is free-text; `agentId` end-to-end; `operator` never inferred.

## Coverage matrix

| SRAP concern | Exists | Extension needed | Genuinely new |
|---|---|---|---|
| Governance/approval lifecycle | ✅ `ApprovalStore`+statuses+`usePolicy` | async-phone waiter on pending (poll/SSE already exist) | — |
| Authorization boundary | ✅ `ExecutionAuthorization`+`PolicyGate` | route phone decisions through same `evaluate()` | — |
| Approval persistence | ✅ ledger-backed store+journal+reconcile | retention/multi-device projection | — |
| Operator identity | partial (Inspector roles; `decidedBy` free-text) | bind `decidedBy` to authenticated principal; non-repudiation | — |
| Device enrollment/revocation | ❌ | — | enrollment, keys, revocation list, per-device scope |
| Passkeys/WebAuthn | ❌ (`grep webauthn\|passkey` → zero) | — | authenticator registration + assertion verification |
| Crypto action binding | ❌ (only `bindingKey` dedup, no signatures) | include `bindingKey`+fingerprint in signed payload | signatures (Ed25519), canonical JSON (have `canonical hashing` per ADR-0009 — reuse) |
| Replay protection | partial (bindingKey/requestId dedup) | nonces + single-use consume enforcement | server nonces, challenge-response |
| Approval expiration | ✅ `expiresAt` + sweeper (`:731`,`:802`) | per-risk TTL policy, phone-timeout UX | — |
| Workbench presentation | ✅ CLI+TUI+Inspector | phone client as **projection** (read pending, post decision) | mobile UI (outside repo) |
| API exposure | ✅ GET-heavy, 2 detached POSTs | `POST /api/approvals/:id/decide` with `coordination:execute`-grade permission, 16KB-style caps, rate limits | remote-access policy extension (loopback-dev bypass must not apply) |
| Remote connectivity | partial (Inspector HTTP + daemon socket) | TLS/origin/host policy for non-loopback; push/SSE to phone | relay/push infra, NAT traversal |
| AFK coordination | ❌ (no AFK evidence) | escalation/timeout → phone when operator idle | idle detection, escalation policy |
| Distributed execution | ❌ (M9 Not started) | keep out of SRAP v1 | M9/EDGE-* workers |
| Audit evidence | ✅ audit stores + EventLog + ledger | record device/authenticator/nonce/signature per decision | schema extension (additive only) |

## Verdicts

- **Async phone approvals without changing the state machine: YES, with extensions.**
  `pending → approved/denied → consumed/expired/revoked` already supports out-of-band decisions;
  phone is a new *presenter + authenticated decider*, not a new authority. Required: authenticated
  `POST …/decide` → existing store transition → existing `ApprovalWatcher`/scheduler tick → same
  `ExecutionAuthorization` consumption. No `approved`-means-executed shortcut (Approve≠Apply invariant).
- **Do not** create `MobileApprovalStore`, `PhonePolicyGate`, or direct-execute endpoints.
  Phone posts a *decision*; execution still flows through `ToolExecutor`/`GraphExecutor` server-side.
- **Biggest gaps (all new):** device enrollment/revocation, WebAuthn, action-binding signatures,
  replay nonces, remote-access hardening, push/SSE to phone, AFK escalation. None exist today —
  do not mistake `bindingKey`/`requestFingerprint` for cryptographic binding.

## Minimal SRAP v1 shape (no state-machine change)

1. `POST /api/approvals/:id/decide {decision, reason, nonce, signature}` → auth (`operator|admin`) →
   existing `ApprovalStore.decide()` → ledger append → `approval.updated` event.
2. Phone client: list pending (GET projection) → sign (`bindingKey|fingerprint|expiresAt|nonce`) →
   post decision; server verifies signature + nonce + expiry + scope, then transitions.
3. Every decision records `decidedBy` (principal), deviceId, authenticator, nonce, signature in audit.
4. Timeouts: keep 30-min default; per-risk TTL; expired stays terminal; consumed single-use enforced.

## What to request before implementation

`2026-10-14-srap-option-b-design.md` + answers: key custody (phone keystore vs server),
enrollment ceremony, revocation propagation time, offline-approve policy (recommend: deny),
replay window, signature algorithm, push transport, AFK triggers, M9/EDGE overlap,
Rust scope (recommend: none for SRAP v1 — TS + existing SQLite/HTTP suffice).
