import assert from "node:assert/strict";
import { test } from "node:test";
import { areaFor, declaredAreas, validatePrScope } from "../../scripts/check-pr-scope.mjs";

test("classifies known areas and shared metadata", () => {
  assert.equal(areaFor("src/governance/security/x.ts"), "src/governance");
  assert.equal(areaFor("src/governance"), "src/governance");
  assert.equal(areaFor("./tests/preflight.test.ts"), "tests");
  assert.equal(areaFor("docs/security/AGENTS.md"), "docs");
  assert.equal(areaFor(".github/workflows/ci.yml"), ".github");
  assert.equal(areaFor("package.json"), "shared");
  assert.equal(areaFor("pnpm-lock.yaml"), "shared");
  assert.equal(areaFor("vendor/thing.js"), "unclassified");
});

test("checked-in hooks are tooling, not an unclassified path", () => {
  assert.equal(areaFor(".githooks/pre-push"), "scripts");
  assert.equal(areaFor(".githooks"), "scripts");
});

test("shared metadata never counts as an area", () => {
  assert.deepEqual(
    validatePrScope({ files: ["package.json", "pnpm-lock.yaml", ".nvmrc", "scripts/preflight.mjs"] }),
    [],
  );
});

test("an empty diff is reported, not silently accepted", () => {
  const errors = validatePrScope({ files: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nothing to review/);
});

test("unclassified paths fail with the offending files named", () => {
  const errors = validatePrScope({ files: ["scripts/a.mjs", "vendor/x.js", "misc/y.txt"] });
  assert.ok(errors.some((e) => /unclassified/.test(e) && /vendor\/x\.js/.test(e) && /misc\/y\.txt/.test(e)));
});

test("base must be main", () => {
  assert.ok(validatePrScope({ base: "release", files: ["scripts/a.mjs"] }).some((e) => /base must be main/.test(e)));
});

test("one focused area passes without a declared scope", () => {
  assert.deepEqual(validatePrScope({ files: ["src/governance/a.ts", "src/governance/b.ts", "package.json"] }), []);
});

test("undeclared multi-area diffs are limited to three areas", () => {
  const two = validatePrScope({ files: ["scripts/a.mjs", "docs/x.md"] });
  assert.deepEqual(two, []);
  const four = validatePrScope({ files: ["scripts/a.mjs", "docs/x.md", "tests/y.test.ts", "src/agents/z.ts"] });
  assert.ok(four.some((e) => /spans 4 areas/.test(e) && /limit is 3/.test(e)));
});

test("a declaration must cover every touched area", () => {
  const errors = validatePrScope({
    files: ["scripts/a.mjs", "docs/x.md"],
    body: "Scope: scripts",
  });
  assert.ok(errors.some((e) => /touched `docs` but the PR declares only `scripts`/.test(e)));
});

test("a declaration does not raise the three-area limit", () => {
  const errors = validatePrScope({
    files: ["scripts/a.mjs", "docs/x.md", "tests/y.test.ts", "src/agents/z.ts"],
    body: "Scope: scripts, docs, tests, src/agents",
  });
  assert.ok(errors.some((e) => /spans 4 areas/.test(e) && /limit is 3/.test(e)));
});

test("a small cross-cutting tooling change passes when it is declared", () => {
  assert.deepEqual(
    validatePrScope({
      files: ["scripts/preflight.mjs", "tests/scripts/preflight.test.mjs", ".github/workflows/ci.yml", ".githooks/pre-push"],
      body: "**Scope:** `scripts`, `tests`, `.github`",
    }),
    [],
  );
});

test("a declared scope covering the diff passes, including nested declaration", () => {
  assert.deepEqual(
    validatePrScope({ files: ["src/governance/security/a.ts"], body: "Scope: src/governance", maxAreas: 1 }),
    [],
  );
  assert.deepEqual(
    validatePrScope({ files: ["src/governance/security/a.ts"], body: "Scope: src/governance/security" }),
    [],
  );
});

test("declared areas parse inline and from Markdown variants", () => {
  assert.deepEqual(declaredAreas("Scope: scripts, docs"), ["scripts", "docs"]);
  assert.deepEqual(declaredAreas("**Scope:** `scripts`, `docs/`"), ["scripts", "docs"]);
  assert.deepEqual(declaredAreas("no scope here"), []);
  assert.deepEqual(declaredAreas(undefined), []);
});

test("the PR template comment is not a declared area", () => {
  const template = "**Change scope:** <!-- exact affected subsystem/files -->";
  assert.deepEqual(declaredAreas(template), []);

  const filled = [
    "**Scope:** `scripts`, `tests`, `.github`",
    "<!-- exact affected subsystem/files -->",
  ].join("\n");
  assert.deepEqual(declaredAreas(filled), ["scripts", "tests", ".github"]);
});

test("a multi-line HTML comment cannot leak into one declaration", () => {
  assert.deepEqual(declaredAreas("**Scope:** scripts\n<!-- a, b\nand c -->"), ["scripts"]);
});

test("explicit --declare values behave like a body declaration", () => {
  const errors = validatePrScope({ files: ["scripts/a.mjs", "docs/x.md"], declared: ["scripts"] });
  assert.ok(errors.some((e) => /touched `docs`/.test(e)));
});

test("a traversal-only diff still has to be classified", () => {
  assert.ok(validatePrScope({ files: ["../escape.json"] }).some((e) => /unclassified/.test(e)));
});
