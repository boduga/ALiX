// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Layer-boundary guard — architecture/dependency test.
 *
 * Complements `r1-boundary-freeze.test.ts` (which pins imports of protected
 * *files*) by enforcing the subsystem *direction* of value imports. The R1
 * freeze allows a reverse-looking edge as long as the exact file pair is
 * allowlisted; it cannot express "tools must never import the CLI layer".
 *
 * Rules (value imports only; `import type` and bare side-effect imports are
 * exempt, matching the R1 freeze policy):
 * - experience-top: only `interfaces` may import `interfaces`. Tools,
 *   coordination, execution, etc. resolve credentials/prompts through
 *   `interfaces/cli/...` today — that is debt, not a licence to widen it.
 * - state-foundational: `runtime-state` (the truth/ledger layer) must not
 *   import `agents`/`capabilities`/`coordination`/`execution`/`planning`.
 * - models-foundational: `models` (provider adapters) must not import
 *   `governance`, except the deliberate outbound-redaction seam.
 *
 * Allowlist (`layer-allowlist.json`) holds exact (rule, importer, imported)
 * triples for the current edges. Shrink-only: a new violation fails, a stale
 * entry fails, a duplicate triple fails, and an entry without an R0 reference
 * + removal phase fails — same discipline as the R1 freeze.
 *
 * @module layer-boundaries
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// TS compiles tests/ → dist/tests/ so __dirname is dist/tests/architecture.
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");

type LayerRule = {
  name: string;
  /** Importer subsystem directories the rule constrains. */
  importerDirs: readonly string[];
  /** Subsystems the constrained importers must not import. */
  imported: readonly string[];
};

const RULES: readonly LayerRule[] = [
  {
    name: "experience-top",
    importerDirs: [
      "agents", "capabilities", "context", "coordination", "execution",
      "governance", "models", "operations", "planning", "runtime-state", "session",
    ],
    imported: ["interfaces"],
  },
  {
    name: "state-foundational",
    importerDirs: ["runtime-state"],
    imported: ["agents", "capabilities", "coordination", "execution", "planning"],
  },
  {
    name: "models-foundational",
    importerDirs: ["models"],
    imported: ["governance"],
  },
];

type AllowEntry = {
  rule: string;
  importer: string;
  imported: string;
  reason: string;
  removalPhase: string;
};

type Violation = { rule: string; importer: string; imported: string };

function toPosix(p: string): string {
  return p.split("\\").join("/");
}

function normalizeRepo(p: string): string {
  return toPosix(p).replace(/^\.\//, "");
}

function walkTs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
}

const IMPORT_RE = /(^|\n)\s*import\s+(type\s+)?([^;]*?)\s*from\s+["']([^"']+)["']/g;

/** Value imports between top-level subsystems that violate a layer rule. */
function scanLayerViolations(): Violation[] {
  const files: string[] = [];
  walkTs(SRC_ROOT, files);
  const found = new Map<string, Violation>();
  for (const file of files) {
    const importerTop = normalizeRepo(relative(SRC_ROOT, file)).split("/")[0];
    const content = readFileSync(file, "utf-8");
    const importer = normalizeRepo(relative(PROJECT_ROOT, file));
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(content)) !== null) {
      if (m[2] || /^\s*type\b/.test(m[3] ?? "")) continue; // import type
      const spec = m[4];
      if (!spec.startsWith(".")) continue;
      const resolved = relative(SRC_ROOT, resolve(dirname(file), spec));
      if (resolved.startsWith("..")) continue;
      const importedTop = resolved.split("/")[0];
      for (const rule of RULES) {
        if (rule.importerDirs.includes(importerTop) && rule.imported.includes(importedTop)) {
          found.set(`${rule.name}|${importer}|${importedTop}`, {
            rule: rule.name,
            importer,
            imported: importedTop,
          });
        }
      }
    }
  }
  return [...found.values()];
}

function loadAllowlist(): AllowEntry[] {
  const p = resolve(PROJECT_ROOT, "tests/architecture/layer-allowlist.json");
  return JSON.parse(readFileSync(p, "utf-8")) as AllowEntry[];
}

function key(v: { rule: string; importer: string; imported: string }): string {
  return `${v.rule}|${normalizeRepo(v.importer)}|${normalizeRepo(v.imported)}`;
}

describe("Layer boundaries", () => {
  it("allowlist entries are well-formed with R0 reference and removal phase", () => {
    const list = loadAllowlist();
    const ruleNames = new Set(RULES.map((r) => r.name));
    const seen = new Set<string>();
    for (const e of list) {
      assert.ok(ruleNames.has(e.rule), `unknown rule: ${e.rule}`);
      assert.ok(e.importer && e.imported, `entry needs importer+imported: ${e.rule}`);
      assert.ok(
        typeof e.reason === "string" && /R0\b/.test(e.reason),
        `entry lacks R0 reference: ${e.rule} ${e.importer} -> ${e.imported}`,
      );
      assert.ok(
        typeof e.removalPhase === "string" && /^R\d/.test(e.removalPhase),
        `entry lacks removal phase: ${e.rule} ${e.importer} -> ${e.imported}`,
      );
      const k = key(e);
      assert.ok(!seen.has(k), `duplicate allowlist entry: ${k}`);
      seen.add(k);
    }
  });

  it("no reverse-layer imports beyond the exact allowlist", () => {
    const actual = scanLayerViolations();
    const allowed = new Set(loadAllowlist().map(key));
    const fresh = actual
      .filter((v) => !allowed.has(key(v)))
      .sort((a, b) => key(a).localeCompare(key(b)));
    assert.deepEqual(
      fresh,
      [],
      `new reverse-layer import(s) outside allowlist:\n${fresh.map((v) => `  ${key(v)}`).join("\n")}`,
    );
  });

  it("allowlist is shrink-only: no stale entries", () => {
    const actual = new Set(scanLayerViolations().map(key));
    const stale = loadAllowlist().map(key).filter((k) => !actual.has(k)).sort();
    assert.deepEqual(
      stale,
      [],
      `stale allowlist entr(ies) — violation gone, remove entry:\n${stale.map((k) => `  ${k}`).join("\n")}`,
    );
  });
});
