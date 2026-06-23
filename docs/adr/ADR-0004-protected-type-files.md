# ADR-0004 — Protected Type Files (Additive Extension Rule)

> **Status:** Accepted.
> **Date:** 2026-06-23.
> **Deciders:** ALiX core architecture.
> **Context:** P9.2 SDS, decision on how P9.2 may extend the existing proposal vocabulary.

## Context

Since P5, the ALiX codebase has maintained a set of **6 protected type files** that subsequent P-phases are forbidden from modifying:

```text
src/adaptation/risk-score-types.ts
src/adaptation/governance-review-types.ts
src/adaptation/adaptation-types.ts
src/adaptation/decision-types.ts
src/adaptation/learning-types.ts
src/adaptation/outcome-types.ts
```

The invariant was framed as "byte-identical to main" in per-phase plans (P8.5a, P8.5b, P8.5c, P9.0a, P9.1). The intent: prevent later phases from quietly reshaping the P5 proposal/governance contracts that earlier phases and external consumers depend on.

P9.2 needs to add two new members to unions in `adaptation-types.ts`:

```ts
type ProposalAction = ... | "governance_change";   // new value
type ProposalTarget = ... | { kind: "governance"; recommendationId: string };  // new variant
```

Under a strict "byte-identical" reading, this is forbidden. Under a more permissive "structurally protected" reading, this is fine because:

- No existing `ProposalAction` member is changed (no member renamed, reordered, or retyped)
- No existing `ProposalTarget` variant is changed
- The new members are purely additive
- TypeScript treats additive union members as non-breaking for all consumers
- The change is explicit, intentional, and called out in the approved SDS

The strict reading would force P9.2 to either:
- Hide a real governance proposal behind the wrong action (e.g., reuse `adjust_skill_definition`)
- Add module-augmentation indirection (a new file that augments `adaptation-types.ts` via `declare module`)
- Add a process-level exception mechanism (per-phase sentinel allowlist)

All three are workable but conceptually muddier. The third would be useful for future phases regardless.

## Decision

The protected-type invariant is restated as:

```text
Protected means no breaking mutation.
Protected does not mean no approved additive evolution.
```

### Mutation classes (testable)

The 6 protected files are governed by three explicit mutation classes. Every change must be classifiable into one of these.

**Allowed (with SDS + plan + sentinel):**

- New union members (e.g., adding `"governance_change"` to `ProposalAction`)
- New interface properties marked optional (e.g., `proposedFromRecommendationId?: string`)
- New exported symbols (functions, types, interfaces, constants) that do not shadow existing ones
- New discriminated-union variants (e.g., adding `{ kind: "governance"; ... }` to `ProposalTarget`)

**Forbidden (no SDS, no plan, no exception — period):**

- Renaming any existing member
- Deleting any existing member
- Changing any existing member's type
- Making an optional field required
- Changing a discriminator value
- Reordering members in a way that changes ordinal semantics (TypeScript itself does not rely on union order, but downstream consumers may)

**Requires a new ADR (out of scope for any single-phase SDS):**

- Breaking shape evolution (any change in the Forbidden list)
- Migration of existing contracts (renaming with compatibility shims, dual-write, etc.)
- Removal of deprecated members (deprecation → removal is a multi-phase process)

### Approval process for Allowed mutations

Additive new members are allowed only when:

1. An approved SDS explicitly calls for the extension (and names the new members).
2. The implementation plan explicitly enumerates the new members in its Global Constraints section.
3. A sentinel assertion in the per-phase test suite verifies the change is classifiable as Allowed (no Forbidden mutations occurred).

Under this rule, P9.2 is permitted to add `"governance_change"` to `ProposalAction` and `{ kind: "governance"; recommendationId: string }` to `ProposalTarget`, because:

- The P9.2 SDS explicitly enumerates both members (see "Data model summary" section of `docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md`).
- The P9.2 implementation plan will enumerate them again in the Global Constraints section.
- The P9.2 sentinel will assert that all pre-existing union members and variants are unchanged and that the only additive members are the two documented ones.

The 5 other protected files (`governance-review-types.ts`, `risk-score-types.ts`, `decision-types.ts`, `learning-types.ts`, `outcome-types.ts`) remain fully byte-identical to main. P9.2 touches only `adaptation-types.ts`, only with the two documented additive members.

## Consequences

### Positive

- The P5 proposal vocabulary can evolve explicitly when an approved phase calls for it, without forcing indirection.
- The protection rule is now semantically clear: existing shapes are frozen, new shapes are allowed only via an approved process.
- Future P-phases have a precedent: if P9.3 or P10 needs to add a new `ProposalAction` value, the rule above applies and the SDS + plan + sentinel must enumerate it.
- TypeScript's own design treats unions this way (see `@types/*` packages, which add new members to `React.HTMLAttributes` etc. without breaking consumers). The ALiX invariant now matches TypeScript's mental model.
- **The three-class mutation taxonomy (Allowed / Forbidden / Requires-new-ADR) is testable.** A future reviewer can classify any change against the taxonomy without appealing to precedent. This is the difference between a rule and a guideline.
- **The snapshot-and-exact-equal sentinel pattern catches accidental removals at compile-test time**, not at human-review time. The cost of a mistake is a CI failure, not a post-merge rollback.

### Scope: foundational, not P9-only

This ADR is broader than P9. It establishes the pattern for every future P-phase that needs to evolve a protected contract:

- P9 governance actions (the immediate P9.2 use case)
- P10 policy actions
- P11 orchestration actions
- Future agent lifecycle actions
- Future workflow lifecycle actions

The previous "byte-identical forever" rule forced every new action type to become an architectural argument: should we abuse an existing type, hide behind payload indirection, use module augmentation, or carve out an exception? Each option is a one-off decision with no process backbone. Under this ADR, the process is already defined:

```text
Need a new contract?
  1. Write SDS (names the new members)
  2. Write Plan (restates them in Global Constraints)
  3. Add Sentinel (snapshot + exact-equal assertion)
  4. Additive only (no Forbidden mutations)
```

The mutation taxonomy and the sentinel pattern are reusable across all future phases. They are not P9.2-specific.

### Negative

- The strict "byte-identical" guarantee is now relaxed. Consumers that asserted byte-identicality via tooling (e.g., a CI diff check) need to be updated to assert "structurally identical" instead (existing members unchanged, new members allowed).
- Future P-phases may be tempted to over-extend the unions. The SDS-explicit-approval requirement and the sentinel assertion are the guardrails; they must be enforced rigorously.
- The "protected" terminology is now slightly misleading. The 6 files are protected against breaking mutation, not against any change. A future rename to "structurally-protected files" or "frozen-shape files" may be warranted, but the renaming is out of scope for this ADR.

### Neutral

- The P9.2 SDS has been updated to reflect this rule. The decision-deferred caveat in the "Data model summary" section has been replaced with the explicit enumeration of the two additive members.
- Future P-phase plans can use the same template: "the 6 protected type files are structurally protected; this plan adds the following additive members: …"
- The mutation taxonomy and sentinel pattern will be cited by future P-phase plans rather than re-derived each time. This is the intended outcome.

## Implementation

1. ✅ The P9.2 SDS (`docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md`) has been updated to reflect this rule and enumerate the two additive members.
2. ⏳ The P9.2 implementation plan (to be written) will restate the rule in its Global Constraints section and enumerate the same additive members.
3. ⏳ The P9.2 sentinel will:
   - **Snapshot the protected exports** as a baseline before the phase starts.
   - **Assert the snapshot at every CI run** with an exact-equality test, not a subset test:

     ```ts
     // Sentinel example for adaptation-types.ts
     import { BASELINE_PROPOSAL_ACTIONS, BASELINE_PROPOSAL_TARGET_KINDS } from "./protected-baselines.js";

     it("adaptation-types.ts ProposalAction is exactly the baseline + documented additions", () => {
       expect(currentProposalActions).toEqual([
         ...BASELINE_PROPOSAL_ACTIONS,
         "governance_change"   // the only documented addition for P9.2
       ]);
     });

     it("adaptation-types.ts ProposalTarget kinds is exactly the baseline + documented additions", () => {
       expect(currentTargetKinds).toEqual([
         ...BASELINE_PROPOSAL_TARGET_KINDS,
         "governance"          // the only documented addition for P9.2
       ]);
     });
     ```

   - **Catch accidental removals** immediately: if a future PR removes a member, the test fails with a clear diff showing what was removed.
   - **Catch undocumented additions**: if a PR adds a member not in the SDS/plan, the test fails (the expected list does not include it).

4. ⏳ Future P-phases that touch any of the 6 protected files must follow this ADR, including the snapshot-and-exact-equal sentinel pattern. The snapshot baseline is updated at the start of each phase that adds new members; the test enumerates the expected additions.

## Subsequent amendments (timeline note)

The P9.2 SDS received a detailed design review after this ADR was written. The review produced 5 amendments + 1 architectural enhancement, all applied in commit `d70e4ece`. **None of those amendments touched any of the 6 protected files.** The protected-type scope of this ADR is unchanged:

- The 1:1 metadata projection (P9.1 amendment) lives in `src/governance/governance-types.ts` (a non-protected new file from P9.0).
- The compensating-tombstone atomicity, `getRecommendation` helper, confidence inheritance rule, sentinel `ALLOWED_IN_FILE` precision, and `proposedFromRecommendationId` provenance field are all in non-protected files or in documentation.
- The two additive members on `adaptation-types.ts` (per the original "Decision" section above) remain the only protected-file change required by P9.2.

The P9.1 SDS was also amended (in the same commit) to add `Recommendation.metadata`, a discriminated union keyed on `category`. This lives in `src/governance/governance-types.ts` (also non-protected), so it does not require an ADR-0004 exception.

### Second review round (commit `6d63173a`)

A third P9.2 design review produced 3 more amendments. None touched a protected file either, but one of them is worth recording as the **first concrete example** of the Allowed mutation class from this ADR:

- Amendment 1: atomicity invariant rewording (documentation only).
- Amendment 2: `status === "open"` added to the eligibility gate. This is a constant + check in `src/governance/governance-proposal-generator.ts` (P9.2-specific).
- Amendment 3: `provenance.recommendationCategory` added to the proposal structure. This writes a new key into the P5 `provenance: Record<string, unknown>` field. **The P5 `Proposal` type is already loose-typed for `provenance`, so adding a new key is a textbook Allowed mutation** under this ADR's taxonomy — no union member changed, no existing field renamed or retyped, no Forbidden operation occurred. The denormalized field is non-authoritative by design (EvidenceChain and the source recommendation remain the audit sources).

This is the first time a P-phase has actually exercised the "Allowed additive evolution" path for a field on a P5 type. The framework works as intended: the addition required an SDS amendment (approved) and a plan/sentinel enumeration (forthcoming), and no Forbidden mutation occurred. Future P-phases adding fields to P5 `provenance` should follow the same process.

If a future P-phase (P9.2b, P9.3, P10, etc.) needs to add further members to `adaptation-types.ts` or any other protected file, the rule in the "Decision" section above applies — SDS + plan + sentinel must enumerate each new member.

## Related

- P9.0 meta-governance SDS: `docs/superpowers/specs/2026-06-23-p9-meta-governance-design.md` (section 5 stages P9.2 as proposal generation)
- P9.1 governance-recommendations SDS: `docs/superpowers/specs/2026-06-23-p9-1-governance-recommendations-design.md` (explicitly defers proposal generation to P9.2)
- P9.2 governance-proposals SDS: `docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md` (updated by this ADR)
- Prior plans that referenced the "byte-identical" framing: P8.5a.2, P8.5b, P8.5c, P9.0a, P9.1 — these remain valid for the phases they govern; the new rule applies going forward.
