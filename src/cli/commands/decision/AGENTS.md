# DOX — Decision CLI commands

**Purpose:** `alix decision <subcommand>` handlers. Extracted from the former
`../decision.ts` megafile (#717); `../decision.ts` is now a re-export barrel so
existing import paths are unchanged.

**Ownership:**
- `shared.ts` — `.alix` path constants + `buildDecisionInfrastructure`
  (proposal/evidence/effectiveness/intelligence stores, lineage/context builders).
- `context-risk.ts` — `runContext`, `runRisk`, `runRecommend`.
- `queue-brief.ts` — `runQueue`, `runBrief`, `runStatus`.
- `review.ts` — `runReview` + `renderReview` (live governance lens review).
- `outcome.ts` — `runOutcome*` (`record`/`show`/`report`/`lens-calibration`).
- `intent.ts` — `runIntent*` (`list`/`show`/`propose`).
- `main.ts` — `handleDecisionCommand` dispatcher.

**Local Contracts:**
- Each module stays ≤ 1,000 lines (dispatcher threshold, #717).
- `../decision.ts` re-exports `handleDecisionCommand`; do not add logic there.
- `runReview` validates `--lens` (and exits 1) **before** any provider/store
  setup — enforced behaviorally by
  `tests/adaptation/governance-review-sentinels.vitest.ts`.
- Relative imports: `../../../` → `src/`, `../` → `src/cli/commands/`.

**Verification:**
- `tests/adaptation/*.vitest.ts` (governance review, decision context, queue).
- `node dist/src/cli.js decision <subcommand>` smoke.
