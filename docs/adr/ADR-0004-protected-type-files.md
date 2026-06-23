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

Existing union members, type aliases, interfaces, and exported symbols
in the 6 protected files must remain unchanged (same name, same shape).

Additive new members — new union values, new variants, new exported
symbols — are allowed only when:

  1. An approved SDS explicitly calls for the extension.
  2. The implementation plan explicitly enumerates the new members.
  3. A sentinel assertion in the per-phase test suite verifies that
     all pre-existing members are unchanged and only the documented
     additive members were added.
```

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

### Negative

- The strict "byte-identical" guarantee is now relaxed. Consumers that asserted byte-identicality via tooling (e.g., a CI diff check) need to be updated to assert "structurally identical" instead (existing members unchanged, new members allowed).
- Future P-phases may be tempted to over-extend the unions. The SDS-explicit-approval requirement and the sentinel assertion are the guardrails; they must be enforced rigorously.
- The "protected" terminology is now slightly misleading. The 6 files are protected against breaking mutation, not against any change. A future rename to "structurally-protected files" or "frozen-shape files" may be warranted, but the renaming is out of scope for this ADR.

### Neutral

- The P9.2 SDS has been updated to reflect this rule. The decision-deferred caveat in the "Data model summary" section has been replaced with the explicit enumeration of the two additive members.
- Future P-phase plans can use the same template: "the 6 protected type files are structurally protected; this plan adds the following additive members: …"

## Implementation

1. ✅ The P9.2 SDS (`docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md`) has been updated to reflect this rule and enumerate the two additive members.
2. ⏳ The P9.2 implementation plan (to be written) will restate the rule in its Global Constraints section and enumerate the same two members.
3. ⏳ The P9.2 sentinel will assert:
   - All pre-existing `ProposalAction` members unchanged
   - All pre-existing `ProposalTarget` variants unchanged
   - Only the two documented additive members added: `"governance_change"` and `{ kind: "governance"; recommendationId: string }`
4. ⏳ Future P-phases that touch any of the 6 protected files must follow this ADR.

## Related

- P9.0 meta-governance SDS: `docs/superpowers/specs/2026-06-23-p9-meta-governance-design.md` (section 5 stages P9.2 as proposal generation)
- P9.1 governance-recommendations SDS: `docs/superpowers/specs/2026-06-23-p9-1-governance-recommendations-design.md` (explicitly defers proposal generation to P9.2)
- P9.2 governance-proposals SDS: `docs/superpowers/specs/2026-06-23-p9-2-governance-proposals-design.md` (updated by this ADR)
- Prior plans that referenced the "byte-identical" framing: P8.5a.2, P8.5b, P8.5c, P9.0a, P9.1 — these remain valid for the phases they govern; the new rule applies going forward.
