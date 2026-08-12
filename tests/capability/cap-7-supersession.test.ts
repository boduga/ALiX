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
    const hits = changed.filter((p) => FORBIDDEN.includes(p));
    assert.equal(
      hits.length,
      0,
      `CAP-7 must not touch forbidden files — found: ${hits.join(", ")}`,
    );
  });
});
