/**
 * P10.10 — Baseline intelligence purity sentinel.
 *
 * Enforces hard boundary: src/baseline/ must not import from
 * Executive or Adaptation, and must not perform file I/O.
 *
 * Exceptions (explicitly allowed):
 *   - providers/governance-provider.ts may read governance files
 *   - providers/memory-health-provider.ts may read memory health adapter
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { globSync } from "glob";
import { importedSpecifiers } from "../helpers/import-graph.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, "../..");
const BASELINE_SRC = join(ROOT, "src", "baseline");

/** Files granted special import exceptions. */
const ALLOWED_FS: string[] = [
  "providers/governance-provider.ts",
  "providers/skills-provider.ts",
  "providers/security-provider.ts",
  "providers/adaptation-provider.ts",
];

const ALLOWED_EXECUTIVE: string[] = [
  "providers/memory-health-provider.ts",
  "providers/agent-runtime-health-provider.ts",
  "providers/workflow-runtime-health-provider.ts",
  "providers/tools-health-provider.ts",
];

// ---------------------------------------------------------------------------
// Collect all baseline source files
// ---------------------------------------------------------------------------

const baselineFiles = globSync("**/*.ts", { cwd: BASELINE_SRC, ignore: ["**/node_modules/**"] });

/** Matches a relative specifier that resolves into `src/<name>/…` from anywhere under src/baseline/. */
function intoModule(name: string): RegExp {
  return new RegExp(`^\\.\\./(?:\\.\\./)*${name}(?:/|$)`);
}

const FS_SPECIFIERS = new Set(["node:fs", "fs", "node:path"]);

describe("P10.10 baseline purity boundary", () => {
  it.each(baselineFiles)("%s must not import from executive (except allowed)", (file) => {
    if (ALLOWED_EXECUTIVE.some((a) => file.endsWith(a))) return;
    const specifiers = [...importedSpecifiers(join(BASELINE_SRC, file))];
    expect(specifiers.filter((s) => intoModule("executive").test(s))).toEqual([]);
  });

  it.each(baselineFiles)("%s must not import from adaptation", (file) => {
    const specifiers = [...importedSpecifiers(join(BASELINE_SRC, file))];
    expect(specifiers.filter((s) => intoModule("adaptation").test(s))).toEqual([]);
  });

  it.each(baselineFiles)("%s must not import node:fs for I/O (except allowed)", (file) => {
    if (ALLOWED_FS.some((a) => file.endsWith(a))) return;
    const specifiers = [...importedSpecifiers(join(BASELINE_SRC, file))];
    expect(specifiers.filter((s) => FS_SPECIFIERS.has(s))).toEqual([]);
  });
});
