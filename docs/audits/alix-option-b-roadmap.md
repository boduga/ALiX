# ALiX — Option B Roadmap (collision-free identifiers)

> Identifiers verified unused (`grep -rE "SRAP-|AUT-|VOICE-|EDGE-" docs src tests` → zero hits).
> Extend `ApprovalStore` + `ExecutionAuthorization`, never fork. No prod-code change in this audit.

## 0. Reuse as-is

- Approval lifecycle + `usePolicy` + `expiresAt` sweepers; `bindingKey`/`requestId` dedup.
- `ExecutionAuthorization` boundary; `PolicyGate` first-match-wins; ownership matcher.
- Ledger-backed `ApprovalStore` + reconcile; EventLog + `RuntimeSnapshot`.
- CLI approvals union; TUI resolver/manager; Inspector GET projections + detached POST pattern.
- Inspector roles + fail-closed audit; store-only keys; redaction-before-call.

## Milestones

### SRAP-1 — Authenticated remote decide

- Objective: phone as authenticated decider through existing lifecycle.
- Deps: none. Subsystems: `governance`, `interfaces/server`, `runtime-state`.
- Boundaries: phone POST `api/approvals/:id/decide` → `ApprovalStore.decide()`; execution unchanged.
- Acceptance: remote decision visible via CLI/TUI/Inspector; `decidedBy`=principal; audit row with device/nonce fields.
- Tests: extend `r15-authorization.test.ts`; new `srap-decide.test.ts` (authz matrix, expiry, double-decide, revoked token).
- Risks: loopback-dev bypass must not apply remotely; rate limits. Rollback: flag route off; additive-only schema.

### SRAP-2 — Device enrollment and revocation

- Objective: per-device keys, scopes, revocation list. Deps: SRAP-1. Subsystems: `governance/security`, `runtime-state`.
- Boundaries: enrollment admin-only; revocation checked per-request.
- Acceptance: enroll then approve works; revoke rejects within 1 request; workspace scope enforced.
- Tests: ceremony, propagation, scope escape. Rollback: disable enrollment.

### SRAP-3 — Action binding + replay protection

- Objective: Ed25519-signed bindingKey/fingerprint/expiresAt/nonce, server-verified, single-use nonces.
- Deps: SRAP-1/2. Subsystems: `governance`, `runtime-state` (canonical JSON per ADR-0009).
- Acceptance: tamper/replay/expired rejected and audited. Tests: tamper matrix, nonce reuse, clock skew.
- Rollback: remote stays signed-or-deny; loopback unsigned only under flag.

### SRAP-4 — AFK escalation and timeouts

- Objective: idle operator escalates pending to phone with per-risk TTL. Deps: SRAP-1. Subsystems: `operations`, `interfaces`, `coordination`.
- Boundaries: escalation only notifies; authority stays in store transition.
- Acceptance: idle threshold triggers push/SSE; phone decision consumes same record once.
- Tests: timing, double-approve race. Rollback: escalation off.

### AUT-1 — Headless + systemd + durable sessions

- Objective: supported `alix daemon` under systemd. Deps: none. Subsystems: `operations/daemon`, `session`.
- Acceptance: unit file, restart recovery via existing reclaim, `reconcile-sessions` clean.
- Tests: daemon lifecycle, crash recovery. Rollback: stop unit; foreground unaffected.

### AUT-2 — Unified API for web/mobile clients

- Objective: read projections + detached runs + approval decide for future clients. Deps: SRAP-1. Subsystems: `interfaces/server`.
- Boundaries: GET-heavy; execution only via existing detached coordination POSTs; no direct-execute routes.
- Acceptance: permission matrix green; 16KB-style caps; rate limits. Rollback: revoke tokens.

### EDGE-1 — Distributed workers (deferred, overlaps M9)

- Objective: remote workers behind same `ExecutionAuthorization`. Deps: AUT-1/2. Status: optional future; keep out of SRAP v1.

### VOICE-1 — Local voice satellite (deferred)

- Objective: wake-word + audio triggers that only *request* approvals, never grant. Status: optional future.

## Rust and deployment assessment

- Rust justified only with benchmark evidence for: wake-word/audio, IPC/high-frequency events, tool isolation, long-running services. Default: optimize TS first. No wholesale rewrite.
- SRAP v1 needs no Rust: TS + SQLite ledger + HTTP/SSE suffice (signatures via Node crypto).
- Deployment: headless daemon + systemd feasible now (manager, socket `~/.alix/alixd.sock`, ledger tasks R2.15, heartbeat, cooperative cancel); durable sessions via R2.18; distributed workers/web/mobile require AUT-2 + M9/EDGE work.
- Risks: unjailed local execution (assume server-side authority); push/NAT traversal; key custody; notification storms.

## Recommended next milestone

Land this audit, approve migration manifest, request `ALiX_OPTION_B_SRAP_DESIGN.md`, then implement **SRAP-1** (smallest disruption, proves async phone path on current state machine).
