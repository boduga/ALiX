# DOX — Adaptation CLI commands

**Purpose:** `alix adaptation <subcommand>` handlers. `../adaptation.ts` is the compatibility re-export barrel.

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
- Each module stays ≤ 1,000 lines.
- Executive stores (`PlanStore` / `ExecutionStateStore`) are constructed through
  the executive-owned seam (`src/execution/executive/executive-context.ts`),
  never imported directly — a ledger projection swap lands in the seam.
- `../adaptation.ts` re-exports `handleAdaptationCommand` and `selectApplier`;
  do not add logic there.
- `apply` routes through `ApprovalGate.apply` — never calls an applier directly.
- Relative imports are one level deeper than the old file (`../../../` → `src/`,
  `../` → `src/interfaces/cli/commands/`).

**Work Guidance:**
- Moving a handler: keep the public name and re-export from `../adaptation.ts`.
- Source-grep tests that inspect the old path now read
  `adaptation/handlers.ts` (see `tests/cli/commands/adaptation-generate.vitest.ts`).

**Verification:**
- `tests/cli/commands/adaptation*.vitest.ts` — full subcommand surface.
- `tests/adaptation/governance-sentinels.vitest.ts` — applier boundaries.

**Child DOX Index:** none.
