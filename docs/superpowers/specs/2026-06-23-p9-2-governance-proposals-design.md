# P9.2 — GovernanceProposal Design Spec (SDS)

> **Status:** SDS — design phase. Not yet approved.
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-23-p9-2-governance-proposals.md`
> **Governs:** `feature/p9.2-governance-proposals` branch, off `main` at P9.1 squash.
> **Risk level:** HIGH — this is the first P9 slice that crosses from advisory into the proposal lifecycle. The governance boundary is: **recommendations may become proposals, but the proposal still requires human approval, and no part of the bridge may approve or apply itself.**

## Core framing

```text
P9.0 asks: What is the state of governance?
P9.1 asks: What should we do about it?
P9.2 asks: Let's propose those changes.

Recommendations advise.
Proposals require approval.
No recommendation may approve itself.
No proposal may apply itself.
```

P9.2 is the **advisory-to-proposal bridge**. It reads a `GovernanceRecommendation` produced by P9.1, applies an eligibility gate, and creates exactly one pending `Proposal` with action `governance_change`. The proposal enters the standard P5 lifecycle (`propose → approve → apply`) — P9.2 has no opinion on, and no involvement in, approval or application. Those are owned by existing P5 modules.

P9.2 explicitly does NOT:
- Approve proposals (lifecycle-owned by `ApprovalGate`)
- Apply proposals (lifecycle-owned by appliers)
- Implement any applier for `governance_change` (a future P-phase may; P9.2 stops at the proposal boundary)
- Auto-generate proposals without an explicit operator command
- Bulk-propose from multiple recommendations
- Re-propose after rejection (deferred to a future P9.x slice)

## Hard governance boundary (non-negotiable)

```text
Recommendations may become proposals.
Proposals still require approval.
No recommendation may approve itself.
No proposal may apply itself.
```

The four invariants, structurally enforced:

1. **Translation requires an explicit operator command** — `alix governance propose <recommendation-id>`. No auto-generation. No bulk. No scheduler.
2. **Eligibility gate** — only recommendations with `confidence >= 0.6` AND `priority !== "low"` may become proposals. The gate fails closed with a clear rejection message.
3. **Idempotency** — one recommendation produces at most one `governance_change` proposal. A second `alix governance propose <id>` on the same recommendation is refused, citing the existing proposal ID.
4. **No approval, no apply, no applier** — the P9.2 module is the *only* P9 file permitted to import `ProposalStore` or call `createProposal`, and even that file is forbidden from importing `ApprovalGate`, any applier, or calling `approve` / `apply` / `runApplier`. The sentinel enforces this with a per-file exception list.

## The 8 design questions

### 1. What does P9.2 consume?

| Source | What P9.2 reads | How |
|---|---|---|
| GovernanceStore | `GovernanceRecommendation` by ID | `store.getTypeForId(id)` → `store.list("recommendations")` |
| EvidenceChainStore | Existing `proposal_from_recommendation` edges for idempotency check | `chain.findEdges(target=recommendationId, type="proposal_from_recommendation")` |
| P5 ProposalStore | Write only: `createProposal(proposal)` | The single P9.2 file that may import ProposalStore |

P9.2 does NOT consume:
- `ApprovalGate` (forbidden in the P9.2 module)
- Any applier (forbidden)
- `ProposalExplanation` or `DashboardReport` (these are explanation surfaces, not bridge surfaces)
- `OutcomeStore`, `LearningStore`, `EvidenceChainStore.writeChain` (P9.2 is read-only on P8 stores except for the single proposal creation)

### 2. What artifact does P9.2 produce?

P9.2 produces **one artifact**: a standard P5 `Proposal` (already typed in `src/adaptation/adaptation-types.ts`) with:

```ts
{
  id: "prop-<timestamp>-<rand>",
  action: "governance_change",
  target: { kind: "governance", recommendationId: string },
  payload: GovernanceChangePayload,     // discriminated union, see Q6
  status: "pending",
  generatedAt: ISO-8601,
  generatedBy: "alix governance propose",
  confidence: number,                    // copied from source recommendation
  evidenceRefs: [
    recommendationId,                    // direct parent
    ...sourceArtifactIds                 // P9.0 artifacts (drift, lens, integrity, health)
  ],
  provenance: {
    parentRecommendationId: recommendationId,
    sourceArtifactIds: string[]
  }
}
```

And one EvidenceChainStore edge:
```ts
{
  source: proposalId,
  target: recommendationId,
  type: "proposal_from_recommendation",
  confidence: number,
  recordedAt: ISO-8601
}
```

P9.2 does NOT produce:
- A new artifact type (no `GovernanceProposal` — the existing `Proposal` carries it; the `action: "governance_change"` discriminator is sufficient)
- A new DecisionArtifact (the proposal is a Proposal, not a DecisionArtifact — the existing proposal type already has its own provenance model)
- Any state in GovernanceStore (P9.2 is a bridge, not a P9 analyzer)

### 3. How does the operator invoke the bridge?

```bash
alix governance propose <recommendation-id> [--json]
```

Flow:
1. Parse `recommendation-id` from args
2. Load `GovernanceRecommendation` from GovernanceStore
3. **Eligibility gate** (Q4): if `confidence < 0.6` OR `priority === "low"`, refuse with reason and exit non-zero
4. **Idempotency check** (Q5): if a `proposal_from_recommendation` edge already exists for this recommendation, refuse with the existing proposal ID and exit non-zero
5. **Translation** (Q6): build the `Proposal` from the recommendation using the category-specific payload variant
6. **Persist**: call `ProposalStore.createProposal(proposal)`
7. **Record provenance edge**: append a `proposal_from_recommendation` edge to EvidenceChainStore
8. **Render** (Q8): verbose human-readable output by default, `--json` for machine output

If any step 3, 4, 6, or 7 fails, the proposal is not created. The flow is atomic — either the proposal and its provenance edge both exist, or neither does.

### 4. What is the eligibility gate?

```ts
const MIN_PROPOSAL_CONFIDENCE = 0.6;
const INELIGIBLE_PRIORITIES = new Set<RecommendationPriority>(["low"]);

function isEligible(rec: Recommendation): { eligible: true } | { eligible: false; reason: string } {
  if (rec.confidence < MIN_PROPOSAL_CONFIDENCE) {
    return {
      eligible: false,
      reason: `confidence ${rec.confidence.toFixed(2)} is below threshold ${MIN_PROPOSAL_CONFIDENCE}`
    };
  }
  if (INELIGIBLE_PRIORITIES.has(rec.priority)) {
    return {
      eligible: false,
      reason: `priority "${rec.priority}" is not eligible for proposal`
    };
  }
  return { eligible: true };
}
```

Rejection output (text):
```text
Recommendation not eligible for proposal:
  confidence 0.42 is below threshold 0.60
```

Or:
```text
Recommendation not eligible for proposal:
  priority "low" is not eligible
```

Constants are module-scoped in `src/governance/governance-proposal-generator.ts`. Tunable in one place. No override flag. The threshold is part of the spec contract.

**Why these specific values:** `0.6` confidence is the same threshold P9.1's `IntegrityGenerator` uses to flag sub-60% rates as actionable (so any recommendation that survived P9.1's gate is at least at that level — but P9.1 emits low-confidence recs too, hence the gate). `priority !== "low"` mirrors the P9.1 advisory tone: low-priority items are observations, not actions.

### 5. How does idempotency work?

P9.2 queries the EvidenceChainStore before creating a proposal:

```ts
const existingEdge = await chain.findEdges({
  target: recommendationId,
  type: "proposal_from_recommendation"
});

if (existingEdge.length > 0) {
  const existingProposalId = existingEdge[0].source;
  return {
    ok: false,
    reason: `Recommendation ${recommendationId} has already been proposed as ${existingProposalId}`
  };
}
```

Re-proposal after rejection is NOT supported in P9.2. If a previous proposal was rejected, the recommendation must be re-generated (or the operator must manually update the recommendation status — but P9.2 does not provide a command for that). Deferred to a future P9.x slice.

### 6. What is the proposal payload shape?

A discriminated union over the 5 P9.1 categories. Each variant carries the operation-specific fields needed for a future applier (none of which is implemented in P9.2):

```ts
export type GovernanceChangePayload =
  | {
      kind: "lens_adjustment";
      operation: "promote" | "demote" | "retire";
      lens: string;
      currentPV: number;
      reviewsAnalyzed: number;
    }
  | {
      kind: "chain_restoration";
      targetArtifactId: string;
      currentRate: number;
      targetRate: number;
    }
  | {
      kind: "policy_coverage";
      currentCoverage: number;
      targetCoverage: number;
    }
  | {
      kind: "confidence_calibration";
      target: string;
      currentCalibration: number;
      suggestedCalibration: number;
    }
  | {
      kind: "governance_integrity";
      issue: string;
      recommendationId: string;
    };
```

The `lens_adjustment.operation` values match exactly the P9.0 `LensLifecycleReview.lensReviews[].recommendation` union (`"keep" | "promote" | "demote" | "retire"`), minus `"keep"` (which is not a change).

**Translation rules per category** (a pure function `recommendationToPayload(rec): GovernanceChangePayload`):

| Category | Translation |
|---|---|
| `lens_adjustment` | `operation` from rec's `title` parsing (or a new `Recommendation.operation` field added in P9.1a extension — see implementation note below); `lens` from rec's `sourceArtifactId`; `currentPV` and `reviewsAnalyzed` read from the source `LensLifecycleReview` artifact (read-only fetch from GovernanceStore) |
| `chain_restoration` | `targetArtifactId` from rec's `sourceArtifactId`; `currentRate` and `targetRate` read from the source `GovernanceIntegrityReport.metrics.provenanceRate` (read-only) |
| `policy_coverage` | `currentCoverage` from rec's `description` (parsed) or from the source `GovernanceHealthReport.policyCoverage`; `targetCoverage` set to a constant (e.g., 0.80) — see implementation note |
| `confidence_calibration` | `target` from rec's `sourceArtifactId` (the lens or store being recalibrated); `currentCalibration` and `suggestedCalibration` read from the source `LearningStore` calibration profile (read-only) |
| `governance_integrity` | `issue` from rec's `description`; `recommendationId` echoes the source recommendation id |

**Implementation note:** Some of these translations require reading additional state (the P9.0 source artifacts, the LearningStore calibration profiles). P9.2 has a `recommendationToPayload` helper that performs these reads. The reads are necessary but the writes are not — P9.2 reads from P8 stores and GovernanceStore but only writes to `ProposalStore` and `EvidenceChainStore` (the single permitted edge type). The sentinel will need a read-only exception for these sources.

### 7. What does the sentinel enforce?

The existing sentinel at `tests/governance/governance-sentinels.vitest.ts` is extended with a per-file exception list:

```ts
const FILE_EXCEPTIONS: Record<string, string[]> = {
  "src/governance/governance-proposal-generator.ts": [
    "ProposalStore",        // allowed: the one file that may create proposals
    "createGovernanceProposal",  // allowed
    "governance_change"     // allowed: this is the new ProposalAction value
  ]
  // All other P9 files keep the default deny.
};
```

The sentinel test logic:
1. For each file in `ALL_FILES`, check `FORBIDDEN_IMPORTS` against the file's import lines.
2. If the file has an entry in `FILE_EXCEPTIONS`, skip the corresponding symbols in that file's import check.
3. **Even for the exception file**, the following remain forbidden: `ApprovalGate`, `approve(`, `apply(`, `applier`, `runApplier(`, any applier class.
4. All other checks (write calls, P8 store paths in `governance-store.ts`, etc.) remain unchanged.

The exception file is `src/governance/governance-proposal-generator.ts` only. The CLI dispatcher `src/cli/commands/governance.ts` (which invokes the generator) does NOT get the exception — it must call the generator through a function, not by directly constructing proposals.

### 8. What does the operator see?

Verbose human-readable summary by default, `--json` for machine output:

**Text (default):**
```text
Governance proposal created.
  Proposal:        prop-2026-06-23-001
  Recommendation:  rec-drift-007
  Action:          governance_change (chain_restoration)
  Source:          drift-2026-06-23-002

Review and approve:
  alix governance explain prop-2026-06-23-001
  alix adaptation approve prop-2026-06-23-001
```

**Rejection (text):**
```text
Recommendation not eligible for proposal:
  confidence 0.42 is below threshold 0.60
```

Or:
```text
Recommendation rec-drift-007 has already been proposed as prop-2026-06-23-001.
```

Or:
```text
Recommendation not found: rec-xyz
```

**Machine (--json):**
```json
{
  "ok": true,
  "proposalId": "prop-2026-06-23-001",
  "recommendationId": "rec-drift-007",
  "action": "governance_change",
  "payloadKind": "chain_restoration"
}
```

For rejections, `--json` outputs `{"ok": false, "reason": "..."}` and the process exits with a non-zero status.

## CLI examples

```bash
# Propose from a P9.1 recommendation
alix governance propose rec-drift-007
→ Governance proposal created.  (verbose summary, exit 0)

# Rejection: low confidence
alix governance propose rec-low-conf
→ Recommendation not eligible for proposal:
    confidence 0.42 is below threshold 0.60
  (exit 1)

# Rejection: already proposed
alix governance propose rec-drift-007
→ Recommendation rec-drift-007 has already been proposed as prop-2026-06-23-001.
  (exit 1)

# Machine output
alix governance propose rec-drift-007 --json
→ {"ok": true, "proposalId": "prop-2026-06-23-001", ...}
```

## Data model summary

```ts
// Already exists (P5) — no changes to adaptation-types.ts
interface Proposal {
  id: string;
  action: ProposalAction;     // extended with "governance_change"
  target: ProposalTarget;     // extended with { kind: "governance", recommendationId }
  payload: unknown;           // GovernanceChangePayload at runtime, kept loose in P5 type
  status: "pending" | "approved" | "applied" | "rejected";
  generatedAt: string;
  generatedBy: string;
  confidence: number;
  evidenceRefs: string[];
  provenance?: Record<string, unknown>;
}

// New in P9.2
type GovernanceChangePayload =
  | { kind: "lens_adjustment"; operation: "promote" | "demote" | "retire"; lens: string; currentPV: number; reviewsAnalyzed: number; }
  | { kind: "chain_restoration"; targetArtifactId: string; currentRate: number; targetRate: number; }
  | { kind: "policy_coverage"; currentCoverage: number; targetCoverage: number; }
  | { kind: "confidence_calibration"; target: string; currentCalibration: number; suggestedCalibration: number; }
  | { kind: "governance_integrity"; issue: string; recommendationId: string; };

// New edge type for EvidenceChainStore
type EdgeType = "..." | "proposal_from_recommendation";
```

**Protected type files (additive extension allowed):** The 6 protected type files are **structurally protected**, not byte-identical. P9.2 is approved to add two new members to unions in `adaptation-types.ts`:

```ts
// In src/adaptation/adaptation-types.ts
type ProposalAction = ... | "governance_change";   // additive only
type ProposalTarget = ... | { kind: "governance"; recommendationId: string };  // additive only
```

The protection rule is now:

```text
Protected means no breaking mutation.
Protected does not mean no approved additive evolution.

Existing union members must remain unchanged (same name, same shape).
Additive new members (new union values, new variants) are allowed only
when an approved SDS + plan explicitly calls for them, and only with a
matching sentinel assertion that the existing members are unchanged.
```

The 5 other protected files (`governance-review-types.ts`, `risk-score-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`) remain byte-identical to main. P9.2 only touches `adaptation-types.ts` and only in the additive sense above.

The sentinel for P9.2 must assert:
- All existing `ProposalAction` members unchanged
- All existing `ProposalTarget` variants unchanged
- Only additive members added: `"governance_change"` and `{ kind: "governance"; recommendationId: string }`

## New files

```text
src/governance/governance-proposal-generator.ts        # The single bridge module
src/cli/commands/governance.ts                         # + "propose" subcommand (modify)
tests/governance/governance-proposal-generator.vitest.ts
tests/cli/commands/governance-integration.vitest.ts    # + "propose" tests (modify)
tests/governance/governance-sentinels.vitest.ts         # + FILE_EXCEPTIONS (modify)
```

## Integration with the existing lifecycle

P9.2 is a **single-direction bridge** from P9.1's advisory space to P5's proposal space:

```text
P9.1 GovernanceRecommendation
  ↓ alix governance propose <id>
P9.2 governance-proposal-generator
  ↓ createProposal (atomic)
P5 ProposalStore (status: pending)
  ↓ operator runs alix adaptation approve
P5 ApprovalGate (status: approved)
  ↓ operator runs alix adaptation apply
P5 applier (status: applied)
  ↓
  [no P9.2 involvement]
```

P9.2 is **never** invoked by P5. P5 is **never** invoked by P9.2 except for the single `createProposal` call. The bridge is one-way: P9.2 → P5, never the reverse. A future Explain-path integration (`alix explain proposal <id>`) already exists and will naturally show the proposal's `parentRecommendationId` and `sourceArtifactIds` once the proposal is created — no P9.2 work needed there.

## What prevents P9.2 from becoming auto-mutating?

1. **Trigger is explicit** — `alix governance propose <id>` is a one-shot operator command. No scheduler, no auto-run, no `await` in any P9.0/P9.1 path.
2. **Eligibility gate fails closed** — weak recommendations cannot become proposals.
3. **Idempotency enforced** — duplicates are blocked at the EvidenceChainStore level, not at the P9.2 module level. A misbehaving P9.2 cannot create two proposals for the same recommendation.
4. **No approval, no apply, no applier** — even the exception file is forbidden from importing ApprovalGate, appliers, or calling approve/apply. The sentinel enforces this.
5. **One-way bridge** — P9.2 → P5. P5 does not call back into P9.2. The bridge surface is `createProposal` and one EvidenceChain edge; nothing else.

## Out of scope (deferred)

| Feature | Why deferred |
|---|---|
| Auto-generation from `alix governance recommend` | Violates "recommendations advise" — operator must choose |
| Bulk propose from multiple recommendations | Larger blast radius; one-shot is enough for v1 |
| Re-proposal after rejection | Add a `recommendation.status` state machine first; needs P9.1 amendment |
| Approve / apply / applier for `governance_change` | P9.2 stops at the proposal boundary. A future P9.x slice may add a GovernanceChangeApplier, but only after this slice proves the bridge is safe |
| Category-specific eligibility gates | P9.1's 5 categories have different signal-to-noise ratios; refine after empirical data |
| `Recommendation.operation` field | Some translations currently parse `title`; cleaner to add an explicit field, but requires P9.1 amendment |
| Status update of `Recommendation` post-proposal | Once a proposal is created, should the recommendation be marked `status: "acknowledged"`? Currently no — `status` is for operator triage, not for proposal lifecycle tracking |

## Acceptance criteria

### Functional

```text
Given a P9.1 recommendation with confidence 0.85 and priority "high":

alix governance propose rec-drift-007
→ Creates exactly one pending governance_change proposal
→ Records a proposal_from_recommendation edge in EvidenceChainStore
→ Returns the new proposal ID
→ Operator can then: alix adaptation approve prop-XXX → alix adaptation apply prop-XXX
```

### Eligibility gate

```text
alix governance propose rec-low-confidence
→ Refuses: "confidence 0.42 is below threshold 0.60"
→ Exit 1, no proposal created, no edge recorded

alix governance propose rec-low-priority
→ Refuses: 'priority "low" is not eligible'
→ Exit 1, no proposal created
```

### Idempotency

```text
alix governance propose rec-drift-007
→ Creates prop-A

alix governance propose rec-drift-007
→ Refuses: "Recommendation rec-drift-007 has already been proposed as prop-A."
→ Exit 1, no second proposal created
```

### Read-only invariant (P9.2 file scope)

```text
src/governance/governance-proposal-generator.ts may import:
  - GovernanceStore
  - EvidenceChainStore (read + write the new edge type only)
  - ProposalStore (the single permitted P5 mutation)
  - All P9.2 helper modules

src/governance/governance-proposal-generator.ts may NOT import:
  - ApprovalGate
  - AgentCardApplier, SkillApplier, RevertApplier
  - AutomaticProposalGenerator
  - Any module that calls approve(, apply(, runApplier(
```

### No-P9.2-mutation invariant (other P9 files)

```text
All other P9 files (P9.0 builders, P9.1 generator, P9.1 CLI) keep their existing bans:
  - No ProposalStore
  - No createGovernanceProposal
  - No governance_change in any source code
  - All existing FORBIDDEN_IMPORTS / FORBIDDEN_WRITE_CALLS remain
```

## What this depends on from earlier phases

| Phase | How P9.2 uses it |
|---|---|
| P5 | `ProposalStore.createProposal` — the single P5 mutation surface P9.2 uses |
| P8.5a.0 (Evidence Chain) | Reads `proposal_from_recommendation` edges for idempotency; writes one new edge per proposal |
| P9.0a (Meta-Governance) | Reads `GovernanceHealthReport`, `GovernanceDriftReport`, `LensLifecycleReview`, `GovernanceIntegrityReport` from GovernanceStore for payload translation |
| P9.1 (GovernanceRecommendation) | Reads `GovernanceRecommendation` by ID; consumes `Recommendation.priority`, `confidence`, `category`, `title`, `description`, `sourceArtifactId` |

P9.2 does NOT depend on:
- P5 approval flow (proposals are created in `pending` state; approval is operator-initiated via existing P5 commands)
- P5 apply flow (no applier implementation in P9.2)
- P8.5a.2 learning adapters (P9.2 reads from `LearningStore.queryProfiles` directly when translating `confidence_calibration` payloads)

The dependency chain is: **P9.2 reads P9.0 + P9.1, P9.2 writes one proposal + one edge, P5 owns approval/apply.** No circular dependencies, no modifications to P9.0/P9.1 code, no new coupling beyond the single `createProposal` call.
