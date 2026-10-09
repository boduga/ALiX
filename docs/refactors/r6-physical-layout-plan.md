# R6 — Physical layout into the 12-subsystem structure

**Status:** ✅ DONE — `refactor/r6-layout`. All `src/` top-level dirs relocated;
final roots are exactly the 12 subsystems (`agents`, `capabilities`, `context`,
`coordination`, `execution`, `governance`, `interfaces`, `models`, `operations`,
`planning`, `runtime-state`, `session`) plus the entry files `index.ts`,
`cli.ts`, `run.ts`, `task-classifier.ts`. `src/agent` folded into
`src/agents/agent`; `src/adaptive` into `src/planning/adaptive`; `src/patch`
into `src/execution/patch`; `src/adaptation` into `src/planning/adaptation`.
Tests were NOT relocated (they still mirror the pre-R6 layout); the planning
agent's `src/`→`tests/` test-derivation heuristic now yields
`tests/<subsystem>/<path>`, tracked as follow-up debt.

**Original status note:** the last remaining phase of the R0–R6 campaign.
**Predecessor:** R0–R5 all merged (`main` = R5 merge `674f7883`; R1 `#867`,
R2 `#868`, R3 `#869`, R4 `#870`, R5 `#871`, plus follow-ups `#872`/`#873`/`#874`).
**Nature:** mechanical. R1–R5 made the boundaries real (ports, ledger authority,
one resolver/catalogue/metrics vocabulary, redaction gate). R6 only moves files
and rewires imports; it must not change behavior.

## Goal

Relocate `src/**` from its current 65 ad-hoc top-level directories into the 12
subsystems named in `docs/refactors/r0-findings-r3-plan.md`, then delete the old
paths. Also resolve the 4 `status-store-writes` executive read-path allowlist
entries reclassified from R5.

## Target subsystems (4 layers)

| Layer | Subsystem | Absorbs (proposed) |
|---|---|---|
| Experience | `interfaces/` | `cli`, `tui`, `ui`, `inspector`, `server` (api) |
| | `session/` | `session` |
| Coordination | `planning/` | `planning`, `reasoning`, `forecasting`, `decision`, `adaptive`, `evolution`, `learning`, `reflection` |
| | `coordination/` | `kernel`, `ownership`, `sop`, `workflow` |
| | `agents/` | `agents` |
| Control | `governance/` | `governance`, `policy`, `approvals`, `audit`, `security` |
| | `execution/` | `run`, `executive`, `verification`, `verifier`, `recovery` |
| | `capabilities/` | `capability`, `tools`, `mcp`, `registry`, `skills`, `extensions`, `integrations`, `self-extend` |
| | `models/` | `models`, `providers`, `tracing` |
| Execution & Platform | `context/` | `context`, `repomap`, `chronicle`, `baseline`, `utils/memory` |
| | `runtime-state/` | `runtime`, `storage`, `events`, `contracts` |
| | `operations/` | `observability`, `benchmark`, `evals`, `testing`, `schedule`, `daemon`, `db`, `prompts`, `utils`, `correlation`, `hooks`, `explain`, `config` |

> The mapping above is a PROPOSAL. `config` and `contracts` are cross-cutting;
> confirm their home (and whether `interfaces/cli` keeps `bin/alix.js` on the
> same path) before moving anything. No file moves until the operator signs off.

## Open decisions (resolve first)

1. **Sign off the dir→subsystem mapping.** Several dirs are cross-cutting
   (`config`, `contracts`, `utils`, `events`, `tracing`).
2. **Public entry-points.** `bin/alix.js`, `package.json` `files`/`bin`, and the
   `dist/` build layout must keep working; use `git mv` + import codemod, keep
   leaf filenames, update only the directory segment.
3. **Barrels.** Preserve any module's own entry point; do not collapse modules.
4. **DOX moves.** Each `AGENTS.md` moves with its directory and its parent
   Child DOX Index updates in the same commit.
5. **Freeze/allowlist paths.** `tests/architecture/r1-allowlist.json` and
   `r1-boundary-freeze.test.ts` target paths must be rewritten with the moves;
   the shrink-only check must still pass.

## Mechanical approach

1. Land the mapping as a single commit per subsystem layer (Experience →
   Coordination → Control → Execution&Platform) so review stays bounded.
2. Per move: `git mv <old>/ <new>/<leaf>`, then rewrite relative import
   specifiers (directory segment only) with a scripted codemod; `tsc` catches
   any miss.
3. Move the directory's `AGENTS.md`; update the parent's Child DOX Index and any
   cross-references in the same commit.
4. Update `tests/architecture/r1-allowlist.json` + `r1-boundary-freeze.test.ts`
   target lists and `scripts/check-dead-modules.mjs` entry-point allowlist.
5. Delete now-empty old directories; `rm -rf dist && pnpm build` after any
   deleted `src/` dir (tsc does not prune removed outputs).

## Gates (per layer commit and at the end)

`pnpm build` · `npx tsc -p tsconfig.json --noEmit` ·
`npx tsc -p tsconfig.unused.json --noEmit` · `pnpm test:node` ·
`pnpm test:vitest` · `node scripts/check-dead-modules.mjs` ·
`node scripts/check-dox-claims.mjs --base origin/main`.

Because this phase is pure relocation, the end state must show **zero**
test-count change versus `main` (same passes, same skips) and no new allowlist
entries.

## Also in scope

- The 4 executive read-path entries reclassified from R5 (`status-store-writes`:
  `src/cli/commands/adaptation/main.ts`, `executive-evaluate-handler.ts`,
  `executive-orchestrate-handler.ts`, `executive.ts` importing
  `src/executive/execution-state-store.ts`) — resolve during the `execution/`
  move.

## Carried review debt (not R6, but do not lose)

- R4 one-shared-snapshot-contract: `src/ui/projection.js` ↔
  `src/inspector/projection.ts` are twins. Extract one shared contract.
- R5: `createToolCapabilityRegistry` and `createMetricsStoreSink` have no
  production consumer; `subagents.enabled` flat reads deferred.
- Operator's broader lease/liveness + graph-authorization regression matrix
  from the #869 review.
