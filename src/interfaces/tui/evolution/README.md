# TUI Evolution View

## Overview
Read-only `evolution` tab: a capability-spine overview with a two-level selection hierarchy (left capability cursor → right stage cursor), a stage-collapsed drill-down with an artifact cursor, a reference-by-id inspector, and a flat index mode. The package splits into a pure key mapper, a pure renderer over the evolution projection snapshot, and the view that owns selection state in `ctx.perTab`. Rendering caps are presentation limits only — they never truncate the projection.

## Interface
- `EvolutionKeyAction` — normalized action union (`navigate`/`expand`/`collapse`/`flat`/`spine`/`select`/`none`) `[evolution-keys.ts:EvolutionKeyAction]`.
- `evolutionKeyAction(key, perTab)` — map arrows, `j`/`k`, Enter, Esc, `f`, `c`/`q` to an action; Enter means `select` when a stage is expanded, otherwise `expand` `[evolution-keys.ts:evolutionKeyAction]`.
- `EvolutionView` — `TuiView` implementation with `id = 'evolution'`, `render`, and `handleKey` `[evolution-view.ts:EvolutionView]`.
- `EVOLUTION_STAGE_ORDER` — display order `lifecycle`, `learning`, `forecasts`, `decisions`, `measurements`, `correlations` `[evolution-render.ts:EVOLUTION_STAGE_ORDER]`.
- `EvolutionRenderState` / `EvolutionDimensions` — render inputs derived from `PerTabState` plus terminal size `[evolution-render.ts:EvolutionRenderState]`.
- `renderEvolution(snap, state, dims)` — pure row renderer `[evolution-render.ts:renderEvolution]`.
- `evolutionStageItems(snap, spine, stage)` — items and status for one stage, shared by collapsed lines and the artifact cursor `[evolution-render.ts:evolutionStageItems]`.
- `evolutionStageNodeType(stage)` — inspectable node type, `null` for `lifecycle`/`learning` `[evolution-render.ts:evolutionStageNodeType]`.
- `displayId(item)` — canonical artifact id from the first present id field `[evolution-render.ts:displayId]`.

## Invariants
- The stage cursor wraps cyclically, but the capability cursor clamps at the spine ends and never wraps `[evolution-view.ts:cycleCapability]`.
- Enter in capability focus only moves focus to the stage cursor; Enter in stage focus expands `evolutionStageCursor` and never a hardcoded default `[evolution-view.ts:descend]`.
- Ascending from an expanded stage returns to `stage` focus with the capability anchor unchanged; from stage focus it returns to `capability` focus `[evolution-view.ts:ascend]`.
- `lifecycle` and `learning` have no inspectable node type, so Enter cannot open an inspector for them `[evolution-render.ts:evolutionStageNodeType]`.
- A `lifecycle` stage whose snapshot status is not `available` renders `(unavailable)` and is reported as unavailable — never as `(empty)` `[evolution-render.ts:stageState]`.
- Expansion shows at most `EXPANSION_CAP` (10) artifacts and appends `… +N more`; flat mode shows `FLAT_PAGE` (50) per page `[evolution-render.ts:EXPANSION_CAP]`.
- Flat mode renders `snap.stages[stage]`, while spine mode resolves the selected capability from `evolutionSelectedCapabilityId` and falls back to the first spine entry `[evolution-render.ts:renderEvolution]`.
- The key mapper accepts both normalized lowercase labels and canonical names, plus Unicode arrows and the raw ESC byte `[evolution-keys.ts:evolutionKeyAction]`.

## Side Effects
- `EvolutionView.render` paints rows into `ctx.canvas` at row 4 via `writeRowsToCanvas` when a canvas is supplied `[evolution-view.ts:renderEvolution]`.
- `EvolutionView.handleKey` mutates only `ctx.perTab` (selection, focus, expanded stage, flat view, inspector) `[evolution-view.ts:handleKey]`.
- The renderer performs no I/O and reads no clocks; `generatedAt` comes from the snapshot `[evolution-render.ts:renderEvolution]`.

## Verification
- Run: `pnpm test`
