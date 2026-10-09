/**
 * adaptation.ts — `alix adaptation <subcommand>` CLI.
 *
 * Thin re-export barrel (#717): the dispatcher lives in `./adaptation/main.ts`
 * and the pieces in sibling modules. Public import paths are unchanged
 * (`src/cli.ts` and tests import from here).
 *
 * - `adaptation/shared.ts`    — path constants + `detectActor`
 * - `adaptation/appliers.ts`  — `selectApplier`
 * - `adaptation/renderers.ts` — print/format helpers
 * - `adaptation/handlers.ts`  — `run*` subcommand handlers
 * - `adaptation/main.ts`      — `handleAdaptationCommand` dispatcher
 */

export { handleAdaptationCommand } from "./adaptation/main.js";
export { selectApplier } from "./adaptation/appliers.js";
