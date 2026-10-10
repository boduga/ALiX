// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Shared helpers for the architecture freeze tests
 * (`r1-boundary-freeze.test.ts`, `layer-boundaries.test.ts`).
 *
 * One implementation of the mechanical scanning primitives keeps the two
 * guards from drifting — the layer guard originally re-implemented `walkTs`,
 * `normalizeRepo`, `loadAllowlist`, and `key` and fell behind R1's import
 * coverage (dynamic `import()`, `export … from`).
 *
 * @module freeze-utils
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function toPosix(p: string): string {
  return p.split("\\").join("/");
}

export function normalizeRepo(p: string): string {
  return toPosix(p).replace(/^\.\//, "");
}

/** Every non-declaration `.ts` file under `dir`, sorted by name. */
export function walkTs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
}

/** Top-level `src/` subdirectories (the 12 subsystems), sorted. */
export function listSubsystemDirs(srcRoot: string): string[] {
  return readdirSync(srcRoot)
    .filter((name) => statSync(resolve(srcRoot, name)).isDirectory())
    .sort();
}

export type AllowEntry = {
  rule: string;
  importer: string;
  imported: string;
  reason: string;
  removalPhase: string;
};

export function loadAllowlist(projectRoot: string, file: string): AllowEntry[] {
  const p = resolve(projectRoot, "tests/architecture", file);
  return JSON.parse(readFileSync(p, "utf-8")) as AllowEntry[];
}

export function allowKey(v: { rule: string; importer: string; imported: string }): string {
  return `${v.rule}|${normalizeRepo(v.importer)}|${normalizeRepo(v.imported)}`;
}

// ─── Value-import scanning ────────────────────────────────────────────────
//
// Captures the three shapes that create a real cross-module value edge:
// static `import … from`, static `export … from`, and dynamic `import(…)`.
// Type-only forms (`import type`, `export type`, `import { type X }`, and
// type-position `: import(…)`) are exempt — they bind nothing at runtime.

const STATIC_IMPORT = /(^|\n)\s*import\s+(type\s+)?([^;]*?)\s*from\s+["']([^"']+)["']/g;
const STATIC_EXPORT = /(^|\n)\s*export\s+(type\s+)?([^;]*?)\s*from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /([?:]\s*)?\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** `{ type A, type B }` — an inline type-only clause. */
export function inlineTypeOnlyClause(clause: string): boolean {
  const m = clause.trim().match(/^\{([\s\S]*)\}$/);
  if (!m) return false;
  const parts = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^type\s/.test(p));
}

/** `: import(…)` / `?: import(…)` — a type-position dynamic import. */
export function isTypePositionDynamic(prefix: string | undefined): boolean {
  return Boolean(prefix && /[?:]/.test(prefix));
}

/** Module specifiers reached by a value import/export in `content`. */
export function collectValueImportSpecifiers(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STATIC_IMPORT.lastIndex = 0;
  while ((m = STATIC_IMPORT.exec(content)) !== null) {
    if (m[2] || /^\s*type\b/.test(m[3] ?? "") || inlineTypeOnlyClause(m[3] ?? "")) continue;
    out.push(m[4]);
  }
  STATIC_EXPORT.lastIndex = 0;
  while ((m = STATIC_EXPORT.exec(content)) !== null) {
    if (m[2] || /^\s*type\b/.test(m[3] ?? "") || inlineTypeOnlyClause(m[3] ?? "")) continue;
    out.push(m[4]);
  }
  DYNAMIC_IMPORT.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT.exec(content)) !== null) {
    if (isTypePositionDynamic(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}
