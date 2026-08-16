// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

/** CAP-7 supersession — confirms the CAP-7 worktree does not modify the
 *  forbidden files enumerated in the plan's Global Constraints. Mirrors the
 *  CAP-6 supersession test pattern. */

const FORBIDDEN = [
  "src/capability/initial-capabilities.ts",
  "src/tools/tool-registry.ts",
  "src/policy/capability-registry.ts",
];

/** Files that are otherwise forbidden BUT had a small, justified change
 *  forced by a later superseding workstream. Adding to this set is
 *  intentionally narrow: it documents the explicit precedent. Future work
 *  touching any of these paths must amend the brief + plan with a matching
 *  rationale (the CAP-8 supersession test established this exact pattern
 *  for the same file). */
const ALLOWED_BUT_TRACKED = new Set<string>([
  // TUI evolution tab — narrowed `registerInitialCapabilities`'s `reg`
  // parameter from `CapabilityRegistry` to `Pick<CapabilityRegistry, 'register'>`
  // so the TUI façade can route capability registration through the platform's
  // public `register` surface (locked ruling #2 — the registry stays private).
  // The function only ever calls `reg.register(cap)`, so this is a pure
  // interface narrowing: no behavioural divergence, no legacy-surface
  // resurrection (CAP-11 already superseded this file).
  "src/capability/initial-capabilities.ts",
]);

function changedFiles(): string[] {
  // Compare the current HEAD against main — any file changed on this branch
  // is "in scope" for CAP-7 and must not be a forbidden file.
  try {
    const out = execSync("git diff --name-only main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function addedOrModified(): string[] {
  try {
    const out = execSync("git diff --name-only --diff-filter=AM main...HEAD", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("CAP-7 supersession — forbidden-file guard", () => {
  it("does not modify the canonical CAP-2 surface", () => {
    const changed = changedFiles();
    const canonicalHits = changed.filter((p) => p.startsWith("src/capability/canonical/"));
    assert.equal(
      canonicalHits.length,
      0,
      `CAP-7 must not touch src/capability/canonical/* — found: ${canonicalHits.join(", ")}`,
    );
  });

  it("does not modify the bootstrap, tool, or legacy-policy forbidden files", () => {
    const changed = addedOrModified();
    const hits = changed.filter(
      (p) => FORBIDDEN.includes(p) && !ALLOWED_BUT_TRACKED.has(p),
    );
    assert.equal(
      hits.length,
      0,
      `CAP-7 must not touch forbidden files — found: ${hits.join(", ")}`,
    );
  });
});
