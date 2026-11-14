#!/usr/bin/env node
/**
 * preflight.mjs — one command that answers "did the basics actually run?"
 *
 * The dev loop's real failure is not a red check; it is a review that assumes
 * the checks ran. This runs them, in one place, and reports three outcomes:
 *
 *   pass         the check ran and succeeded
 *   fail         the check ran and found a problem  (exit 1)
 *   not_checked  the check could NOT be performed, with the reason
 *
 * `not_checked` is never a pass. A green summary means every required check
 * really executed. A step that could not run is printed with the reason and
 * the run is still reported as incomplete, so silence never reads as coverage.
 *
 * Steps
 *   1. typecheck        tsc -p tsconfig.json --noEmit
 *   2. typecheck:unused tsc -p tsconfig.unused.json --noEmit
 *   3. affected tests   tests selected from the changed files (see below)
 *   4. check:dox        claims added by this branch resolve in this branch
 *   5. check:staleness  references still describe the tree
 *   6. check:evidence   provenance/order, pending-commit tolerant
 *
 * Affected-test selection is a HEURISTIC, and says so. It selects:
 *   - a test that lives at the mirrored path of a changed source file
 *   - a test whose basename matches a changed source file's basename
 *   - a test that imports the changed module (static or dynamic import)
 * Anything it cannot map is reported as an unselected-change count, so the
 * operator knows what the subset did not cover. `--full` runs both whole
 * suites instead, which is what CI does.
 *
 * Documentation-only changes (.md/.txt/.adoc/.rst/.log/.markdown) skip the
 * type checks and select no tests, per the repository's automatic-verification
 * contract. That is recorded as `skipped`, with the reason, not as a pass.
 *
 * Usage:
 *   node scripts/preflight.mjs [--base <ref>] [--full] [--json] [--verbose]
 *
 * `not_checked` is fail-closed: it exits non-zero because the run did not
 * establish the property it reports on. Only an explicit `skipped` (for an
 * intentional, documented case such as a docs-only change) is a non-failing
 * absence of work.
 *
 * Exit codes: 0 every check ran and passed, 1 a check failed or could not be
 * performed, 2 invocation error.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep, extname, basename } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("-") ? args[i + 1] : null;
};
const asJson = has("--json");
const verbose = has("--verbose");
const full = has("--full");

export const DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".adoc", ".rst", ".log"]);

/**
 * Every git call runs with replacement objects disabled.
 *
 * `git replace` makes a ref resolve to a commit nobody committed, so a local
 * replacement ref would let the change set describe a tree that is not the one
 * being pushed. Fail-closed means measuring real history, not the rewritten one.
 */
function git(argv) {
  return execFileSync("git", argv, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
  }).trim();
}

function tryGit(argv) {
  try {
    return git(argv);
  } catch {
    return null;
  }
}

export function resolveBase(requested) {
  const candidates = requested ? [requested] : ["origin/main", "main"];
  for (const candidate of candidates) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`])) return candidate;
  }
  return null;
}

/**
 * Whether HEAD has ancestors, i.e. whether there is committed branch work a
 * base-less run would not see. A root-only repository has no such work: its
 * uncommitted set really is the whole change set.
 */
export function hasHistoryBeyondRoot(gitRun = git) {
  // Unparseable output is not "no ancestors". `Number("")` is 0 and
  // `Number("abc")` is NaN; both compare false against 1, which would read as a
  // root-only repository and let the caller fall back to an uncommitted-only
  // diff. Refuse to answer instead of guessing, so the caller records the gap.
  const raw = gitRun(["rev-list", "--count", "HEAD"]).trim();
  // `git rev-list --count` answers with a non-negative decimal integer. Requiring
  // that shape rejects "", "abc", "1.5" and "-3" instead of letting Number()
  // coerce them into 0/NaN and read as a root-only repository.
  if (!/^\d+$/.test(raw)) {
    throw new Error(`git rev-list --count HEAD returned ${JSON.stringify(raw)}, which is not a commit count`);
  }
  return Number(raw) > 1;
}

/**
 * The change set for a resolved `base`, or `null` when no honest change set
 * exists. `changed === null` means "not checked", never "empty".
 *
 * A base-less run over a repository with ancestors has only the uncommitted
 * fragment, and reporting that fragment as the change set would let preflight
 * pass over committed branch work it never inspected. `gitRun` is injectable so
 * both the refusal and the root-only fallback are testable without a repository.
 */
export function resolveChangeSet(base, gitRun = git) {
  if (!base && hasHistoryBeyondRoot(gitRun)) return null;
  return changedFiles(base, gitRun);
}

/**
 * The `changed files` outcome for the report, or the gap.
 *
 * `record()` is module state, so testing the refusal through `main()` would mean
 * running the whole script against a repository that has to be made to answer
 * `rev-list --count` with something unparseable. This is the same decision,
 * pure and injectable, so the caller-level wiring is testable: a `null` change
 * set and a thrown read both become `not_checked`, never an empty PASS.
 */
export function resolveChangeSetOutcome(base, gitRun = git) {
  let changed;
  try {
    changed = resolveChangeSet(base, gitRun);
  } catch (error) {
    return { changed: null, status: "not_checked", detail: `could not read the change set: ${error.message}` };
  }
  if (changed === null) {
    return {
      changed: null,
      status: "not_checked",
      detail: "no base ref resolved (origin/main or main); committed branch work was not inspected — pass --base <ref>",
    };
  }
  return {
    changed,
    status: "pass",
    detail: base ? `${changed.length} file(s) vs ${base}` : `${changed.length} uncommitted file(s); no base ref resolved`,
  };
}

/**
 * The change set, or a thrown error. `gitRun` is injectable so the fail-closed
 * path can be tested without spawning git: every diff here is required input,
 * and a swallowed failure would shrink the set — possibly to nothing — and let
 * preflight pass over work it never inspected.
 *
 * Each diff carries `--ignore-submodules=none`. A `.gitmodules` `ignore = all`
 * entry is repository-controlled and hides every gitlink record, so a
 * submodule-pointer bump would vanish from the change set; a branch that is
 * otherwise docs-only then skips typecheck and tests while reporting PASS.
 * `-c diff.ignoreSubmodules=none` is not enough here either — `.gitmodules` is
 * read after configuration.
 */
export function changedFiles(base, gitRun = git) {
  const files = new Set();
  if (base) {
    const committed = gitRun(["diff", "--name-only", "--diff-filter=ACDMRTUXB", "--ignore-submodules=none", `${base}...HEAD`]);
    for (const line of committed.split("\n")) if (line.trim()) files.add(line.trim());
  }
  const working = gitRun(["diff", "--name-only", "--diff-filter=ACDMRTUXB", "--ignore-submodules=none", "HEAD"]);
  for (const line of working.split("\n")) if (line.trim()) files.add(line.trim());
  const staged = gitRun(["diff", "--name-only", "--cached", "--diff-filter=ACDMRTUXB", "--ignore-submodules=none"]);
  for (const line of staged.split("\n")) if (line.trim()) files.add(line.trim());
  const untracked = gitRun(["ls-files", "--others", "--exclude-standard"]);
  for (const line of untracked.split("\n")) if (line.trim()) files.add(line.trim());
  return [...files].sort();
}

// -- Test selection --------------------------------------------------------

export function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, out);
    else if (entry.isFile() && /\.(test|vitest)\.(ts|mjs|js)$/.test(entry.name)) out.push(fullPath);
  }
  return out;
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;

export function testSources(files) {
  return files.map((file) => {
    const text = readFileSync(file, "utf8");
    const specifiers = new Set();
    for (const match of text.matchAll(IMPORT_RE)) specifiers.add(match[1]);
    return { file, repoPath: relative(ROOT, file).split(sep).join("/"), specifiers };
  });
}

/**
 * Select tests for the changed files. Returns { selected, unmapped } where
 * `unmapped` lists changed source files that no test could be tied to. The
 * caller reports unmapped as a coverage gap; it must not be read as "no test
 * needed".
 */
export function selectAffectedTests(changed, allTests) {
  const sources = changed.filter((f) => f.startsWith("src/") && f.endsWith(".ts"));
  const changedTests = changed.filter((f) => /^tests\/.*\.(test|vitest)\.(ts|mjs|js)$/.test(f));
  const selected = new Set(changedTests);

  if (!sources.length) return { selected: [...selected].sort(), unmapped: [] };

  const byBasename = new Map();
  // Mirrored-path lookup must key on the directory as well as the stem, and it
  // must hold every test at a key. Keyed on the bare stem, `tests/a/x.test.ts`
  // and `tests/b/x.test.ts` collided and the second silently replaced the
  // first, so a change to `src/b/x.ts` selected nothing at all.
  const byPath = new Map();
  for (const test of allTests) {
    const key = test.repoPath.replace(/^tests\//, "").replace(/\.(test|vitest)\.(ts|mjs|js)$/, "");
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(test);
    const stem = basename(test.repoPath).replace(/\.(test|vitest)\.(ts|mjs|js)$/, "");
    if (!byBasename.has(stem)) byBasename.set(stem, []);
    byBasename.get(stem).push(test);
  }

  const unmapped = [];
  for (const source of sources) {
    const stripped = source.replace(/\.ts$/, "");
    const stem = basename(stripped);
    const hits = new Set();
    for (const key of [stripped.replace(/^src\//, ""), stripped]) {
      for (const test of byPath.get(key) ?? []) hits.add(test.repoPath);
    }
    for (const test of byBasename.get(stem) ?? []) hits.add(test.repoPath);
    // Import-based: a test that names the module by path, relative or aliased.
    for (const test of allTests) {
      for (const specifier of test.specifiers) {
        const normalized = specifier.replace(/\.(js|ts)$/, "");
        if (normalized === stripped || normalized.endsWith(`/${stripped}`) || normalized.endsWith(`/${stem}`)) {
          hits.add(test.repoPath);
          break;
        }
        if (normalized.startsWith(".") && test.repoPath.startsWith("tests/")) {
          const resolved = resolve(ROOT, "tests", normalized.replace(/^\.\//, ""));
          if (relative(ROOT, resolved).split(sep).join("/") === stripped) {
            hits.add(test.repoPath);
            break;
          }
        }
      }
    }
    if (!hits.size) unmapped.push(source);
    for (const hit of hits) selected.add(hit);
  }
  return { selected: [...selected].sort(), unmapped };
}

/** dist holds compiled node tests; a missing or stale entry is not runnable. */
export function distReadiness(selected, changed, root = ROOT) {
  const missing = [];
  const stale = [];
  for (const test of selected) {
    // Only TypeScript node tests compile into dist. A .test.mjs file runs
    // straight from tests/ and is never a "missing build artifact".
    if (!test.endsWith(".test.ts")) continue;
    const dist = join(root, "dist", test.replace(/\.ts$/, ".js"));
    if (!existsSync(dist)) {
      missing.push(test);
      continue;
    }
    const testMtime = statSync(join(root, test)).mtimeMs;
    if (statSync(dist).mtimeMs < testMtime) stale.push(test);
  }
  for (const source of changed.filter((f) => f.startsWith("src/") && f.endsWith(".ts"))) {
    const dist = join(root, "dist", source.replace(/\.ts$/, ".js"));
    if (existsSync(dist) && statSync(dist).mtimeMs < statSync(join(root, source)).mtimeMs) {
      stale.push(source);
    }
  }
  return { missing, stale };
}

// -- Step runner -----------------------------------------------------------

const steps = [];

/**
 * Environment for every child step preflight spawns.
 *
 * Exported because the guard it carries is the thing under test: preflight's own
 * `git()` is guarded, which makes a child that reads git for itself look
 * protected when it is not. `check:dox` resolves the head tree and
 * `check:evidence` reads history, so both need the flag in their environment.
 */
export function stepEnv() {
  return { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", GIT_NO_REPLACE_OBJECTS: "1" };
}

function runStep(name, command, commandArgs, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    // Without `stepEnv()` here, `pnpm preflight` -- and therefore the pre-push
    // hook -- reported PASS over a claim resolved from a replacement tree.
    env: stepEnv(),
    maxBuffer: 1 << 28,
  });
  const durationMs = Date.now() - started;
  const stdout = result.stdout ?? "";
  const output = `${stdout}${result.stderr ?? ""}`.trim();
  // Always capture so a structured verdict can be read; --verbose only decides
  // whether the captured output is echoed as the step runs.
  if (verbose) process.stdout.write(`${stdout}${result.stderr ?? ""}`);
  const judged = options.classify ? options.classify(stdout, result.status ?? -1) : null;
  const step = {
    name,
    status: judged?.status ?? (result.status === 0 ? "pass" : "fail"),
    exitCode: result.status ?? -1,
    durationMs,
    output: output.split("\n").slice(-40).join("\n"),
    ...options,
    ...(judged?.detail ? { detail: judged.detail } : {}),
  };
  delete step.classify;
  steps.push(step);
  return step;
}

function record(name, status, detail) {
  steps.push({ name, status, detail, durationMs: 0 });
}

function pnpm(script) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return [executable, [script]];
}

/** Resolve a dev binary from node_modules/.bin so preflight never needs npx. */
function bin(name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const local = join(ROOT, "node_modules", ".bin", name + suffix);
  return existsSync(local) ? local : name;
}

// -- Report ----------------------------------------------------------------

/** The last `limit` lines, so a failure excerpt shows the error, not the setup. */
export function tailLines(text, limit = 12) {
  return String(text ?? "").split("\n").slice(-limit);
}

/**
 * A run is clean only when every check ran and passed. `not_checked` is an
 * unknown, not a quiet pass; it must fail closed.
 */
export function verdictOf(stepsToJudge) {
  const failures = stepsToJudge.filter((step) => step.status === "fail");
  const notChecked = stepsToJudge.filter((step) => step.status === "not_checked");
  return { failures, notChecked, ok: failures.length === 0 && notChecked.length === 0 };
}

/**
 * Read the evidence checker's structured verdict, not just its exit status.
 * `not_checked` now exits 1, so status alone would be *nearly* right — but the
 * verdict is still the authority: it distinguishes a bounded, acknowledged
 * declared-skip set from an unverified contract, and that distinction is not
 * encoded in an exit code.
 */
export function classifyEvidence(stdout, exitCode) {
  // Only a structured verdict can establish a pass. The checker is asked for
  // --json precisely so preflight can read its answer instead of inferring one
  // from an exit code. Unparseable output means the verdict is unknown, and an
  // unknown that happens to exit 0 is the exact shape of a check that never ran
  // reading as a pass.
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return {
      status: exitCode === 0 ? "not_checked" : "fail",
      detail: `evidence checker produced no JSON verdict (exit ${exitCode}); its output was not readable as a verdict`,
    };
  }
  if (!payload || typeof payload !== "object" || typeof payload.verdict !== "string") {
    return { status: "fail", detail: "evidence checker returned JSON without a string `verdict`" };
  }
  if (payload.verdict === "fail" || payload.verdict === "error") {
    return { status: "fail", detail: payload.error ?? `verdict ${payload.verdict}` };
  }
  if (payload.verdict === "not_checked") {
    return {
      status: "not_checked",
      detail: (payload.notChecked ?? []).join("; ") || "evidence contract was not fully verified",
    };
  }
  if (
    payload.verdict !== "pass" &&
    payload.verdict !== "pass_with_accepted" &&
    payload.verdict !== "pass_with_declared_skips"
  ) {
    return { status: "fail", detail: `evidence checker returned an unrecognized verdict \`${payload.verdict}\`` };
  }
  return { status: "pass", detail: payload.verdict };
}

function main() {
  const requestedBase = getArg("--base");
  const base = resolveBase(requestedBase);
  if (requestedBase && !base) {
    console.error(`preflight: --base '${requestedBase}' does not resolve to a commit.`);
    console.error("Refusing to fall back to an uncommitted-only diff: that would silently shrink the checks.");
    process.exit(2);
  }
  // No `--base` and no default base ref is only tolerable in a repository whose
  // HEAD has no ancestors. Otherwise the uncommitted set is a fragment of the
  // branch, and treating it as the change set would report PASS over committed
  // work that was never inspected. The change set is also the input to every
  // selection decision below, so a failure to read it is a recorded gap and a
  // non-green run — unknown is not empty.
  const changeSet = resolveChangeSetOutcome(base);
  const changed = changeSet.changed;
  record("changed files", changeSet.status, changeSet.detail);
  const onlyDocs = changed !== null && changed.length > 0 && changed.every((f) => DOC_EXTENSIONS.has(extname(f).toLowerCase()));

  if (changed === null) {
    record("typecheck", "not_checked", "change set unknown");
    record("typecheck:unused", "not_checked", "change set unknown");
    record("affected tests", "not_checked", "change set unknown");
  } else if (!onlyDocs) {
    const [tcCmd, tcArgs] = pnpm("typecheck");
    runStep("typecheck", tcCmd, tcArgs);
    const [unCmd, unArgs] = pnpm("typecheck:unused");
    runStep("typecheck:unused", unCmd, unArgs);
  } else {
    record("typecheck", "skipped", "documentation-only change (.md/.txt/.adoc/.rst/.log/.markdown)");
    record("typecheck:unused", "skipped", "documentation-only change");
  }

  if (changed === null) {
    // "affected tests" was already recorded as not_checked above.
  } else if (onlyDocs) {
    record("affected tests", "skipped", "documentation-only change selects no code tests");
  } else if (full) {
    const [nodeCmd, nodeArgs] = pnpm("test:node:ci");
    runStep("tests (node, full)", nodeCmd, nodeArgs);
    runStep("tests (vitest, full)", bin("vitest"), ["run", "--config", "vitest.config.mts"]);
  } else {
    const allTests = testSources(walk(join(ROOT, "tests")));
    const { selected, unmapped } = selectAffectedTests(changed, allTests);
    if (!selected.length) {
      record(
        "affected tests",
        "not_checked",
        unmapped.length
          ? `no test maps to ${unmapped.length} changed source file(s): ${unmapped.slice(0, 8).join(", ")}${unmapped.length > 8 ? ", …" : ""}`
          : "no changed source or test files",
      );
    } else {
      const { missing, stale } = distReadiness(selected, changed);
      if (missing.length || stale.length) {
        record(
          "affected tests",
          "not_checked",
          [
            missing.length ? `${missing.length} compiled test(s) missing from dist` : null,
            stale.length ? `${stale.length} file(s) newer than dist (build is stale)` : null,
            "run `pnpm build` first",
          ]
            .filter(Boolean)
            .join("; "),
        );
      } else {
        const compiledTests = selected
          .filter((f) => f.endsWith(".test.ts"))
          .map((f) => join(ROOT, "dist", f.replace(/\.ts$/, ".js")));
        const sourceTests = selected
          .filter((f) => f.endsWith(".test.mjs") || f.endsWith(".test.js"))
          .map((f) => join(ROOT, f));
        const nodeTests = [...compiledTests, ...sourceTests];
        const vitestTests = selected.filter((f) => f.endsWith(".vitest.ts"));
        if (nodeTests.length) {
          runStep("tests (node, affected)", process.execPath, ["--test", ...nodeTests], {
            detail: `${nodeTests.length} file(s)`,
          });
        }
        if (vitestTests.length) {
          runStep("tests (vitest, affected)", bin("vitest"), ["run", "--config", "vitest.config.mts", ...vitestTests], {
            detail: `${vitestTests.length} file(s)`,
          });
        }
      }
      if (unmapped.length) {
        record(
          "affected tests coverage",
          "not_checked",
          `${unmapped.length} changed source file(s) matched by no test: ${unmapped.slice(0, 8).join(", ")}${unmapped.length > 8 ? ", …" : ""}`,
        );
      }
    }
  }

  runStep("check:dox", process.execPath, ["scripts/check-dox-claims.mjs", ...(base ? ["--base", base] : [])]);
  runStep("check:staleness", process.execPath, ["scripts/check-staleness.mjs"]);
  runStep(
    "check:evidence",
    process.execPath,
    ["scripts/check-evidence-integrity.mjs", "--json", "--pending-commit-tolerant"],
    { classify: classifyEvidence },
  );

  const { failures, notChecked, ok } = verdictOf(steps);
  if (asJson) {
    console.log(JSON.stringify({ ok, base, changed, steps }, null, 2));
  } else {
    const icon = { pass: "PASS", fail: "FAIL", skipped: "SKIP", not_checked: "UNKNOWN" };
    console.log("");
    for (const step of steps) {
      const detail = step.detail ? ` — ${step.detail}` : "";
      const seconds = step.durationMs ? ` (${(step.durationMs / 1000).toFixed(1)}s)` : "";
      console.log(`  ${icon[step.status] ?? step.status.padEnd(7)}  ${step.name}${seconds}${detail}`);
      if (step.status === "fail" && step.output) {
        for (const line of tailLines(step.output)) console.log(`          ${line}`);
      }
    }
    console.log("");
    if (failures.length) {
      console.log(`Preflight FAILED: ${failures.length} check(s) red.`);
      for (const step of failures) console.log(`  - ${step.name}`);
    }
    if (notChecked.length) {
      console.log(`Preflight INCOMPLETE: ${notChecked.length} check(s) could not be performed:`);
      for (const step of notChecked) console.log(`  - ${step.name}: ${step.detail}`);
      console.log("This is not a clean preflight. Resolve each item above before treating the branch as verified.");
    }
    if (ok) console.log("Preflight OK — every check ran and passed.");
    console.log("");
  }
  process.exitCode = ok ? 0 : 1;
}

// `new URL("file://" + path)` breaks on Windows drive letters and on any path
// needing percent-encoding. pathToFileURL does the conversion the comparison
// actually needs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
