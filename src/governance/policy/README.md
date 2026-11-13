# Policy Engine

## Overview
Single authoritative policy decision layer for ALiX. `PolicyGate` decides whether a tool call or a capability runs, returning exactly one `allow`/`ask`/`deny` verdict that is both logged and enforced. Supporting modules supply the pure deny-wins rule evaluator, rule loading and defaults, protected-path matching, shell/command/network screening, secret redaction, and deterministic policy-revision fingerprints used to bind approvals.

## Interface
- `PolicyGate.evaluateToolCall(request)` / `evaluateCapability(request)` / `snapshot()` [policy-gate.ts:PolicyGate]
- `PolicyGateDecision`, `ToolPolicyRequest`, `CapabilityPolicyRequest` [policy-gate.ts:PolicyGateDecision]
- `resolvePolicyPath(cwd, path)` [policy-gate.ts:resolvePolicyPath]
- `RuleEvaluator` with `evaluate`/`evaluateBatch`/`addRule`/`setRules`/`getEnabledRules`/`getAllRules` [rule-evaluator.ts:RuleEvaluator]
- `PolicyRule`, `PolicyMatch`, `PolicyDecision`, `RiskLevel`, `matchPolicy`, `validatePolicyRule` [policy-rule.ts:PolicyRule]
- `loadPolicyRules(cwd)` / `loadRuleEvaluator(cwd)` [policy-loader.ts:loadPolicyRules]
- `defaultPolicyRules()` [default-policies.ts:defaultPolicyRules]
- `computePolicyRevision(config)` [policy-revision.ts:computePolicyRevision]
- `isProtectedPath` / `workspaceRelative` internal protected-path helpers [policy-gate.ts:isProtectedPath]
- `ApprovalManager`, `ApprovalQueue` (interactive/queue approval helpers) [approvals.ts:ApprovalManager]
- `CommandClassifier`, `classifyCommand`, `CommandRisk`, `CommandClassification` [command-classifier.ts:CommandClassifier]
- `ShellWhitelist`, `DEFAULT_ALLOWED_COMMANDS`, `BLOCKED_COMMANDS`, `parseWhitelistEnv` [shell-whitelist.ts:ShellWhitelist]
- `NetworkPolicyMatcher`, `matchNetwork`, `NetworkPolicy`, `NetworkMatchResult` [network-policy-matcher.ts:NetworkPolicyMatcher]
- `redactSecrets` / `containsSecrets` / `redactValue` [secret-scanner.ts:redactSecrets]
- `evaluateRuntimeGate(input)` graph-node adapter returning `RuntimeGateDecision` [runtime-gate.ts:evaluateRuntimeGate]
- Barrel exports [index.ts:PolicyGate]

## Invariants
- Precedence is `deny > ask > allow` over ALL matching rules, not declaration order; the winner is the strictest match and the earliest among equals [rule-evaluator.ts:DECISION_RANK]
- No matching rule yields `deny` ("deny by default") [rule-evaluator.ts:RuleEvaluator]
- `validatePolicyRule` requires id, description, a valid decision, a defined `enabled`, and at least one match condition [policy-rule.ts:validatePolicyRule]
- `matchPolicy` returns false on an invalid `pathPattern` regex and on any mismatched field [policy-rule.ts:matchPolicy]
- `PolicyGate.evaluateToolCall` runs hard denies first: protected path, unscopable mutation channel, deny-command, then explicit tool deny [policy-gate.ts:PolicyGate]
- Protected paths match BOTH the resolved absolute form and the workspace-relative form; `/**` matches the directory itself or descendants, `.*` keeps exact-or-suffixed semantics [policy-gate.ts:isProtectedPath]
- Explicit capability deny precedes shell-whitelist and evasion approval branches; session mode never weakens a deny [policy-gate.ts:PolicyGate]
- A blanket capability `allow` does not widen past a declared owned write scope; the owned-path rule decides owned writes [policy-gate.ts:PolicyGate]
- Owned-path matching delegates to the shared `isWithinOwnedScope`; the gate has no matcher of its own [policy-gate.ts:PolicyGate]
- Unscopable mutation channels are denied before any permissive branch [policy-gate.ts:PolicyGate]
- A consumed coordination binding is denied (`consumed-binding-denied`), never re-asked [policy-gate.ts:PolicyGate]
- Losing an approval claim race is denied (`binding-claim-lost`), never surfaced as a new ask [policy-gate.ts:PolicyGate]
- Invalid approval expiry is corrupt authority and denied (`invalid-approval-expiry`), never treated as "no expiry" [policy-gate.ts:PolicyGate]
- Missing approval store fails closed with `approval-store-missing`, except headless auto-allow of `web.search`/`web.fetch`/`task.complete` (`headless-read-allow`) [policy-gate.ts:PolicyGate]
- Failed authoritative-store refresh in the coordination path denies with `approval-refresh-failed` [policy-gate.ts:PolicyGate]
- Exactly one emitter writes `approval.created`: the store when it has an EventLog, otherwise the gate (`storeEmitsCreationEvents`) [policy-gate.ts:PolicyGate]
- Pending capability asks reuse one pending approval; coordination asks reuse only by exact binding key [policy-gate.ts:PolicyGate]
- `PolicyRevision` is a SHA-256 over canonically key-sorted permission fields [policy-revision.ts:computePolicyRevision]
- Rule loading skips invalid/duplicate-id rules and invalid files rather than aborting, falling back to defaults when none load [policy-loader.ts:loadPolicyRules]
- Built-in rules allow low-risk reads and deny critical risk, with asks for medium/high [default-policies.ts:defaultPolicyRules]
- Shell whitelist checks the block list first, then the allow list [shell-whitelist.ts:ShellWhitelist]
- Network matching checks blocklist, then allowlist, then CIDR allowlist, then port restrictions, then `defaultAction` [network-policy-matcher.ts:NetworkPolicyMatcher]
- RuntimeGate applies capability coverage first and its policy decisions go through `ExecutionAuthorization`, not `PolicyGate` directly [runtime-gate.ts:evaluateRuntimeGate]
- RuntimeGate refuses invalid-expiry approvals and treats a genuinely expired approval as spent, falling through to a fresh request [runtime-gate.ts:evaluateRuntimeGate]

## Side Effects
- Appends `approval.created` / `approval.reused` events to the injected EventLog on ask paths [policy-gate.ts:PolicyGate]
- Creates, reuses, or consumes approvals through the injected `ApprovalStore`; `store.load()` refreshes from the authoritative ledger on the coordination path [policy-gate.ts:PolicyGate]
- Appends `runtime.blocked` / `policy.denied` / `policy.allowed` / `policy.asked` audit records from RuntimeGate (`append` errors swallowed) [runtime-gate.ts:evaluateRuntimeGate]
- Reads `.alix/policies/*.json` from disk and warns to stderr on invalid rules/files [policy-loader.ts:loadPolicyRules]
- `ApprovalManager` emits `approval.requested` / `approval.resolved` and blocks on a readline prompt when no `promptFn` is injected [approvals.ts:ApprovalManager]
- `ShellWhitelist` reads `process.env.ALIX_SHELL_WHITELIST` through `parseWhitelistEnv` when no configured commands exist [policy-gate.ts:PolicyGate]
- Pure helpers (`RuleEvaluator`, `matchPolicy`, `classifyCommand`, `redactSecrets`, `matchNetwork`, `computePolicyRevision`) perform no I/O [rule-evaluator.ts:RuleEvaluator]

## Verification
- Run: `pnpm test`
- Relevant tests: `tests/policy/policy-gate.test.ts`, `tests/policy/policy-rule.test.ts`, `tests/policy/rule-evaluator.test.ts`, `tests/policy/policy-loader.test.ts`, `tests/policy/runtime-gate.test.ts`, `tests/security/policy-protected-path-parity.vitest.ts`, `tests/security/approval-event-dedup.vitest.ts`
