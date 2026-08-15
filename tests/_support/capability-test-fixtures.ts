/**
 * Shared test fixtures for capability evolution tests.
 *
 * Extracted in code-review pass 3 (J2) from `cap-p-consolidate-execution.vitest.ts`
 * and `capability-consolidate.vitest.ts` so the two CAP-P test files (and any
 * future CAP-P-* tests) share a single definition-builder. The shape here MUST
 * stay byte-identical to the inlined helpers it replaced; existing tests rely
 * on the exact default field set (id, version, kind, title, description, tags,
 * category, risk, requiredPermissions, dependencies, bindings).
 */
import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";

/**
 * Build a `CapabilityDefinition` with the conservative-merge-required fields
 * pre-populated. Overrides are spread last so callers can replace any default.
 */
export function def(
  over: Partial<CapabilityDefinition> = {},
): CapabilityDefinition {
  return {
    id: "core.alpha",
    version: "1.0.0",
    kind: "core",
    title: "Alpha",
    description: "d",
    tags: [],
    category: "core",
    risk: "low",
    requiredPermissions: ["operator"],
    dependencies: [],
    bindings: [{ id: "core.alpha", type: "native" }],
    ...over,
  };
}