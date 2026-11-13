import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { areaFor, baseBranchOf, declaredAreas, scopeRationale, validatePrScope } from "../../scripts/check-pr-scope.mjs";

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
    validatePrScope({
      files: ["package.json", "pnpm-lock.yaml", ".nvmrc", "scripts/preflight.mjs"],
      body: "Scope: scripts",
    }),
    [],
  );
});

test("shared metadata alone still needs a declaration", () => {
  // Metadata does not add an area, but it does not supply the declaration either.
  // Pure metadata is not "an undeclared area" — it is not reviewable content at
  // all, and the empty-diff verdict says so rather than inventing a scope demand.
  assert.ok(
    validatePrScope({ files: ["package.json", "pnpm-lock.yaml"] }).some((e) => /no scoped files/.test(e)),
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

test("a remote-qualified main base is main, not a different branch", () => {
  // CI diffs `origin/main`. Comparing the raw ref to `main` failed every PR the
  // moment the check stopped being run by hand.
  assert.equal(baseBranchOf("origin/main"), "main");
  assert.equal(baseBranchOf("upstream/main"), "main");
  assert.equal(baseBranchOf("main"), "main");
  assert.deepEqual(
    validatePrScope({ base: "origin/main", files: ["scripts/a.mjs"], body: "Scope: scripts" }),
    [],
  );
});

test("an undeclared diff is not a pass, however focused", () => {
  // Silence used to skip the coverage loop entirely, so any diff of three areas
  // or fewer passed with no statement of scope. CONTRIBUTING says the check
  // "fails when a touched area is undeclared"; with no declaration every area
  // is undeclared, so the only honest verdict is a failure.
  const errors = validatePrScope({ files: ["src/governance/a.ts", "src/governance/b.ts", "package.json"] });
  assert.ok(errors.some((e) => /no declared scope/.test(e) && /src\/governance/.test(e)));
});

test("one focused area passes when declared", () => {
  assert.deepEqual(
    validatePrScope({
      files: ["src/governance/a.ts", "src/governance/b.ts", "package.json"],
      body: "Scope: src/governance",
    }),
    [],
  );
});

test("up to three declared areas need no explanation", () => {
  assert.deepEqual(validatePrScope({ files: ["scripts/a.mjs", "docs/x.md"], body: "Scope: scripts, docs" }), []);
  assert.deepEqual(
    validatePrScope({
      files: ["scripts/a.mjs", "docs/x.md", "tests/y.test.ts"],
      body: "Scope: scripts, docs, tests",
    }),
    [],
  );
});

test("the undisclosed third area still fails at three areas", () => {
  assert.ok(
    validatePrScope({ files: ["scripts/a.mjs", "docs/x.md"], body: "Scope: scripts" }).some((e) =>
      /touched `docs`/.test(e),
    ),
  );
});

test("a broad diff must state a reason, not just declare its areas", () => {
  const files = ["scripts/a.mjs", "docs/x.md", "tests/y.test.ts", "src/agents/z.ts"];
  const bare = validatePrScope({ files, body: "Scope: scripts, docs, tests, src/agents" });
  assert.ok(bare.some((e) => /spans 4 areas/.test(e) && /states no reason/.test(e)));

  const explained = validatePrScope({
    files,
    body: "Scope: scripts, docs, tests, src/agents\nBroad-scope: one contract sweep across the stack",
  });
  assert.deepEqual(explained, []);
});

test("the calibrated cap accepts repository history that legitimately spans many areas", () => {
  // Recent merged work spans 5 and 11 areas; a hard ceiling would have rejected
  // the repository's own history and taught authors to work around the check.
  const files = [
    "src/agents/a.ts", "src/capabilities/b.ts", "src/coordination/c.ts", "src/execution/d.ts",
    "src/governance/e.ts", "src/interfaces/f.ts", "src/operations/g.ts", "src/planning/h.ts",
    "src/runtime-state/i.ts", "docs/x.md", "tests/y.test.ts",
  ];
  assert.ok(
    validatePrScope({ files, declared: ["src/agents", "src/capabilities", "src/coordination", "src/execution", "src/governance", "src/interfaces", "src/operations", "src/planning", "src/runtime-state", "docs", "tests"] }).some((e) => /spans 11 areas/.test(e)),
    "an unexplained sweep still fails",
  );
  const declarations = files.map((f) => areaFor(f)).filter((a) => a !== "shared");
  assert.deepEqual(
    validatePrScope({ files, declared: declarations, body: "Broad-scope: subsystem contract rollout" }),
    [],
  );
});

test("a declaration must cover every touched area", () => {
  const errors = validatePrScope({
    files: ["scripts/a.mjs", "docs/x.md"],
    body: "Scope: scripts",
  });
  assert.ok(errors.some((e) => /touched `docs` but the PR declares only `scripts`/.test(e)));
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

test("prose that names the checker is not a declaration", () => {
  // A bare `\bscope\b` match read `check-pr-scope.mjs` as
  // `Scope: scripts/check-pr-scope.mjs` (a hyphen is a word boundary), so every
  // PR describing this feature declared a bogus area and failed coverage.
  assert.deepEqual(declaredAreas("- Adds a PR scope verdict (`check-pr-scope.mjs` + step): base must be main"), []);
  assert.deepEqual(declaredAreas("- The one-PR rule is enforced as a **scope verdict**. No live check"), []);
  assert.deepEqual(declaredAreas("the declared `**Scope:**` areas must cover every touched area"), []);
  assert.deepEqual(declaredAreas("pre-push hook install, and the PR scope check —"), []);
  assert.deepEqual(declaredAreas("**Areas:** `scripts/a.mjs`, `docs/b.md`"), []);
});

test("a scope rationale is read from its own label", () => {
  assert.equal(scopeRationale("**Broad-scope:** contract sweep"), "contract sweep");
  assert.equal(scopeRationale("no reason given"), "");
  assert.equal(scopeRationale("**Broad-scope:** <!-- template -->"), "");
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

test("the CLI entrypoint runs from a path that needs percent-encoding", () => {
  // `new URL("file://" + process.argv[1])` throws on a `%` in the path, so the
  // guard never matched and the script silently did nothing while exiting 0.
  // That is the worst shape for a check: a green run that performed no check.
  const dir = mkdtempSync(join(tmpdir(), "alix scope 100% "));
  try {
    const script = join(dir, "check-pr-scope.mjs");
    copyFileSync(new URL("../../scripts/check-pr-scope.mjs", import.meta.url), script);
    const diff = join(dir, "changed.txt");
    writeFileSync(diff, "scripts/a.mjs\n");
    const result = spawnSync(process.execPath, [script, "--diff-file", diff], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PR_BODY: "Scope: scripts" },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PR scope OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
