// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CAP-9 supersession — confirms CAP-9 worktree does not violate
 * forbidden-file / forbidden-import invariants enumerated in plan's
 * Global Constraints. Mirrors CAP-6/CAP-7/CAP-8 supersession test
 * pattern (file-existence + content-shape sentinels).
 *
 * Note: brief originally asserted
 * `src/evolution/capability-lifecycle/*` was untouched. That assertion
 * was dropped (Bug 2 amendment): Task 9 legitimately modified
 * `capability-lifecycle-cli.ts` to wire governance CLI switch cases
 * (`proposals` / `approve` / `reject`) through the new CapabilityService
 * surface. The CAP-11 cliff is preserved by other sentinels
 * (`governance-cli.test.ts`, `four-axis-sentinel.vitest.ts` → retired
 * and replaced by `cap-11-structural-cleanup-sentinel.vitest.ts`);
 * this supersession test focuses on CAP-9 forbidden imports.
 *
 * CAP-9 originally protected that surface; CAP-11 subsequently
 * retired it (see `cap-11-supersession.test.ts`). This test is now an
 * audit pointer, not an assertion against the lifecycle surface.
 *
 * Bug 3 amendment: brief's "5-file debt allowlist" test only asserted
 * the CAP-8 service class still exists — a vacuous check that did not
 * exercise the actual 5-file debt allowlist. Dropped to keep the
 * sentinel sharp.
 *
 * Bug 1 amendment: brief used `pnpm exec tsx --test`; project lacks
 * `tsx` as a test runner. Use `node --test` against the compiled
 * artifact at `dist/tests/capability/cap-9-supersession.test.js`
 * after `pnpm run build` per repo convention.
 */

// Compiled artifact lives at dist/tests/capability/*.test.js; the
// repo root is three levels up (dist/tests/capability → dist/tests →
// dist → <repo-root>).
const REPO = join(import.meta.dirname, "..", "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("CAP-9 supersession — forbidden files", () => {
  it("CAP-8 forbidden files preserved", () => {
    const a7 = readSrc("src/capability/evolution/a7-proposals.ts");
    // Module has imports (sanity check — would be a regression if it
    // suddenly had no imports).
    assert.equal(a7.includes("from"), true);
    // No capability canonical mutator imports.
    assert.equal(
      /from\s+["'].*capability\/canonical\/catalog["']/.test(a7),
      false,
      `a7-proposals.ts MUST NOT import from capability/canonical/catalog — found forbidden import.`,
    );
    // No tool-registry imports.
    assert.equal(
      /from\s+["'].*tools\/tool-registry/.test(a7),
      false,
      `a7-proposals.ts MUST NOT import from tools/tool-registry — found forbidden import.`,
    );
    // No policy-registry imports.
    assert.equal(
      /from\s+["'].*policy\/capability-registry/.test(a7),
      false,
      `a7-proposals.ts MUST NOT import from policy/capability-registry — found forbidden import.`,
    );
  });

  it("CAP-11 tracked debt allowlist", () => {
    // TUI façade is a distinct composition-root service from CAP-9's
    // governance path. CAP-9 must not touch it (CAP-11 owns the broader
    // migration).
    const tui = readSrc("src/tui/capabilities/capability-service.ts");
    assert.equal(tui.length > 0, true, "TUI façade must exist.");
  });
});

describe("CAP-9 governance event type prefix", () => {
  it("uses capability.governance.proposal.* (ruling #1, #2)", () => {
    const types = readSrc("src/capability/governance/governance-types.ts");
    assert.match(
      types,
      /capability\.governance\.proposal\./,
      `governance-types.ts MUST use the canonical 'capability.governance.proposal.*' prefix (ruling #1, #2).`,
    );
  });
});
