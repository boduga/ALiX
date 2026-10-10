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
 * Detection shares `freeze-utils.collectValueImportSpecifiers`, so it covers
 * static `import … from`, `export … from`, and dynamic `import(…)` — the same
 * value-edge universe R1 walks. Type-only forms are exempt.
 *
 * Rules (decidable boundaries from the R0 findings / register layer model):
 * - `experience-is-top`: the `interfaces` layer is command+display only; no
 *   other subsystem may value-import it. (Importer set derived from the live
 *   `src/` subsystems, minus `interfaces`.)
 * - `platform-not-upward`: `runtime-state` (truth/ledger/platform) must not
 *   import the domain layers `agents`/`capabilities`/`coordination`/
 *   `execution`/`planning`.
 * - `models-not-governance`: `models` (provider adapters) must not import
 *   `governance`, except the deliberate R5.1 outbound-redaction seam.
 *
 * Deliberately NOT modeled: `operations` (observability) is cross-cutting —
 * it both emits telemetry into other subsystems and reads their state to
 * measure. A single direction rule would misrepresent it ("observability
 * measures, controls nothing"), so it is left unconstrained here.
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
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowKey,
  collectValueImportSpecifiers,
  listSubsystemDirs,
  loadAllowlist,
  normalizeRepo,
  walkTs,
  type AllowEntry,
} from "./freeze-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// TS compiles tests/ → dist/tests/ so __dirname is dist/tests/architecture.
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const SUBSYSTEMS = listSubsystemDirs(SRC_ROOT);

type LayerRule = {
  name: string;
  /** Importer subsystem directories the rule constrains. */
  importerDirs: readonly string[];
  /** Subsystems the constrained importers must not import. */
  imported: readonly string[];
};

const RULES: readonly LayerRule[] = [
  {
    name: "experience-is-top",
    importerDirs: SUBSYSTEMS.filter((s) => s !== "interfaces"),
    imported: ["interfaces"],
  },
  {
    name: "platform-not-upward",
    importerDirs: ["runtime-state"],
    imported: ["agents", "capabilities", "coordination", "execution", "planning"],
  },
  {
    name: "models-not-governance",
    importerDirs: ["models"],
    imported: ["governance"],
  },
];

type LayerEdge = { rule: string; importer: string; imported: string };

/** Value imports between top-level subsystems that violate a layer rule. */
function scanLayerViolations(): LayerEdge[] {
  const files: string[] = [];
  walkTs(SRC_ROOT, files);
  const found = new Map<string, LayerEdge>();
  for (const file of files) {
    const importerTop = normalizeRepo(relative(SRC_ROOT, file)).split("/")[0];
    if (!SUBSYSTEMS.includes(importerTop)) continue; // skip root entrypoints (cli.ts, run.ts, …)
    const importer = normalizeRepo(relative(PROJECT_ROOT, file));
    for (const spec of collectValueImportSpecifiers(readFileSync(file, "utf-8"))) {
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

// Scan once — the walk reads ~1.4k files and every test consumes the result.
let cached: LayerEdge[] | undefined;
function violations(): LayerEdge[] {
  cached ??= scanLayerViolations();
  return cached;
}

function key(v: LayerEdge): string {
  return allowKey(v);
}

describe("Layer boundaries", () => {
  it("scanner observes cross-subsystem value edges (non-vacuous)", () => {
    // Guards against a silently broken scanner: if the walk/parse regresses to
    // zero edges, the allowlist tests below would pass without checking.
    assert.ok(
      violations().length >= 1,
      "layer scanner observed no cross-subsystem value imports — scanner is broken",
    );
  });

  it("allowlist entries are well-formed with R0 reference and removal phase", () => {
    const list: AllowEntry[] = loadAllowlist(PROJECT_ROOT, "layer-allowlist.json");
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
      const k = allowKey(e);
      assert.ok(!seen.has(k), `duplicate allowlist entry: ${k}`);
      seen.add(k);
    }
  });

  it("no reverse-layer imports beyond the exact allowlist", () => {
    const allowed = new Set(loadAllowlist(PROJECT_ROOT, "layer-allowlist.json").map(key));
    const fresh = violations()
      .filter((v) => !allowed.has(key(v)))
      .sort((a, b) => key(a).localeCompare(key(b)));
    assert.deepEqual(
      fresh,
      [],
      `new reverse-layer import(s) outside allowlist:\n${fresh.map((v) => `  ${key(v)}`).join("\n")}`,
    );
  });

  it("allowlist is shrink-only: no stale entries", () => {
    const actual = new Set(violations().map(key));
    const stale = loadAllowlist(PROJECT_ROOT, "layer-allowlist.json")
      .map(key)
      .filter((k) => !actual.has(k))
      .sort();
    assert.deepEqual(
      stale,
      [],
      `stale allowlist entr(ies) — violation gone, remove entry:\n${stale.map((k) => `  ${k}`).join("\n")}`,
    );
  });
});
