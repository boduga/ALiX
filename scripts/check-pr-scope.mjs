#!/usr/bin/env node
/**
 * check-pr-scope.mjs — make "one PR, one declared area" a check, not a habit.
 *
 * CONTRIBUTING asks for one primary PR per feature and a focused diff. Both are
 * statements a reviewer has to remember. This converts them into a verdict:
 *
 *   1. BASE      the PR targets `main`.
 *   2. SCOPE     every changed path falls under a declared area, and the diff
 *                stays inside the declared set. "Declared" means either the PR
 *                body names its areas in a `Scope:` block, or the caller passes
 *                `--declare <area>` for each one.
 *   3. ONE-THING a diff spanning more than `--max-areas` top-level areas
 *                (default 3) must carry a `Broad-scope:` line stating why it is
 *                one change. The cap is a prompt for a stated decision, not a
 *                prohibition: recent merged work legitimately spans 5 and 11
 *                areas when it sweeps a contract across subsystems, so a hard
 *                ceiling here would reject the repository's own history and
 *                teach authors to work around the check.
 *
 * The point is not to make large PRs fail. It is to make a diff that touches
 * governance, evidence, TUI, and CI in one change say so out loud, instead of
 * arriving as "small cleanup". A declaration alone is not a reason: it says
 * where the diff goes, not why it belongs together.
 *
 * Usage (CI):
 *   PR_BASE_REF=main PR_BODY="$(cat body.md)" \
 *     node scripts/check-pr-scope.mjs --diff-file changed.txt
 *
 * Usage (local):
 *   node scripts/check-pr-scope.mjs --base main --declare src/governance
 *
 * Exit codes: 0 in scope, 1 out of scope, 2 invocation error.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The area list is the repository's real top-level shape, not a memory of it.
 *
 * It previously named `src/config` and `src/utils` (neither exists) while
 * omitting `src/context`, `src/models`, `src/session`, the four root `src/*.ts`
 * modules, and every non-`src` top-level directory. A legitimate PR touching
 * any of those failed as `unclassified` — the check rejected the repository's
 * own tree. `tests/scripts/check-pr-scope.test.mjs` now derives the expected
 * set from `git ls-files`, so adding a top-level directory without classifying
 * it fails a test instead of failing an author.
 */
export const AREAS = [
  "src/governance",
  "src/coordination",
  "src/agents",
  "src/execution",
  "src/capabilities",
  "src/runtime-state",
  "src/interfaces",
  "src/operations",
  "src/planning",
  "src/context",
  "src/models",
  "src/session",
  "src/entry",
  "tests",
  "scripts",
  "docs",
  "native",
  "packages",
  "benchmark",
  "bench",
  "examples",
  "experiments",
  "fixtures",
  "prompts",
  "skills",
  "stories",
  "security",
  "alix-saas-site",
  "bin",
  ".github",
  ".agents",
  ".superpowers",
  ".opensrc",
  ".tmp",
];

/**
 * Root files that any single area is allowed to touch as supporting metadata.
 *
 * Kept explicit rather than "everything at the root": a root file is either
 * shared metadata every area may touch, or a path that belongs to an area and
 * must be named. `/^[^/]+$/` would silently exempt any new root file from
 * review scope, which is the blind spot this list exists to prevent.
 */
export const SHARED_PATHS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "skills-lock.json",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "CONTEXT.md",
  "WORKSPACE_MAP.md",
  "TASK_SPECIFICATION.md",
  "LICENSE",
  "tsconfig.json",
  "tsconfig.tests.json",
  "tsconfig.tui.json",
  "tsconfig.tui-only.json",
  "tsconfig.unused.json",
  "vitest.config.mts",
  "vitest.config.skills.mts",
];

/**
 * Root files that carry an area's own content and must be declared as it.
 *
 * `src/*.ts` at the root of `src` is the process entry surface (`cli`, `run`,
 * `index`) plus the shared task taxonomy. It is one area and it is not
 * supporting metadata: a change there is a change to the executable entry.
 *
 * The area is `src/entry`, not `src`: a bare `src` area would make
 * `Scope: src` a blanket declaration over all fourteen subsystems, which is
 * exactly the coarsening the declaration check refuses.
 */
export const ROOT_FILES = {
  "src/cli.ts": "src/entry",
  "src/index.ts": "src/entry",
  "src/run.ts": "src/entry",
  "src/task-classifier.ts": "src/entry",
  "src/README.md": "src/entry",
  // Root-level operator tooling; `bin/` is already its own area, so only the
  // loose root scripts need an explicit home here.
  ".work-tiers.mjs": "scripts",
  // The workbench parity reference image. It is cited from `docs/superpowers/`
  // designs, so it travels with the documentation that describes it.
  "ALiX Workbench Terminal Preview.png": "docs",
};

/** Paths that belong to an existing area but are not named after it. */
export const AREA_ALIASES = {
  ".githooks": "scripts",
};

/**
 * Undo git's C-style path quoting.
 *
 * `git diff --name-only` wraps any path containing a non-ASCII byte in double
 * quotes and escapes the bytes (`"docs/superseded/.../if\303\241-mas-...md"`).
 * Reading the opening quote as part of the first path segment classified the
 * file `unclassified`, so a PR touching one non-ASCII filename failed for a
 * reason that had nothing to do with its content. Only the quoted form is
 * decoded; anything else is returned unchanged so a real leading quote is
 * still treated as a path segment.
 */
export function unquoteGitPath(path) {
  const value = String(path ?? "");
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value;
  const body = value.slice(1, -1);
  // Escapes denote BYTES, and a non-ASCII path arrives as one octal escape per
  // UTF-8 byte. Mapping each escape to a JS character would produce mojibake;
  // collecting bytes and decoding once produces the path git actually holds.
  const bytes = [];
  const simple = { "\\": 0x5c, '"': 0x22, a: 0x07, b: 0x08, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b };
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = body[i + 1];
    if (next && /[0-7]/.test(next)) {
      bytes.push(parseInt(body.slice(i + 1, i + 4), 8));
      i += 3;
      continue;
    }
    if (next && Object.hasOwn(simple, next)) {
      bytes.push(simple[next]);
      i += 1;
      continue;
    }
    bytes.push(0x5c);
  }
  return Buffer.from(bytes).toString("utf8");
}

export function areaFor(path) {
  const normalized = unquoteGitPath(path).replace(/\\/g, "/").replace(/^\.\//, "");
  if (SHARED_PATHS.includes(normalized)) return "shared";
  if (Object.hasOwn(ROOT_FILES, normalized)) return ROOT_FILES[normalized];
  for (const [prefix, area] of Object.entries(AREA_ALIASES)) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return area;
  }
  const match = AREAS.find((area) => normalized === area || normalized.startsWith(`${area}/`));
  return match ?? "unclassified";
}

/**
 * Reduce a PR-body line to `label: value` form before matching.
 *
 * Matching a bare `\bscope\b` anywhere in a line read `scripts/check-pr-scope.mjs`
 * (a hyphen is a word boundary) as a `Scope:` declaration, so every PR that
 * named the checker declared a bogus area and failed coverage. Matching a label
 * and a colon is the honest rule: prose mentions, headings, the unfilled
 * template comment, and the `Areas:` line are not declarations.
 *
 * Emphasis is stripped here rather than in the patterns, because `**Scope:**`
 * puts the colon *inside* the bold, and `**Change scope:**` too.
 */
function labeled(line) {
  const flat = line
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat;
}

/** A declaration label. `Broad-scope:` is deliberately not one of these. */
const DECL_LABEL = /^(?:(?:change|diff|pr|pull request)\s+)?scope\s*:\s*(.*)$/i;

/** The label that carries a stated reason for a broad diff. */
const RATIONALE_LABEL = /^(?:broad[- ]scope|scope[- ]rationale)\s*:\s*(.*)$/i;

/** Parse `Scope: a, b` (or a `## Scope` list) out of a PR body. */
export function declaredAreas(body) {
  if (!body) return [];
  const areas = new Set();
  for (const rawLine of String(body).split("\n")) {
    const label = DECL_LABEL.exec(labeled(rawLine));
    if (!label) continue;
    for (const piece of label[1].split(/[,;]/)) {
      const cleaned = piece.trim().replace(/\/+$/, "").trim();
      if (cleaned) areas.add(cleaned);
    }
  }
  return [...areas];
}

/**
 * A broad diff must volunteer a reason rather than slope through under a
 * declared list. Presence is verifiable; quality is the reviewer's judgement.
 */
export function scopeRationale(body) {
  if (!body) return "";
  for (const rawLine of String(body).split("\n")) {
    const label = RATIONALE_LABEL.exec(labeled(rawLine));
    if (!label) continue;
    const text = label[1].trim();
    if (text) return text;
  }
  return "";
}

/**
 * Reduce a git ref to the branch name the verdict is about. CI diffs against
 * `origin/main`; comparing that raw string to `main` failed every PR the moment
 * the check stopped being run by hand.
 */
export function baseBranchOf(ref) {
  return String(ref ?? "").replace(/^(?:origin|upstream)\//, "");
}

/**
 * @param {{base: string, files: string[], body?: string, declared?: string[], maxAreas?: number}} input
 * @returns {string[]} errors
 */
export function validatePrScope({ base = "main", files = [], body = "", declared = [], maxAreas }) {
  const errors = [];
  const branch = baseBranchOf(base);
  if (branch !== "main") {
    errors.push(`PR base must be main, not \`${branch}\` (approved dependency stacks require a separate exception)`);
  }

  const declaredSet = new Set([...declaredAreas(body), ...declared].map((d) => d.replace(/\/$/, "")));
  if (maxAreas !== undefined && !(Number.isInteger(maxAreas) && maxAreas > 0)) {
    // `scoped.length > NaN` is always false, so an unparseable limit silently
    // disabled both the cap and the rationale requirement. Refuse it instead.
    errors.push(`--max-areas must be a positive integer, got \`${maxAreas}\``);
    return errors;
  }
  const limit = maxAreas ?? 3;

  const touched = new Map();
  for (const file of files) {
    const area = areaFor(file);
    if (area === "shared") continue;
    if (!touched.has(area)) touched.set(area, []);
    touched.get(area).push(file);
  }

  if (!touched.size) {
    errors.push("the diff changes no scoped files — nothing to review, or the diff was not computed");
    return errors;
  }

  const unclassified = touched.get("unclassified") ?? [];
  if (unclassified.length) {
    errors.push(
      `unclassified path(s) — add a top-level area or move the file: ${unclassified.slice(0, 5).join(", ")}` +
        (unclassified.length > 5 ? `, and ${unclassified.length - 5} more` : ""),
    );
  }

  if (!declaredSet.size) {
    // Silence must not be a way through. An absent declaration used to skip the
    // whole coverage loop, so any diff of three areas or fewer passed with no
    // statement of scope at all — the exact habit this check exists to replace.
    errors.push(
      `no declared scope — add a \`**Scope:**\` line naming the top-level areas this PR touches` +
        ` (${[...touched.keys()].join(", ")})`,
    );
  } else {
    for (const area of touched.keys()) {
      if (area === "unclassified") continue;
      const covered = [...declaredSet].some((d) => area === d || area.startsWith(`${d}/`) || d.startsWith(`${area}/`));
      if (!covered) {
        errors.push(`touched \`${area}\` but the PR declares only ${[...declaredSet].map((d) => `\`${d}\``).join(", ")} — declare it or split the PR`);
      }
    }
    // A declaration may not be coarser than the areas it is judged against:
    // `Scope: src` would otherwise cover eleven distinct subsystems, turning one
    // honest-looking word into a blanket exemption from the broad-scope gate.
    for (const d of declaredSet) {
      const resolved = areaFor(d);
      if (resolved === "unclassified") {
        const suggestion = AREAS.filter((area) => area.startsWith(`${d}/`));
        errors.push(
          `\`${d}\` is not a declared area — ` +
            (suggestion.length
              ? `declare the specific area(s): ${suggestion.map((area) => `\`${area}\``).join(", ")}`
              : `use one of the top-level areas in AREAS`),
        );
      }
    }
  }

  const scoped = [...touched.keys()].filter((a) => a !== "unclassified");
  if (scoped.length > limit && !scopeRationale(body)) {
    errors.push(
      `the diff spans ${scoped.length} areas (${scoped.join(", ")}) and states no reason` +
        ` — add a \`Broad-scope:\` line saying why this is one change, or split it`,
    );
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] ? args[i + 1] : null;
  };
  const all = (name) => args.reduce((acc, arg, i) => (arg === name && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

  const base = getArg("--base") ?? process.env.PR_BASE_REF ?? "main";
  const diffFile = getArg("--diff-file");

  let files;
  if (diffFile) {
    files = readFileSync(diffFile, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  } else {
    try {
      const { execFileSync } = await import("node:child_process");
      files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      console.error(`::error::could not compute the diff against ${base}: ${error.message}`);
      process.exit(2);
    }
  }

  const maxAreas = getArg("--max-areas");
  if (maxAreas !== null && !(Number.isInteger(Number(maxAreas)) && Number(maxAreas) > 0)) {
    console.error(`::error::--max-areas expects a positive integer, got \`${maxAreas}\``);
    process.exit(2);
  }
  const errors = validatePrScope({
    base,
    files,
    body: process.env.PR_BODY ?? "",
    declared: all("--declare"),
    maxAreas: maxAreas ? Number(maxAreas) : undefined,
  });
  for (const error of errors) console.error("::error::" + error);
  if (errors.length) process.exitCode = 1;
  else console.log(`PR scope OK (${files.length} file(s) in ${new Set(files.map(areaFor)).size} area(s))`);
}
