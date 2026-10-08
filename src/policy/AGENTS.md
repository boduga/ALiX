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

- **Owned-scope matching is owned by `src/ownership/AGENTS.md`.** This gate is
  one of the two enforcement points and calls `isWithinOwnedScope`; it must
  never grow its own matcher or re-normalize a grant. The rule, the fail-closed
  cases, and the workspace-wide vocabulary are documented there — read them
  there rather than restating them here.
- Two-layer enforcement: capability coverage first, policy second.
- Most-restrictive-wins across multiple capabilities: deny > ask > allow.
- RuntimeGate checks ApprovalStore for prior approvals before creating new ones.
- One pending approval per key: capability asks reuse the pending approval for their capability; coordination asks reuse by exact binding key; ask-mode tool calls always create a fresh record.
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
