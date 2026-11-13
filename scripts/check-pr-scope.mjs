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
  "src/config",
  "src/utils",
  "tests",
  "scripts",
  "docs",
  "native",
  ".github",
];

/** Files that any single area is allowed to touch as supporting metadata. */
export const SHARED_PATHS = ["package.json", "pnpm-lock.yaml", ".gitignore", "CONTRIBUTING.md", "AGENTS.md", "README.md", ".nvmrc", "tsconfig.json"];

/** Paths that belong to an existing area but are not named after it. */
export const AREA_ALIASES = {
  ".githooks": "scripts",
};

export function areaFor(path) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (SHARED_PATHS.includes(normalized)) return "shared";
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

  if (declaredSet.size) {
    for (const area of touched.keys()) {
      if (area === "unclassified") continue;
      const covered = [...declaredSet].some((d) => area === d || area.startsWith(`${d}/`) || d.startsWith(`${area}/`));
      if (!covered) {
        errors.push(`touched \`${area}\` but the PR declares only ${[...declaredSet].map((d) => `\`${d}\``).join(", ")} — declare it or split the PR`);
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

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
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
