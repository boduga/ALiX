// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * CAP-10 supersession — confirms the CAP-10 worktree does not violate
 * forbidden-file / forbidden-import invariants enumerated in plan's
 * Global Constraints. Mirrors the CAP-7/CAP-8/CAP-9 supersession
 * test pattern (file-existence + content-shape sentinels).
 *
 * Bug 1 amendment (CAP-9 retro): brief used `pnpm exec tsx --test`;
 * project lacks `tsx` test runner. Use `node --test` against the
 * compiled artifact at `dist/tests/capability/cap-10-supersession.test.js`
 * after `pnpm run build` per repo convention.
 *
 * Bug 2 amendment (CAP-9 retro): brief's "service imports
 * Measurement from capability/measurement/measurement-contract" assertion was
 * architecturally incorrect — the actual design is
 *   service → CapabilityMeasurementEngine → Measurement
 * so the type-only import lives in the engine. Re-aimed at engine.
 *
 * Bug 3 amendment (CAP-9 retro): brief's sample had malformed
 * imports (missing `from`, missing `=`, misplaced paren in
 * describe title) — fixed inline.
 */

// Compiled artifact lives at dist/tests/capability/*.test.js;
// repo root three levels up (dist/tests/capability → dist/tests →
// dist → <repo-root>).
const REPO = join(import.meta.dirname, "..", "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(REPO, rel), "utf8");
}

describe("CAP-10 supersession (forbidden files + structural invariants)", () => {
  describe("CAP-10 forbidden imports (ruling #9, #19)", () => {
    it("CAP-10 measurement files MUST NOT import capability-lifecycle-measurer", () => {
      const files = [
        "src/capability/measurement/capability-measurement-engine.ts",
        "src/capability/measurement/measurement-contract.ts",
        "src/evolution/observation/capability-measurement.ts",
        "src/capability/capability-service.ts",
        "src/capability/platform.ts",
        "src/cli/commands/capability-measure.ts",
      ];
      for (const f of files) {
        const src = readSrc(f);
        assert.equal(
          /from\s+["'].*capability-lifecycle-measurer/.test(src),
          false,
          `${f} MUST NOT import capability-lifecycle-measurer — ruling #9 violated.`,
        );
      }
    });

    it("CAP-10 measurement files MUST NOT import src/evolution/capability-lifecycle/*", () => {
      const files = [
        "src/capability/measurement/capability-measurement-engine.ts",
        "src/capability/measurement/measurement-contract.ts",
        "src/capability/capability-service.ts",
        "src/capability/platform.ts",
        "src/cli/commands/capability-measure.ts",
      ];
      for (const f of files) {
        const src = readSrc(f);
        assert.equal(
          /from\s+["'].*evolution\/capability-lifecycle\//.test(src),
          false,
          `${f} MUST NOT import src/evolution/capability-lifecycle/* — ruling #9 violated.`,
        );
      }
    });

    it("legacy measurer file retired by CAP-11 (was: CAP-11 cliff)", () => {
      // CAP-10 originally protected the legacy measurer file.
      // CAP-11 subsequently retired it (see
      // `cap-11-supersession.test.ts` for authoritative deletion proof).
      // This assertion is now an audit pointer, not an existence check.
      assert.ok(true);
    });
  });

  describe("CAP-10 type-only A5 import (ruling #7)", () => {
    it("A5 interface lives at capability/measurement/measurement-contract.ts", () => {
      const a5Ifc = readSrc("src/capability/measurement/measurement-contract.ts");
      assert.match(a5Ifc, /interface\s+Measurement/);
      assert.match(a5Ifc, /measureCapability/);
    });

    it("engine imports Measurement as TYPE only from capability/measurement/measurement-contract", () => {
      // Bug 2 amendment: service -> engine -> Measurement; the
      // type-only import lives in the engine (the architecture
      // surface that bridges to A5).
      // The import path may be relative ('./measurement-contract.js') or absolute
      // ('capability/measurement/measurement-contract'); match either form ending
      // in the measurement-contract module.
      const engine = readSrc(
        "src/capability/measurement/capability-measurement-engine.ts",
      );
      assert.match(
        engine,
        /import\s+type\s+\{[^}]*Measurement[^}]*\}\s+from\s+["'][^"']*measurement-contract/,
        "engine MUST import type Measurement from capability/measurement/measurement-contract (ruling #7)",
      );
    });

    it("service MUST NOT import the A5 implementation", () => {
      const service = readSrc("src/capability/capability-service.ts");
      assert.equal(
        /from\s+["'].*evolution\/observation\/capability-measurement/.test(service),
        false,
        "service MUST NOT import the A5 implementation — ruling #7 violated.",
      );
    });
  });

  describe("CAP-10 long-form event types (ruling #1)", () => {
    it("measurement event type uses full long-form prefix", () => {
      const types = readSrc("src/capability/measurement/measurement-event-types.ts");
      assert.match(types, /capability\.governance\.measurement\.measured/);
    });

    it("orchestrator persists the long-form event type", () => {
      const engine = readSrc("src/capability/measurement/capability-measurement-engine.ts");
      assert.match(
        engine,
        /capability\.governance\.measurement\.measured/,
        "engine MUST persist long-form event type (ruling #1).",
      );
    });
  });

  describe("CAP-10 governance() widening (ruling #6, #20)", () => {
    it("MEASUREMENT_GOVERNANCE_PREFIX equals parent prefix 'capability.governance.'", () => {
      const types = readSrc("src/capability/measurement/measurement-event-types.ts");
      assert.match(
        types,
        /export\s+const\s+MEASUREMENT_GOVERNANCE_PREFIX\s*=\s*["']capability\.governance\.["']/,
      );
    });

    it("service.governance() uses the parent prefix (not the narrower proposal prefix)", () => {
      const service = readSrc("src/capability/capability-service.ts");
      const govMatch = service.match(/^ {2}async governance[\s\S]+?^ {2}}/m);
      assert.ok(govMatch, "governance() method must exist");
      assert.match(govMatch![0], /MEASUREMENT_GOVERNANCE_PREFIX/);
    });
  });

  describe("CAP-10 file presence", () => {
    it("all CAP-10 files exist", () => {
      const paths = [
        "src/capability/measurement/measurement-event-types.ts",
        "src/capability/measurement/outcome-discriminated-union.ts",
        "src/capability/measurement/measurement-contract.ts",
        "src/capability/measurement/capability-measurement-engine.ts",
        "src/evolution/observation/capability-measurement.ts",
        "src/capability/errors/measure-failed.ts",
        "src/capability/errors/measure-invalid-target.ts",
        "src/cli/commands/capability-measure.ts",
        "tests/capability/five-axis-sentinel.vitest.ts",
        "tests/capability/capability-measure-cli.test.ts",
      ];
      for (const p of paths) {
        assert.equal(existsSync(join(REPO, p)), true, `${p} must exist`);
      }
    });
  });
});
