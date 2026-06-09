# DOX — Policy Engine

**Purpose:** Policy rules, evaluation, and runtime enforcement — determines whether ALiX is allowed to execute a capability.

**Ownership:**
- `policy-rule.ts` — PolicyRule type, matchPolicy(), validatePolicyRule()
- `rule-evaluator.ts` — Pure first-match-wins evaluator (decoupled from runtime subsystems)
- `runtime-gate.ts` — Two-layer gate: CapabilityResolver + RuleEvaluator + ApprovalStore
- `default-policies.ts` — 11 built-in rules (allow/ask/deny by risk level and capability)
- `policy-loader.ts` — Load rules from `.alix/policies/*.json`, fall back to defaults

**Local Contracts:**
- Two-layer enforcement: capability coverage first, policy second.
- Most-restrictive-wins across multiple capabilities: deny > ask > allow.
- RuntimeGate checks ApprovalStore for prior approvals before creating new ones.
- Default deny when no rule matches ("deny by default" closure).

**Work Guidance:**
- RuleEvaluator is pure logic — no side effects, no I/O. Keep it testable.
- RuntimeGate is the integration point — it combines registry, policy, and approvals.
- Adding a new policy rule type means updating `policy-rule.ts` (match fields), `default-policies.ts` (default instances), and `runtime-gate.ts` (if the evaluation logic changes).

**Verification:**
- `tests/policy/policy-rule.test.ts` — validation and matching
- `tests/policy/rule-evaluator.test.ts` — evaluator and default policies
- `tests/policy/policy-loader.test.ts` — disk loading and fallback
- `tests/policy/runtime-gate.test.ts` — composed gate behavior
