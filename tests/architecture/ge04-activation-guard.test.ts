/**
 * GE-04 activation quarantine: no production code may import the unqualified
 * native adapter (or its experimental authority/helpers), including via
 * require(), export-from, or a literal dynamic import().
 *
 * Changing this test is a security-gated activation decision, not a routine
 * integration refactor. The factory's runtime fail-closed contract is tested
 * separately in tests/execution/filesystem/ge04-activation-guard.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(ROOT, "src");
const forbidden = /(?:^|\/)linux-scoped-mutation(?:\.[cm]?[jt]s)?$|(?:^|\/)ge04-[^/]+(?:\.[cm]?[jt]s)?$/;

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}

function unsafeImports(source: string, _filename: string): string[] {
  // TypeScript 7 no longer exposes the compiler AST at the package root.
  // Match the literal module references used by standard ESM/CJS imports.
  // A future refactor to non-literal runtime loading needs explicit review.
  const errors: string[] = [];
  const importForms = [
    /\bimport\s*(?:[\s\S]*?\bfrom\s*)?["']([^"'\n]+)["']/g,
    /\bexport\s*[\s\S]*?\bfrom\s*["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  ];
  for (const pattern of importForms) {
    for (const match of source.matchAll(pattern)) {
      if (forbidden.test(match[1])) errors.push(`experimental import: ${match[1]}`);
    }
  }
  if (/\bnew\s+ExperimentalLinuxScopedMutationService\s*\(/.test(source)) {
    errors.push("experimental backend construction");
  }
  return errors;
}

test("all production TypeScript modules prohibit imports or instantiation of GE-04 experimental code", () => {
  const violations = listFiles(SRC).flatMap(file =>
    unsafeImports(readFileSync(file, "utf8"), file).map(error => `${relative(ROOT, file)}: ${error}`),
  );
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("activation guard catches static, dynamic, CommonJS and re-export bypasses", () => {
  const rejected = [
    'import { ExperimentalLinuxScopedMutationService } from "./linux-scoped-mutation.js";',
    'const backend = await import("./linux-scoped-mutation.js");',
    'const backend = require("./linux-scoped-mutation.js");',
    'export { foo } from "../filesystem/ge04-helper-integrity.js";',
    'new ExperimentalLinuxScopedMutationService("/tmp/helper", verifier);',
  ];
  for (const source of rejected) {
    assert.ok(unsafeImports(source, "synthetic.ts").length > 0, source);
  }
  assert.deepEqual(unsafeImports('import { createScopedMutationService } from "./scoped-mutation.js";', "synthetic.ts"), []);
});
