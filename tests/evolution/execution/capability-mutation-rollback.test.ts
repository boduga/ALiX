// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-6 Task 7 — rollback re-homing + barrel export verification.
 *
 * The planner's `createDefaultRollbackResolver` no longer owns `capability.*`
 * rollback semantics. The five `capability.*` → `capability.restore_*`
 * automatic mappings live in `createCapabilityRollbackResolver` (in the
 * executor). The legacy `CapabilityLifecycleApplier` is repointed to the
 * executor's resolver so its `capability.transition` plans keep getting
 * automatic safe `capability.restore_transition` rollback (behavior-preserving).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCapabilityRollbackResolver } from "../../../src/evolution/execution/capability-mutation-executor.js";
import { createDefaultRollbackResolver } from "../../../src/evolution/execution/execution-planner.js";
import type { ExecutionStep } from "../../../src/evolution/execution/contracts/execution-contract.js";

/**
 * Resolve the project root from the test's import.meta.url so the test works
 * whether run from `tests/...` (tsx) or from `dist/tests/...` (compiled). The
 * project root is the nearest ancestor that contains both `src/` and
 * `tsconfig.json`; both halves of the file layout always live under it.
 */
function resolveProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, "src")) && existsSync(resolve(dir, "tsconfig.json"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Could not resolve project root from test path");
}
const APPLIER_SOURCE_PATH = resolve(resolveProjectRoot(), "src/evolution/capability-lifecycle/capability-lifecycle-applier.ts");

function s(op: string, params: Record<string, unknown>, idempotent = false): ExecutionStep {
  return { stepId: "s1", operation: op, parameters: params, idempotent, preconditions: {}, postconditions: {} };
}

describe("capability rollback re-homing", () => {
  it("the executor resolver maps all five operations to automatic safe rollback", () => {
    const resolver = createCapabilityRollbackResolver();
    const ops: Array<[string, Record<string, unknown>]> = [
      ["capability.create", { capabilityId: "c1" }],
      ["capability.update", { capabilityId: "c1" }],
      ["capability.transition", { capabilityId: "c1" }],
      ["capability.consolidate", { sources: ["a", "b"], target: "ab" }],
      ["capability.remove", { capabilityId: "c1" }],
    ];
    for (const [op, params] of ops) {
      const rb = resolver.createRollback(s(op, params));
      assert.match(rb.operation, /^capability\.restore_/);
      assert.equal(rb.safe, true);
      assert.equal(rb.rollbackType, "automatic");
    }
  });

  it("the default planner resolver no longer owns capability.transition (re-homed)", () => {
    const resolver = createDefaultRollbackResolver();
    const rb = resolver.createRollback(s("capability.transition", { capabilityId: "c1" }, true));
    // Re-homed: falls back to manual (generic planner), safe=false — legacy applier is repointed.
    assert.equal(rb.safe, false);
    assert.equal(rb.rollbackType, "manual");
  });

  it("the legacy applier still uses the executor's resolver (repointed)", () => {
    // Regression: after the re-home, the legacy `CapabilityLifecycleApplier` must
    // repoint its default resolver to `createCapabilityRollbackResolver` so its
    // `capability.transition` plans continue to receive the automatic safe
    // `capability.restore_transition` rollback (behavior-preserving). The applier's
    // own integration tests cover the end-to-end plan; here we just verify the
    // source imports the executor's resolver (no transitive call chain needed).
    const applierPath = APPLIER_SOURCE_PATH;
    const source = readFileSync(applierPath, "utf8");
    assert.match(
      source,
      /import\s*\{[^}]*\bcreateCapabilityRollbackResolver\b[^}]*\}\s*from\s*["']\.\.\/execution\/capability-mutation-executor(?:\.js)?["']/,
      "CapabilityLifecycleApplier must import createCapabilityRollbackResolver from the executor module",
    );
    assert.match(
      source,
      /createCapabilityRollbackResolver\(\)/,
      "CapabilityLifecycleApplier must call createCapabilityRollbackResolver() as its default resolver",
    );
    // And it must NOT still be using the planner's generic resolver (which no
    // longer owns the transition mapping) as its default.
    assert.doesNotMatch(
      source,
      /createDefaultRollbackResolver\(\)/,
      "CapabilityLifecycleApplier must no longer use createDefaultRollbackResolver() as its default",
    );
  });
});