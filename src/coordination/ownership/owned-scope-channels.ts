/**
 * owned-scope-channels.ts — which mutation channels a declared owned scope can
 * actually constrain.
 *
 * WHY THIS EXISTS
 *
 * A worker declares `ownedPaths` and the policy gate enforces them. That
 * enforcement compares a set of TARGET PATHS against the declared scope. It can
 * only work for a channel whose targets are discoverable from the tool
 * arguments: a path here, a patch header there.
 *
 * A channel whose targets are NOT discoverable — an arbitrary shell command, a
 * dynamic MCP tool, a delegate that spawns another agent — cannot be checked
 * against the scope. Before this module the gate treated those channels as
 * simply "not a write tool", so a worker owning `inside.txt` could run
 * `printf x > outside.txt` and be allowed (Gate E review defect D2).
 *
 * THE RULE, AND WHY IT IS AN ALLOWLIST
 *
 * The first attempt listed the FORBIDDEN channels by name. That is the wrong
 * polarity: every new capability would be permitted until someone remembered to
 * add it, and the review found channels the list missed (`skill.create`,
 * `agent.delegate`, dynamic `mcp__*`, `hook.create`, `coordination.run`). A
 * deny-list of unscopable channels cannot be complete; an allowlist of scopable
 * ones can be, because it is the short list.
 *
 * So: with a declared scope, a MUTATING tool is permitted only when its targets
 * can be extracted and compared. Everything else is denied. Read-only tools are
 * unaffected — they cannot violate a write scope.
 *
 * MUTABILITY COMES FROM THE TOOL'S OWN REGISTRY ROW, not from a capability id.
 * The first version of this module asked `isReadonlyCapability(inferCapability(t))`
 * and got `shell.run` and `file.create` back as READ-ONLY: `inferCapability`
 * returns a `policyKey` while `isReadonlyCapability` matches `capabilityId`, so
 * the two axes never met and every lookup silently answered "read-only". Reading
 * `ToolCapabilityRegistry.resolve(toolName).mutates` is the one-hop version of
 * the same fact.
 */

import { createToolCapabilityRegistry } from "../../capabilities/tools/tool-registry.js";
import { resolveCataloguedExecutor } from "../../capabilities/tools/capability-map.js";

const catalog = createToolCapabilityRegistry();

/**
 * Tool names whose mutation targets the shared extractors can enumerate.
 *
 * This is the allowlist. Adding a tool here is a claim that its arguments fully
 * describe what it writes; adding one without that property reintroduces D2.
 */
export const SCOPABLE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "file.create",
  "file.delete",
  "patch.apply",
]);

/**
 * True when this tool mutates state through a channel a declared owned scope
 * cannot constrain.
 *
 * Unknown tools fail closed (deny), because their mutability cannot be
 * established either way.
 */
export function isUnscopableMutation(toolName: string, capability?: string): boolean {
  if (SCOPABLE_WRITE_TOOLS.has(toolName)) return false;
  const entry = resolveCataloguedExecutor(catalog, toolName)
    ?? (capability ? catalog.resolve(capability) : undefined);
  if (!entry) return true; // no identity, no proof: fail closed
  return entry.mutates;
}

/**
 * Decide whether a request that DECLARED an owned scope may proceed on the
 * strength of that scope alone.
 *
 * Returns `null` when the channel is constrainable (the caller must then compare
 * the actual targets), or a denial reason when it is not.
 */
export function unscopableChannelDenial(
  params: { toolName: string; capability?: string; ownedPaths?: readonly string[] },
): string | null {
  if (!params.ownedPaths?.length) return null; // no scope declared: nothing to violate
  if (!isUnscopableMutation(params.toolName, params.capability)) return null;
  const name = params.capability || params.toolName || "unknown";
  return (
    `Capability '${name}' cannot be constrained to owned paths ` +
    `(${params.ownedPaths.length} declared); denied for scoped workers`
  );
}
