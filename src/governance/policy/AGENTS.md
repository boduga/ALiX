# DOX — Policy Engine

## Purpose

Policy rules, evaluation, and runtime enforcement — determines whether ALiX is allowed to execute a capability.

## Ownership

- `policy-rule.ts` — PolicyRule type, matchPolicy(), validatePolicyRule()
- `rule-evaluator.ts` — Pure first-match-wins evaluator (decoupled from runtime subsystems)
- `runtime-gate.ts` — Graph-node authorization adapter (R3.7): capability coverage (CapabilityResolver) + the graph-specific approval reuse/create lifecycle, with every POLICY decision routed through the one `ExecutionAuthorization` boundary (the same service tools and coordination workers use). Not a second policy authority.
- `policy-gate.ts` — PolicyGate, the single authoritative policy engine: tool-call and capability evaluation with approval lifecycle (binding-key reuse for coordination, capability reuse for capability asks, fresh approval per tool call in ask mode), plus TUI policy snapshots. Do not introduce a second policy authority.
- `default-policies.ts` — 11 built-in rules (allow/ask/deny by risk level and capability)
- `policy-loader.ts` — Load rules from `.alix/policies/*.json`, fall back to defaults

## Local Contracts

- **Owned-scope matching is owned by `src/coordination/ownership/AGENTS.md`.** This gate is
  one of the two enforcement points and calls `isWithinOwnedScope`; it must
  never grow its own matcher or re-normalize a grant. The rule, the fail-closed
  cases, and the workspace-wide vocabulary are documented there — read them
  there rather than restating them here.
- Two-layer enforcement: capability coverage first, policy second.
- Most-restrictive-wins across multiple capabilities: deny > ask > allow.
- RuntimeGate checks ApprovalStore for prior approvals before creating new ones.
- One pending approval per key: capability asks reuse the pending approval for their capability; coordination asks reuse by exact binding key; ask-mode tool calls always create a fresh record.
- **Coordination asks create the approval with the canonical binding ATOMICALLY.** When `handleAskDecision` receives coordination context it computes the exact `bindingKey` and commits the record through `ApprovalStore.requestOrReusePending({ bindingKey, requestFingerprint, policyRevision, capabilities, ownershipClaims, coordinationRunId, workerId, workerAttempt, … })` — never the legacy `store.request()` followed by a post-commit field patch. `store.request()` derives its own legacy binding and commits it first, so a post-commit patch left the authoritative ledger/projection and the in-memory binding index carrying the LEGACY key and reconciliation could never match. `requestOrReusePending` also de-dups the pending lookup inside the same locked mutate (no check-then-create race). The coordination context reaches this point only through `ExecutionDecisionRequest.coordination` (typed, validated at the boundary) — see `src/runtime-state/runtime/AGENTS.md`.
- **Coordination authorization reads refreshed persisted state (cross-process visibility).** `handleAskDecision`'s coordination branch calls `await store.load()` BEFORE any authorization read (`findExact`/`findPendingByBindingKey`). The daemon holds ONE ApprovalStore for its lifetime while the operator resolves approvals from a separate `alix approvals approve` process that writes the authoritative ledger (R2.5); reading only the startup-era in-memory projection never observed the decision without a daemon restart (a blocked worker re-blocked forever — the SRAP D2 operational defect). This reuses the store's own `load()` (ledger-authoritative rebuild) — it is NOT a second authority and NOT an independent cache. Consumption stays atomic and single-use: `consumeApproved` reloads and re-validates status/expiry/binding UNDER THE STORE LOCK, so the refresh introduces no time-of-check/time-of-use gap. A load failure DENIES (`approval-refresh-failed`) — fail closed, never authorize, re-block, or mint against possibly-stale state. That failure is **terminal for the run by design** (worker → failed → `authorization_denied`) and observable (rule id + cause in `authorizationEvidence`); it is deliberately NOT mapped to a retryable block — automatic recovery needs its own design (retry limits, backoff, liveness, approval expiry, failure classification) and is out of scope here. Non-coordination asks are unchanged. Pinned by `tests/kernel/coordination-approval-binding.test.ts` (cross-process resume with no restart/watcher tick, pending/denied/revoked, refresh-failure fail-closed and worker-level classification/observability, bounded per-attempt refresh — idle ticks never reload — and single consumption under concurrent attempts) and `tests/approvals/approval-store.test.ts` (an unlocked `load()` interleaved with mutations loses no committed create/consume).
- **Coordination approval authority is host-parity (SRAP PR B).** Every host that can return an approval-required coordination decision must hold the SAME durable authority. The daemon wires `loadApprovalStore(cwd)` at startup (`daemon-server.ts`); the CLI resolves it per command through `buildCoordinationPolicyGate` (`src/interfaces/cli/commands/coordination.ts`) and injects the same project-scoped store into its `PolicyGate`. A `PolicyGate` constructed with NO approval store still fails closed on an ask (`approval-store-missing`) — `loadApprovalStore` returning `undefined` (unreadable store) therefore produces an explicit authorization failure, never an `approvalId` of `"unknown"`. The aggregation boundary (`authorizeWorker`) likewise fails closed when an approval-required verdict names no durable approval id — including the `ExecutionAuthorization` legacy sentinel `"unknown"` (it coerces an id-less `ask` to `"unknown"` for the graph reuse path) — rather than exposing it as a pending approval. One authority; no second store, resolver, or cache. Pinned by `tests/cli/commands/coordination-approval-wiring.test.ts` (real-component CLI path: allowed/ask, cross-process resolve, binding-mismatch capability/policy-revision/expiry rejection, restart survival, missing-store fail-closed, daemon/CLI decision+binding parity) and `tests/kernel/coordination-authorization.test.ts`.
- Policy evaluation forwards the execution request's optional canonical `agentId` into durable approval records and lifecycle events without changing the allow/ask/deny decision.
- Default deny when no rule matches ("deny by default" closure).
- Headless exception: with no approval store (delegate subagent child),
  `alix_web_search`/`alix_web_fetch` and the zero-side-effect `alix_done`
  auto-allow (`headless-read-allow`, mirroring the default
  allow-web-search/fetch rules); all else fails closed.

## Work Guidance

- RuleEvaluator is pure logic — no side effects, no I/O. Keep it testable.
- RuntimeGate is the graph-node integration point — it combines registry coverage, the shared authorization boundary, and graph approval reuse/creation. Policy decisions go through `ExecutionAuthorization`; do not call `PolicyGate.evaluateCapability` directly from a graph path.
- Adding a new policy rule type means updating `policy-rule.ts` (match fields), `default-policies.ts` (default instances), and the shared `ExecutionAuthorization`/`PolicyGate` path (if the evaluation logic changes).

## Verification

- `tests/policy/policy-gate.test.ts` — the owned-path rule across the full space of workspace-wide spellings (listed and derived), and fail-closed behaviour. A router-only test bypasses this enforcement point.
- `tests/policy/policy-rule.test.ts` — validation and matching
- `tests/policy/rule-evaluator.test.ts` — evaluator and default policies
- `tests/policy/policy-loader.test.ts` — disk loading and fallback
- `tests/policy/runtime-gate.test.ts` — composed gate behavior

## Child DOX Index

None.
