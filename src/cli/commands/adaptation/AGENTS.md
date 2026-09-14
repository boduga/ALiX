# DOX — Adaptation CLI commands

**Purpose:** `alix adaptation <subcommand>` handlers. Extracted from the former
`../adaptation.ts` megafile (#717); `../adaptation.ts` is now a re-export barrel
so existing import paths (`src/cli.ts`, tests) are unchanged.

**Ownership:**
- `shared.ts` — `.alix` path constants (`PROPOSALS_DIR`, `EFFECTIVENESS_DIR`,
  `INTELLIGENCE_DIR`, `EVIDENCE_DIR`, `CARDS_DIR`, `SKILLS_DIR`,
  `SNAPSHOTS_DIR`) + `detectActor`.
- `appliers.ts` — `selectApplier` (target.kind → applier; routes through
  ApprovalGate).
- `renderers.ts` — print/format helpers (`printProposal`, `printUsage`,
  `printEffectiveness`, `printIntelligenceReport`, `printPriorityReport`,
  `printCapabilityEvolutionReport`, `describeTarget`, `pad`, …).
- `handlers.ts` — `run*` subcommand handlers (list/show/propose/approve/reject/
  apply/lineage/effectiveness/generate/revert/intelligence/prioritize/
  capability-evolution).
- `main.ts` — `handleAdaptationCommand` dispatcher.

**Local Contracts:**
- Each module stays ≤ 1,000 lines (leaf-extraction threshold, #717).
- `../adaptation.ts` re-exports `handleAdaptationCommand` and `selectApplier`;
  do not add logic there.
- `apply` routes through `ApprovalGate.apply` — never calls an applier directly.
- Relative imports are one level deeper than the old file (`../../../` → `src/`,
  `../` → `src/cli/commands/`).

**Work Guidance:**
- Moving a handler: keep the public name and re-export from `../adaptation.ts`.
- Source-grep tests that inspect the old path now read
  `adaptation/handlers.ts` (see `tests/cli/commands/adaptation-generate.vitest.ts`).

**Verification:**
- `tests/cli/commands/adaptation*.vitest.ts` — full subcommand surface.
- `tests/adaptation/governance-sentinels.vitest.ts` — applier boundaries.
