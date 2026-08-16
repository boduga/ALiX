/**
 * A9 — Architectural sentinels (Slice 1).
 *
 * Two static guards pin corrected facts verified during Phase 0:
 *
 *   1. A9 does NOT consume A8's normalized aggregation layer. A9 is its own
 *      module (`src/evolution/a9/`); adapters preserve RAW evidence. A9 source
 *      files MUST NOT import `src/evolution/learning/` or its adapters.
 *      (Corrected fact #3; brief adapter test item 6.)
 *
 *   2. Forecast DETECTORS MUST NOT consume measurement events. Measurement
 *      consumption belongs to the later correlation slice, not forecast
 *      generation (Q8 + corrected fact #2). Detector source files MUST NOT
 *      import the measurement adapter.
 *
 * These are hard guards: a single failure fails the test.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const A9_ROOT = join(process.cwd(), "src", "evolution", "a9");
const A9_DETECTORS_ROOT = join(A9_ROOT, "detectors");

/** Recursively walk a directory returning all *.ts files (skipping *.d.ts). */
function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("A9 sentinel — A9 does not consume A8's normalized layer (raw evidence preserved)", () => {
  const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
    { pattern: /from\s+['"].*evolution\/learning/, reason: "A8 normalized aggregation layer (src/evolution/learning)" },
    { pattern: /evolution\/learning\/adapters/, reason: "A8 adapter layer" },
  ];

  it("no A9 source file imports src/evolution/learning (A9 is its own module)", () => {
    const files = walkTsFiles(A9_ROOT);
    expect(files.length, "A9 source tree must contain .ts files").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      for (const { pattern, reason } of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(src)) offenders.push(`${file}  [${reason}]`);
      }
    }
    expect(
      offenders,
      `A9 source must not consume A8 normalized records; offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("A9 sentinel — forecast detectors do NOT consume measurement events (Slice 4 concern)", () => {
  it("no detector source file imports the measurement adapter", () => {
    const files = walkTsFiles(A9_DETECTORS_ROOT);
    expect(files.length, "A9 detectors tree must contain .ts files").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      if (src.includes("measurement-events-adapter") || src.includes("CapabilityMeasurementRecord")) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `A9 forecast detectors must not consume measurement events (correlation slice concern); offenders:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
