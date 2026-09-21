# J0 Integration Points — Existing Classifier / Routing / Governance Seams

J0 task 39. Read-only map: where the decision subsystem will attach in
later slices. No runtime wiring in J0; PolicyGate and createProvider are
untouched (both CRITICAL blast radius — see J0a inventory).

## Deterministic governance (authoritative; Jev may escalate, never waive)

| Seam | Location | Role for decisions |
|------|----------|--------------------|
| PolicyGate | `src/policy/policy-gate.ts:171` | Single policy authority; approval lifecycle; JEV-8 floor |
| Approval composition shape | `src/decision/approval.ts` | `composeApproval(policy, risk)` — policy wins |
| CommandClassifier | `src/policy/command-classifier.ts:24` | Existing regex risk tiers; not a Jev input |
| Secret patterns | `src/policy/secret-scanner.ts:37` | Single source reused by boundary via stateless compare |
| Policy revision | `src/policy/policy-revision.ts:36` | Version stamp carried in journal `policyVersion` |

## Model routing (canonical config stays the single source of truth)

| Seam | Location | Role for decisions |
|------|----------|--------------------|
| createProvider | `src/providers/registry.ts:70` | Choke point; Jev never calls it with model IDs (JEV-10) |
| buildRoutingAdapter | `src/providers/routing-adapter.ts:41` | Existing-routing fallback for model-tier (J3) |
| resolveModelSelectionId | `src/providers/model-resolver.ts:284` | Discovery seam; tiers resolve here, not in Jev |
| resolveModelConfig | `src/config/model-resolver.ts:50` | Canonical `models[tier] ?? models.default` reader |
| Decision config | `AlixConfig.decision` (`src/config/schema.ts`) | Wired J0-fix; defaults local-first, Jev disabled |

## Runtime state (project, never ship raw)

| Seam | Location | Role for decisions |
|------|----------|--------------------|
| ExecutionState contract | `src/runtime/execution-state/` | 11-key shape the boundary rejects (JEV-2) |
| Projector pattern | `src/runtime/execution-state/execution-state-projector.ts` | Deterministic EVENT→STATE reducer; per-decision projectors mirror it |
| EventLog / audit | `src/audit/`, `src/runtime/runtime-index.ts` | Journal precedent (JSONL append-only) |

## Name-collision warning

`src/cli/commands/decision/` is the governance-lens CLI (review/queue/outcome).
Unrelated to `src/decision/`. Never merge them.
