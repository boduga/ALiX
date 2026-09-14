#!/usr/bin/env node
/**
 * check-dead-modules.mjs — fail when a src module has no importers (#707).
 *
 * Builds a relative-import graph over src/** and tests/** (static +
 * dynamic imports) and reports .ts modules imported by nothing. Known
 * entry points (CLI, daemon, TUI bootstrap, test helpers reached via
 * loaders) are allowlisted. Run: `pnpm check:dead`.
 *
 * This is a coarse reference check, not a bundler: type-only and value
 * imports both count; extensionless, .js-suffixed, and directory imports
 * resolve to their .ts source.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";

const ROOT = resolve(join(import.meta.dirname, ".."));
const SRC = join(ROOT, "src");
const TESTS = join(ROOT, "tests");

/** Entry points: reachable from outside the import graph (bin, loaders). */
const ENTRYPOINTS = new Set([
  "src/cli.ts",
  "src/index.ts",
  "src/run.ts",
  // Spawned as a child process by DaemonManager (daemon-manager.ts).
  "src/daemon/daemon-server.ts",
  // Deliberate compatibility aliases (re-export a canonical module).
  "src/runtime/execution-state/state-transition.ts",
  "src/runtime/retrieval.ts",
  // Re-export barrels: package public surface (dist/ is published
  // wholesale). Zero internal importers is expected, not a defect.
  "src/contracts/index.ts",
  "src/evolution/forecast/index.ts",
  "src/evolution/knowledge/index.ts",
  "src/evolution/learning/index.ts",
  "src/evolution/pattern-discovery/index.ts",
  "src/policy/index.ts",
  "src/run/index.ts",
  "src/tui/index.ts",
  "src/utils/memory/index.ts",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // bare / node: / package imports
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, join(base, "index.ts")];
  // Extension-swapped (.js -> .ts) TS-style relative imports.
  if (base.endsWith(".js")) candidates.push(base.slice(0, -3) + ".ts");
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch { /* ignore */ }
  }
  return null;
}

const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

const modules = new Map(); // absPath -> Set<absPath importers>
for (const file of [...walk(SRC), ...walk(TESTS)]) {
  if (!modules.has(file)) modules.set(file, new Set());
}
for (const [file] of modules) {
  const text = readFileSync(file, "utf-8");
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(text)) !== null) {
    const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
    if (target && modules.has(target) && target !== file) {
      modules.get(target).add(file);
    }
  }
}

const dead = [...modules.entries()]
  .filter(([file, importers]) => {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (!rel.startsWith("src/") || !rel.endsWith(".ts")) return false;
    if (importers.size > 0 || ENTRYPOINTS.has(rel)) return false;
    return true;
  })
  .map(([file, importers]) => ({ file: relative(ROOT, file), importers: importers.size }));

if (dead.length > 0) {
  console.error(`Found ${dead.length} src module(s) with no importers in src/ or tests/:`);
  for (const d of dead) console.error(`  - ${d.file}`);
  console.error("Delete them, wire them, or add entry points to ENTRYPOINTS in scripts/check-dead-modules.mjs.");
  process.exit(1);
}
console.log("OK: every src module is imported or allowlisted.");
