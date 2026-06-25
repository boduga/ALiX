# P10.4b — Executive Proposal Bridge (Design)

> **Status:** Design spec — awaiting user review before implementation plan is written.
> **Spec home (on approval):** this file.
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-25-p10-4b-execution-proposal-bridge.md`
> **Governs:** `feature/p10-4b-execution-proposal-bridge` branch, off `main` at HEAD.
> **Risk level:** LOW — single additive module, no mutation path, additive union members under ADR-0004.

## Hard governance boundary (non-negotiable)

```
P10.4b may create pending proposals.
P10.4b may not approve proposals.
P10.4b may not apply proposals.
P10.4b may not reject proposals.
```

P10.4b is the **proposal-creation bridge** between executive orchestration and the existing P5/P9 mutation lifecycle. The executive surfaces intent; the human completes the proposal (action, target, payload), then approves and applies via the existing `alix adaptation` lifecycle. The bridge produces nothing that auto-mutates.

```
P10.4a = executive orchestrator (records intent, never mutates)
P10.4b = executive proposal bridge (this spec — creates pending proposals only)
P10.4c = executive apply bridge (future — closes the loop from approval to execution)
```

---

## Why this exists

P10.4a orchestrates the 12 executive step actions and classifies them via the 3-class `StepBehavior` taxonomy:

- **6 read-only** — execute directly, mark completed.
- **3 investigation** — `triage_investigations`, `assign_investigation_ownership`, `resolve_investigations` — bridge target is `InvestigationStore` (future P10.4c or separate investigation-bridge slice).
- **3 mutation** — `create_remediation_proposal`, `apply_remediation`, `implement_improvements` — bridge target is `AdaptationProposal`.

In P10.4a, all non-read-only steps land in `StepRuntimeStatus = "waiting_for_bridge"`. The bridge is what closes that loop.

This spec (P10.4b) bridges **one** mutation step kind only: `create_remediation_proposal`. The other two mutation actions (`apply_remediation`, `implement_improvements`) remain `waiting_for_bridge` until P10.4c.

### Why only one mutation step kind?

Reading the P10.3 step templates literally:

- `create_remediation_proposal` is **the proposal-creation step itself**. The action verb *is* the bridge. Bridging this step to a real `AdaptationProposal` is the only semantically honest move.
- `apply_remediation` and `implement_improvements` are **apply-side steps** that conceptually depend on a proposal already existing. Bridging them in P10.4b would mean inventing a proposal that doesn't conceptually exist yet — exactly the trap the design avoids.

Each `create_remediation_proposal` step in a plan → exactly one pending proposal in `proposals.jsonl`. No proposal explosion.

---

## The 5 design questions

### 1. Which step action does the bridge cover?

`create_remediation_proposal`. One kind. The other two mutation actions stay `waiting_for_bridge` until P10.4c. The 3 investigation actions stay `waiting_for_bridge` until a separate investigation-bridge slice.

### 2. What is the new `ProposalAction`?

A narrow additive union member:

```ts
| "executive_remediation_request"
```

This is **Allowed** under ADR-0004 (additive union member on a protected type file). The decision to add a new member rather than misuse `governance_change` or `learning_adjustment` follows the principle: each `ProposalAction` value should carry a distinct semantic. An executive remediation request is not a governance change and not a learning adjustment — it's an executive orchestration handoff that requires human specification.

### 3. What is the new `ProposalTarget.kind`?

A narrow additive union member with the executive context inline:

```ts
| { kind: "executive_remediation"; planId: string; stepId: string; objectiveId: string; subsystem: ExecutiveSubsystemName }
```

Carrying `planId`/`stepId`/`objectiveId`/`subsystem` in the target (not just in `payload`) means downstream tools can filter by origin without parsing the payload. This is the same pattern as `{ kind: "governance", recommendationId }`.

### 4. What is the proposal payload?

No fake typed fields. The payload explicitly states that human specification is required:

```ts
payload: {
  source: "executive_bridge",
  bridgeVersion: EXECUTIVE_BRIDGE_VERSION,
  planId: string,
  stepId: string,
  objectiveId: string,
  subsystem: ExecutiveSubsystemName,
  riskLevel: "low" | "medium" | "high",
  requiresHumanSpecification: true,
  requestedFields: ["action", "target", "payload"],
}
```

- `source: "executive_bridge"` — discriminator for any future cross-store query.
- `bridgeVersion` — currently `"1.0"`, allows future bridge behavior changes to be detected.
- `riskLevel` is the only *engineered* signal — copied from the originating step.
- `requiresHumanSpecification: true` — explicit signal to the human-facing surface that this proposal is incomplete and needs their input.
- `requestedFields` — enumerated list of the three payload fields the human must fill. No ambiguity.

The proposal is **honestly incomplete**: it has `action: "executive_remediation_request"` and a `target` that captures executive origin, but the substantive `payload` (what the action actually does) is empty. The human fills `action`, `target`, and `payload` via the existing `alix adaptation` lifecycle.

### 5. What `provenance` does the bridged proposal carry?

`provenance: "manual"`.

The `provenance` field is a closed union (`"auto" | "manual"`) on a protected type file. Adding `"executive"` is **Forbidden** under ADR-0004 without a new ADR, and is unnecessary: `provenance: "auto"` means "eligible for automatic approval" — the executive bridge is explicitly **not** auto-eligible, because it produces incomplete proposals awaiting human specification.

`manual` is the correct semantic for executive-bridged proposals: requires human review, requires human completion, requires explicit approval. The executive origin lives in `payload.source = "executive_bridge"` for any consumer that needs to distinguish.

---

## Architecture and data flow

```
1. PlanningEngine.buildExecutionPlan()  (P10.3, unchanged)
   ↓ produces plan with step { action: "create_remediation_proposal", ... }

2. PlanStore.save(plan)  (P10.4a, unchanged)
   ↓ persists plan immutably

3. PlanApprovalGate.approve(planId, by, ref)  (P10.4a, unchanged)
   ↓ plan.status = "approved"

4. ExecutionEngine.runReadySteps(planId)  (P10.4a, NEW BRANCH — owner of all bridge writes)
   ↓ iterates ready steps
   ↓ for step.action === "create_remediation_proposal":
   ↓   if step.generatedArtifacts contains { type: "proposal", id } → skip silently (idempotency)
   ↓   else:
   ↓     result = await bridgeCreateRemediationProposal(plan, step, now, append)
   ↓     stepState.generatedArtifacts.push(result.artifactRef)
   ↓     evidenceWriter.append("executive_step_bridged_to_proposal", payload)
   ↓   stepState.status stays "waiting_for_bridge"  (no transition)

5. CLI: alix executive plan show <planId>
   ↓ renders step with derived view: bridge_pending | proposal_created

6. Human: alix adaptation list --status pending
   ↓ sees the new proposal with action="executive_remediation_request"
   ↓ human inspects payload.requiresHumanSpecification === true
   ↓ human completes action/target/payload
   ↓ existing alix adaptation approve / apply  (unchanged)
```

### Step 4 in detail — the only P10.4b write surface

All bridge state mutation lives in `ExecutionEngine.runReadySteps()`. `StepRunner` is unchanged. Concretely:

```ts
// In ExecutionEngine, where create_remediation_proposal steps are dispatched:
if (step.action === "create_remediation_proposal") {
  // Idempotency: caller checks generatedArtifacts first
  const existing = stepState.generatedArtifacts.find(a => a.type === "proposal");
  if (existing) {
    return;  // already bridged; silent no-op
  }

  try {
    const result = await bridgeCreateRemediationProposal(
      plan, step, nowIso, (proposal) => proposalStore.save(proposal),
    );
    stepState.generatedArtifacts.push(result.artifactRef);
    await evidenceWriter.append({
      type: "executive_step_bridged_to_proposal",
      payload: { planId, stepId, proposalId: result.proposal.id, bridgeVersion: EXECUTIVE_BRIDGE_VERSION },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    stepState.warnings.push(`bridge failed: ${msg}`);
    await evidenceWriter.append({
      type: "executive_step_bridge_failed",
      payload: { planId, stepId, error: msg },
    });
    // status stays "waiting_for_bridge" — engine will retry on next runReadySteps
  }
}
```

### Why ExecutionEngine owns the write, not StepRunner

`StepRunner` is a classifier + executor. It produces `StepRunnerResult` (a pure value). `ExecutionEngine` owns `StepRuntimeState` and is the only place that mutates it. The bridge write is a `StepRuntimeState` mutation (appending `generatedArtifacts[]` and possibly `warnings[]`), so the engine — not the runner — owns it.

This also keeps `StepRunner` testable in isolation and matches the existing P10.4a separation of concerns.

### Idempotency contract

The bridge has no built-in idempotency. The caller (`ExecutionEngine`) checks `stepState.generatedArtifacts` for an existing `{ type: "proposal", id }` ref. If present, return silently — no proposal, no evidence.

Why caller-driven, not bridge-internal:
- The artifact ref is durable state; the bridge shouldn't reach back into the runtime state to read it.
- Keeping the bridge pure means the pure builder (`buildExecutiveRemediationProposal`) is testable in complete isolation.

### Failure handling

| Failure | Behavior |
|---|---|
| `ProposalStore.save()` throws | step status stays `waiting_for_bridge`; no artifact appended; bridge evidence `executive_step_bridge_failed` recorded; warning appended to `StepRuntimeState.warnings[]`; the step remains runnable on next `runReadySteps` invocation |
| Plan not found / step not found | bridge throws before reaching `append`; ExecutionEngine surfaces the error; no partial state |
| Already-bridged step (idempotency check) | silent no-op, return existing ref, no new proposal, no new evidence |

The warning-on-failure approach (rather than a permanent `failed` status) gives the operator visible failure context without adding a new `StepRuntimeStatus` value. The audit trail (`executive_step_bridge_failed` evidence) is the durable record.

---

## Evidence contract

Two new evidence event types, all under the existing `EvidenceEventWriter`:

| Event type | When recorded | Payload |
|---|---|---|
| `executive_step_bridged_to_proposal` | Successful bridge, first creation only | `{ planId, stepId, proposalId, bridgeVersion }` |
| `executive_step_bridge_failed` | `ProposalStore.save()` throws | `{ planId, stepId, error }` |

Note: `executive_step_bridge_skipped_duplicate` was considered for the idempotent path but rejected — repeated `runReadySteps()` calls would spam audit logs. Duplicate encounter is silent (no evidence).

The third event, `executive_step_bridge_purged`, is **deferred to P10.4c**. It is conceptually the "this bridged proposal was applied" event, but P10.4b has no apply path. Listing it here would be reserving semantics for a future phase that hasn't designed its own contract yet — defer it.

---

## Files added

```
src/executive/executive-bridge.ts                              (~120 LOC, pure + effectful wrapper)
tests/executive/executive-bridge.vitest.ts                     (~25 tests, 6 describes)
tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts    (3 tests, additive sentinel)
```

## Files modified

```
src/adaptation/adaptation-types.ts                             (+2: ProposalAction variant + ProposalTarget variant; ADR-0004 Allowed)
src/executive/execution-engine.ts                              (+~30 LOC: idempotency check, bridge call, artifact append, evidence)
tests/executive/executive-sentinels.vitest.ts                  (+1: add executive-bridge.ts to allowlist)
```

**Files NOT modified:**

- `src/executive/step-runner.ts` — unchanged. Engine owns the bridge write.
- `src/executive/executive-plan-types.ts` — unchanged. No new `StepRuntimeStatus`. Derived readiness is a CLI view.

---

## Testing strategy

### Unit tests for the pure builder (15 tests)

```
describe("buildExecutiveRemediationProposal (pure)", () => {
  describe("preconditions")
    it("throws when step.action is not create_remediation_proposal")
    it("throws when step.objectiveId is missing")
    it("throws when step.targetSubsystem is not a valid ExecutiveSubsystemName")

  describe("output shape")
    it("emits status='pending'")
    it("emits action='executive_remediation_request'")
    it("emits target.kind='executive_remediation' with planId/stepId/objectiveId/subsystem")
    it("emits provenance='manual'")
    it("emits id='' (ProposalStore assigns canonical ID on save)")
    it("emits createdAt from the supplied now argument")
    it("emits payload.source='executive_bridge'")
    it("emits payload.bridgeVersion=EXECUTIVE_BRIDGE_VERSION")
    it("emits payload.requiresHumanSpecification=true")
    it("emits payload.requestedFields=['action','target','payload']")
    it("emits payload.riskLevel from the step")
    it("emits reason citing planId and stepId")
    it("emits evidenceFingerprints=[]")
    it("emits sourceConfidence=0 (bridge does not compute confidence)")
})
```

### Unit tests for the effectful wrapper (5 tests)

```
describe("bridgeCreateRemediationProposal (effectful)", () => {
  it("calls append() exactly once with the built proposal")
  it("returns ExecutiveBridgeResult with proposal.id === saved.id from append()")
  it("returns artifactRef { type: 'proposal', id: <captured> }")
  it("propagates errors thrown by append()")
  it("does NOT mutate any global state — caller drives StepRuntimeState")
})
```

### Purity invariant tests (4 tests)

```
describe("P10.4b purity invariants", () => {
  it("executive-bridge.ts does not import ProposalStore directly")
  it("executive-bridge.ts does not import ApprovalGate")
  it("executive-bridge.ts does not import any applier")
  it("executive-bridge.ts only depends on types from adaptation-types.ts")
})
```

### Snapshot sentinel tests (3 tests)

```
describe("P10.4b — adaptation-types.ts additive invariant", () => {
  it("ProposalAction includes 'executive_remediation_request'")
  it("ProposalTarget includes 'executive_remediation' kind")
  it("executive-bridge.ts is in the executive directory allowlist")
})
```

The sentinel uses source-text greps (`fs.readFileSync` + `expect().toContain`), matching the pattern in `tests/adaptation/outcome-sentinels.vitest.ts`. The snapshot-equal pattern with `protected-baselines.ts` referenced in ADR-0004 is a future evolution, not a current requirement.

---

## Explicitly out of scope

| Feature | Belongs to |
|---|---|
| Approve / apply / reject bridged proposals | Existing P5/P9 lifecycle, unchanged |
| Bridging `apply_remediation` step kind | P10.4c — apply-side bridge |
| Bridging `implement_improvements` step kind | P10.4c — apply-side bridge |
| Bridging the 3 investigation step kinds | P10.4c or a separate investigation-bridge slice |
| Auto-filling the proposal's `payload` based on the originating step's `riskLevel`/`objectiveScore` | Future — requires domain-specific synthesis logic; not safe without explicit human review of what action/target to take |
| A new `StepRuntimeStatus = "bridge_ready"` value | Not needed; derived readiness is a CLI-only view (the artifact ref's presence is the source of truth) |
| Sentinel-extracted constants for `ProposalAction` / `ProposalTarget` union members | Future evolution of the sentinel pattern; today uses source-text greps |
| `executive_step_bridge_purged` evidence type | P10.4c — define when apply-side bridge ships |

---

## Risk assessment

- **Spec compliance risk:** LOW — locked decisions with explicit quotes from user; no open questions.
- **Implementation risk:** LOW — additive module, no existing code paths changed except the engine's dispatch for one step kind.
- **Test risk:** LOW — pure function + injected callback = trivial mocking; existing CLI test pattern is reused.
- **Type-safety risk:** LOW — `adaptation-types.ts` changes are additive only; new union members are caught by snapshot sentinel.
- **Migration risk:** NONE — no existing plans are affected; no existing proposals are migrated.
- **Future risk:** P10.4c must consume the bridged proposal's `action="executive_remediation_request"` and `payload.requiresHumanSpecification=true`. The contract is documented here so P10.4c can be designed against it.

---

## End-to-end verification (manual)

```
alix executive plan save 7
alix executive plan approve <planId>
alix executive plan run <planId>
# → status shows "waiting_for_bridge / proposal_created" for the bridged step
# → proposals.jsonl contains a new pending proposal with action=executive_remediation_request
alix adaptation list --status pending
# → the executive proposal appears; payload.source === "executive_bridge"
# → payload.requiresHumanSpecification === true
# → payload.requestedFields === ["action", "target", "payload"]
alix executive plan run <planId>     # re-run
# → silent no-op (idempotency); no duplicate proposal; no duplicate evidence
```

---

## ADR-0004 compliance check

This spec adds two union members to a protected type file (`adaptation-types.ts`):

- `ProposalAction` ← `"executive_remediation_request"` (additive)
- `ProposalTarget` ← `{ kind: "executive_remediation", planId, stepId, objectiveId, subsystem }` (additive)

Under ADR-0004's three-class mutation taxonomy:

- **Allowed:** additive union members, new optional interface properties, new exported symbols. ✓
- **Forbidden:** rename, delete, change, optional → required, change discriminator value. ✓ none of these.
- **Requires new ADR:** breaking shape evolution, contract migration. ✓ none.

SDS present (this document). Plan will be written before implementation. The protected-type sentinel in `tests/adaptation/adaptation-types-p10-4b-snapshot.vitest.ts` asserts both documented additions are present.