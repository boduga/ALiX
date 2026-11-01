#!/usr/bin/env node
/**
 * check-staleness.mjs — detect references that no longer describe the tree.
 *
 * The failure this exists to catch is not a broken link. It is a document or a
 * policy file that still *asserts* something true when it was written and false
 * now, with nothing to notice the difference:
 *
 *   - `security/audit-exceptions.json` carried an exception for `vite` long
 *     after the advisory was fixed, and three entries that matched no advisory
 *     at all. The file read as if it covered real exposure.
 *   - Both supply-chain policy files referenced a `$schema` under
 *     `security/schemas/` that did not exist, so the reference implied live
 *     schema validation that never ran.
 *   - A doc named `security/doctor.ts`; the real path is
 *     `src/interfaces/cli/commands/security/doctor.ts`.
 *
 * All three are offline-checkable. This script checks them and nothing that
 * needs the network, so it can run in the git-only CI lane next to
 * `check-dox-claims.mjs`.
 *
 * Checks
 *   1. Local `$schema` references resolve to a file in this repository.
 *   2. Policy documents conform to the schema they declare (key, required, and
 *      date shape only — not a JSON Schema implementation).
 *   3. Paths named in AGENTS.md / README.md / CONTEXT.md / docs/security resolve
 *      (root-relative, doc-relative, or compiled-vs-source spelling).
 *   4. Exception entries are structurally matchable (id or package present,
 *      no duplicate ids).
 *
 * Deliberately NOT checked here: exception expiry. That is a policy verdict
 * owned by `checkExceptionsPolicy` in the supply-chain gate, and duplicating it
 * would make two places disagree. Advisory *matching* likewise needs a live
 * audit, so it belongs to `runExceptionsCheck`, not this script.
 *
 * Usage:
 *   node scripts/check-staleness.mjs [--json] [--root <dir>]
 *
 * Exit codes: 0 clean, 1 findings, 2 invocation error.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, extname, relative } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directories never walked. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".alix",
  ".gitnexus",
  ".ua",
  ".opensrc",
  "tmp",
]);

/**
 * Documentation that is deliberately historical. A superseded plan describing
 * `minimatch` intersection in 2026-06 is correct as history; rewriting it would
 * destroy the record. Excluded by design, not by oversight.
 */
const HISTORICAL_PREFIXES = ["docs/superseded/", "docs/superpowers/plans/archived/"];

/** Extensions that make a backticked token a path candidate. */
const PATH_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".md", ".sh", ".sql", ".toml", ".css", ".html",
]);

/** Files whose inline-code spans are treated as path claims. */
const DOC_GLOBS = [
  /^README\.md$/,
  /^CONTEXT\.md$/,
  /(^|\/)AGENTS\.md$/,
  /^docs\/security\/.*\.md$/,
];

/**
 * Top-level directories of this repository. A backticked token is treated as a
 * root-relative path claim only when its first segment is one of these.
 *
 * Without this, `runtime-state/storage/AGENTS.md` (a suffix of
 * `src/runtime-state/...`) and `head.json` (a runtime artifact) read as broken
 * repo paths. The check should catch claims that are wrong, not fragments that
 * were never absolute.
 */
const TOP_LEVEL_DIRS = new Set([
  "src", "tests", "scripts", "docs", "security", "packages",
  "benchmark", "experiments", ".github",
]);


// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const root = (() => {
  const i = process.argv.indexOf("--root");
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : process.cwd();
})();

const jsonMode = process.argv.includes("--json");

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const rel = (p) => relative(root, p).split("\\").join("/");

function isHistorical(relPath) {
  return HISTORICAL_PREFIXES.some((p) => relPath.startsWith(p));
}

// ---------------------------------------------------------------------------
// Check 1 — local $schema references resolve
// ---------------------------------------------------------------------------

const ALIX_RAW_PREFIX = /^https?:\/\/raw\.githubusercontent\.com\/boduga\/ALiX\/[^/]+\/(.+)$/;

/**
 * Resolve a document's `$schema` to a repository-relative path, or null when it
 * points at an external schema we do not own.
 */
function resolveLocalSchema(doc) {
  const ref = doc && typeof doc === "object" ? doc.$schema : undefined;
  if (typeof ref !== "string") return null;
  if (ALIX_RAW_PREFIX.test(ref)) return ref.match(ALIX_RAW_PREFIX)[1];
  if (!ref.includes("://") && !ref.startsWith("#")) return ref;
  return null;
}

function checkSchemaRefs(files) {
  const findings = [];
  for (const f of files) {
    if (extname(f) !== ".json") continue;
    const relPath = rel(f);
    if (isHistorical(relPath)) continue;

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(f, "utf-8"));
    } catch {
      continue; // malformed JSON is another check's problem
    }
    const target = resolveLocalSchema(parsed);
    if (!target) continue; // external schema (json-schema.org, schemastore, ...)

    if (!existsSync(join(root, target))) {
      findings.push({
        check: "schema-ref",
        file: relPath,
        detail: `$schema points at ${target}, which does not exist in this repository`,
        reference: parsed.$schema,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 2 — policy documents conform to the schema they declare
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Key/required/date shape only. This is not a JSON Schema implementation and
 * makes no claim to be one: it reads the schema's `properties`, `required`,
 * `additionalProperties`, and `format: "date"`, and ignores everything else
 * (`enum`, `minimum`, `minLength`, ...). That subset is enough to catch the
 * failure that matters here — a policy file that drifted away from the schema
 * it advertises, so the schema quietly stopped describing it.
 *
 * Only applied when the schema sets `additionalProperties: false`, i.e. the
 * author declared the shape closed and intends it to be enforced.
 */
function conformObject(doc, schema, where, findings, file) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    findings.push({ check: "schema-conformance", file, detail: `${where} is not an object` });
    return;
  }
  const props = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of Object.keys(doc)) {
    if (!(key in props)) {
      findings.push({
        check: "schema-conformance",
        file,
        detail: `${where} has key \`${key}\`, which the schema does not declare`,
      });
    }
  }
  for (const key of required) {
    if (!(key in doc)) {
      findings.push({
        check: "schema-conformance",
        file,
        detail: `${where} is missing required key \`${key}\``,
      });
    }
  }
  for (const [key, spec] of Object.entries(props)) {
    if (!(key in doc)) continue;
    const value = doc[key];
    if (
      spec.format === "date" &&
      typeof value === "string" &&
      (!DATE_RE.test(value) || Number.isNaN(new Date(value).getTime()))
    ) {
      findings.push({
        check: "schema-conformance",
        file,
        detail: `${where}.${key} is \`${value}\`, which is not a valid ISO date (YYYY-MM-DD)`,
      });
    }
    if (spec.type === "object" && spec.additionalProperties === false) {
      conformObject(value, spec, `${where}.${key}`, findings, file);
    }
    if (spec.type === "array" && spec.items && spec.items.additionalProperties === false) {
      if (!Array.isArray(value)) {
        findings.push({ check: "schema-conformance", file, detail: `${where}.${key} is not an array` });
        continue;
      }
      value.forEach((item, i) => conformObject(item, spec.items, `${where}.${key}[${i}]`, findings, file));
    }
  }
}

function checkSchemaConformance(files) {
  const findings = [];
  for (const f of files) {
    if (extname(f) !== ".json") continue;
    const relPath = rel(f);
    if (isHistorical(relPath)) continue;

    let doc;
    try {
      doc = JSON.parse(readFileSync(f, "utf-8"));
    } catch {
      continue;
    }
    const target = resolveLocalSchema(doc);
    if (!target) continue;

    const schemaPath = join(root, target);
    if (!existsSync(schemaPath)) continue; // checkSchemaRefs already reports this

    let schema;
    try {
      schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    } catch (err) {
      findings.push({
        check: "schema-conformance",
        file: relPath,
        detail: `declared schema ${target} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (schema.additionalProperties !== false) continue; // shape not declared closed
    conformObject(doc, schema, "document", findings, relPath);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 3 — paths named in docs resolve
// ---------------------------------------------------------------------------

/** Strip fenced code blocks so example snippets are not read as claims. */
function stripFences(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}

function isPathCandidate(token) {
  if (!token || token.length > 200) return false;
  if (/[\s<>|*=(){}[\]$"']/.test(token)) return false;
  if (token.includes("://") || token.startsWith("#") || token.startsWith("-")) return false;
  if (token.includes("\\")) return false;
  // Absolute, home-relative and temp paths name host locations, not repo files.
  if (token.startsWith("/") || token.startsWith("~") || token.includes("~")) return false;

  const ext = extname(token);
  if (!PATH_EXTENSIONS.has(ext)) return false;

  // Only root-relative claims. A bare filename is too ambiguous to check: it may
  // legitimately name a user config file (`settings.yml`), a runtime artifact
  // (`head.json`), or a file inside the current directory.
  if (!token.includes("/")) return false;
  const first = token.split("/")[0];
  return TOP_LEVEL_DIRS.has(first);
}

function resolves(token, docDir) {
  // 1. repository-root relative
  if (existsSync(join(root, token))) return true;

  // 2. relative to the document's own directory
  if (existsSync(join(docDir, token))) return true;

  // 3. compiled-vs-source spelling: docs often cite `tests/x.test.js` while the
  //    repository holds `tests/x.test.ts`, or cite a dist path.
  const ext = extname(token);
  if (ext === ".js" || ext === ".jsx") {
    const swapped = token.slice(0, -ext.length) + (ext === ".js" ? ".ts" : ".tsx");
    if (existsSync(join(root, swapped)) || existsSync(join(docDir, swapped))) return true;
    if (existsSync(join(root, "dist", token))) return true;
  }

  return false;
}

function checkDocPaths(files) {
  const findings = [];
  for (const f of files) {
    const relPath = rel(f);
    if (isHistorical(relPath)) continue;
    if (!DOC_GLOBS.some((re) => re.test(relPath))) continue;

    let text;
    try {
      text = stripFences(readFileSync(f, "utf-8"));
    } catch {
      continue;
    }

    const docDir = dirname(f);
    const seen = new Set();
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1].trim();
      if (!isPathCandidate(token) || seen.has(token)) continue;
      seen.add(token);
      if (!resolves(token, docDir)) {
        findings.push({
          check: "doc-path",
          file: relPath,
          detail: `references \`${token}\`, which does not resolve from the repository root or the document directory`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 4 — exception entries are structurally matchable
// ---------------------------------------------------------------------------

function checkExceptionShape(files) {
  const findings = [];
  const path = join(root, "security/audit-exceptions.json");
  if (!existsSync(path)) {
    return [{ check: "exceptions", file: "security/audit-exceptions.json", detail: "file is missing" }];
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    return [{
      check: "exceptions",
      file: "security/audit-exceptions.json",
      detail: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }];
  }

  const entries = Array.isArray(doc?.advisories) ? doc.advisories : null;
  if (!entries) {
    return [{
      check: "exceptions",
      file: "security/audit-exceptions.json",
      detail: "has no `advisories` array",
    }];
  }

  const seen = new Map();
  entries.forEach((e, i) => {
    const label = e?.id ?? e?.package ?? `#${i}`;
    // An entry with neither key can never match an audit finding, so it is
    // inert: it looks like coverage and provides none.
    if (!e?.id && !e?.package) {
      findings.push({
        check: "exceptions",
        file: "security/audit-exceptions.json",
        detail: `entry ${label} has neither \`id\` nor \`package\` and can never match an advisory`,
      });
    }
    const key = e?.id ?? e?.package;
    if (key) {
      if (seen.has(key)) {
        findings.push({
          check: "exceptions",
          file: "security/audit-exceptions.json",
          detail: `duplicate entry for \`${key}\` (indexes ${seen.get(key)} and ${i})`,
        });
      } else {
        seen.set(key, i);
      }
    }
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const files = walk(root);

  const findings = [
    ...checkSchemaRefs(files),
    ...checkSchemaConformance(files),
    ...checkDocPaths(files),
    ...checkExceptionShape(files),
  ];

  if (jsonMode) {
    console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  } else {
    console.log(
      `Staleness audit: ${files.length} file(s) walked, ${findings.length} stale reference(s)\n`
    );
    for (const f of findings) {
      console.log(`  [${f.check}] ${f.file}`);
      console.log(`      ${f.detail}`);
      if (f.reference) console.log(`      reference: ${f.reference}`);
    }
    if (findings.length > 0) {
      console.log(
        "\nA reference that no longer describes the tree is worse than a missing one:\n" +
          "it reads as coverage that does not exist. Fix the reference, or move the\n" +
          "document to docs/superseded/ if it is deliberately historical."
      );
    } else {
      console.log("OK: every checked reference resolves.");
    }
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

main();
