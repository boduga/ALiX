# Research: ALiX CLI Command Surface Introspectability

**Source ticket:** wayfinder #310 — https://github.com/boduga/ALiX/issues/310
**Date:** 2026-07-31

## Headline finding

**The CLI surface is NOT introspectable today.** Every one of the 71 command modules uses free-form `handler(args: string[])` / `handle*Command(args: string[])` signatures with zero structured metadata exports. Subcommand routing is ad-hoc via inline `switch`/`if-else`. The `--help` text is hand-authored and covers only ~30-40 of the 71 entry points.

## Export shapes (4 patterns)

- **Pattern A — Flat `handler(args): Promise<number>`**: `run.ts`, `apply.ts`, `submit.ts`, `review.ts`, `plan.ts`, `session.ts`
- **Pattern B — Top-level `handle*Command(args)` dispatcher**: `sop.ts` (list/show/doctor/run), `governance.ts` (30+ subcommands), `executive.ts` (16), `observability.ts` (6), `evidence.ts` (4), `workflow.ts`, `reflection.ts`, `adaptation.ts` (6), `decision.ts`, `learning.ts`, `explain.ts`, `baseline.ts`
- **Pattern C — Multiple independent `handle*Xxx` functions**: `security.ts` (~15 named exports), `recover.ts` (4), `benchmark.ts` (3), `models.ts` (7)
- **Pattern D — Options interfaces (TS types, not CLI metadata)**: `ApplyOptions`, `ReviewOptions`, `PlanOptions`, etc.

## Dispatch shape (`src/cli.ts`, 2866 lines)

Two mechanisms coexist:
1. **`COMMAND_ROUTER`** (lines 40-99) — lazy-loaded `Record<string, () => Promise<{handler}>>` for 11 core commands (run, session, plan, review, apply, submit, tui, demo, init, runs). Dispatched at lines 2856-2861.
2. **Inline `if (command === "...")` chains** (lines ~187-2850) — every other command, ~2000+ lines of sequential conditionals. No centralized table.

No metadata-driven routing exists.

## Implication for the manifest generator

The generator cannot introspect arg schemas from code — there are none. Two viable paths:

- **Convention + wrapper**: add a `const META = { name, description, args }` export to each command module, wrap existing handlers. Requires touching all 71 modules.
- **CLI table as source**: build the manifest from a hand-curated table that IS the generator's input (not derived from code), seeded from the existing `--help` block, then kept current by the generator's existence.

The `COMMAND_ROUTER` pattern already demonstrates the adapter needed for lazy metadata.

## Assets

- Full per-module classification tables in the research ticket (#310) comment history.
- `--help` output at `src/cli.ts:101-177` is the only existing human-readable surface.
