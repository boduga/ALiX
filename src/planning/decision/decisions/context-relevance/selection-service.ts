/**
 * selection-service.ts — Context selection behind a feature flag (J2 task 17).
 *
 * The single integration seam a runtime consumer calls. Modes:
 *  - "off"    — identity: the original items pass through, no engine call.
 *  - "shadow" — observe + journal, but return the original items unchanged.
 *  - "active" — return only the selected items.
 *
 * "off" is the default, so wiring this call site changes no behavior until an
 * operator flips the route on (J2 exit criterion: disabling restores existing
 * behavior). No execution authority is granted in any mode.
 */

import type { ContextRelevanceItemInput } from "./projection.js";
import type {
  ContextRelevanceShadowDeps,
  ContextRelevanceShadowResult,
} from "./shadow.js";
import { runContextRelevanceShadow } from "./shadow.js";

export type ContextSelectionMode = "off" | "shadow" | "active";

export type SelectContextItemsResult<T> = {
  items: readonly T[];
  mode: ContextSelectionMode;
  /** Present whenever an engine actually ran. */
  shadow?: ContextRelevanceShadowResult;
};

export async function selectContextItems<T extends ContextRelevanceItemInput>(
  items: readonly T[],
  objective: string,
  deps: ContextRelevanceShadowDeps & { mode?: ContextSelectionMode },
): Promise<SelectContextItemsResult<T>> {
  const mode = deps.mode ?? "off";
  if (mode === "off") {
    return { items, mode };
  }

  const shadow = await runContextRelevanceShadow({ objective, items }, deps);
  if (mode === "shadow") {
    return { items, mode, shadow };
  }

  const kept = new Set(shadow.selection.selectedIds);
  return { items: items.filter((item) => kept.has(item.id)), mode, shadow };
}
