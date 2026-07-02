/**
 * P10.10 — Baseline intelligence purity sentinel.
 *
 * Enforces the hard boundary: src/baseline/ must not import from
 * Executive or Adaptation, and must not perform file I/O.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { globSync } from "glob";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "../..");
const BASELINE_SRC = join(ROOT, "src", "baseline");

// ---------------------------------------------------------------------------
// Collect all baseline source files
// ---------------------------------------------------------------------------

const baselineFiles = globSync("**/*.ts", { cwd: BASELINE_SRC, ignore: ["**/node_modules/**"] });

describe("P10.10 baseline purity boundary", () => {
  it.each(baselineFiles)("%s must not import from executive", (file) => {
    const content = readFileSync(join(BASELINE_SRC, file), "utf-8");
    const lines = content.split("\n");
    const executiveImports = lines.filter(
      (l) => l.includes('from "../executive') || l.includes("from '../../executive") || l.includes("from '../../../executive"),
    );
    expect(executiveImports).toHaveLength(0);
  });

  it.each(baselineFiles)("%s must not import from adaptation", (file) => {
    const content = readFileSync(join(BASELINE_SRC, file), "utf-8");
    const lines = content.split("\n");
    const adaptationImports = lines.filter(
      (l) => l.includes('from "../adaptation') || l.includes("from '../../adaptation") || l.includes("from '../../../adaptation"),
    );
    expect(adaptationImports).toHaveLength(0);
  });

  it.each(baselineFiles)("%s must not import node:fs for I/O", (file) => {
    const content = readFileSync(join(BASELINE_SRC, file), "utf-8");
    const lines = content.split("\n");
    const fsImports = lines.filter(
      (l) => l.includes('from "node:fs"') || l.includes('from "fs"') || l.includes('from "node:path"'),
    );
    expect(fsImports).toHaveLength(0);
  });
});
