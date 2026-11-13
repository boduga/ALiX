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
 *   3. ONE-THING the changed paths must not span more than `--max-areas`
 *                top-level areas (default 3). A declaration does not raise the
 *                limit; it makes every touched area explicit. Tests and
 *                tooling that belong to one change may legitimately span
 *                `scripts`, `tests`, and `.github`; a change that also reaches
 *                into product subsystems must declare and justify each one.
 *
 * The point is not to make large PRs fail. It is to make a diff that touches
 * governance, evidence, TUI, and CI in one change say so out loud, instead of
 * arriving as "small cleanup".
 *
 * Usage (CI):
 *   PR_BASE_REF=main PR_BODY="$(cat body.md)" \
 *     node scripts/check-pr-scope.mjs --diff-file changed.txt
 *
 * Usage (local):
 *   node scripts/check-pr-scope.mjs --base main --scope src/governance
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

/** Parse `Scope: a, b` (or a `## Scope` list) out of a PR body. */
export function declaredAreas(body) {
  if (!body) return [];
  const areas = new Set();
  // Template placeholders live in HTML comments. Stripping them first keeps
  // `**Scope:** <!-- exact files -->` from declaring a literal `<!-- exact...`.
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
  const lines = withoutComments.match(/^[^\n]*?\bscope\b[^\n]*$/gim) ?? [];
  for (const rawLine of lines) {
    const afterColon = rawLine.includes(":") ? rawLine.slice(rawLine.indexOf(":") + 1) : "";
    if (!afterColon.trim()) continue;
    // Drop Markdown emphasis and list markers before splitting on separators,
    // so `**Scope:** a, b` and `- Scope: a, b` parse the same way.
    const cleanedLine = afterColon.replace(/[*`_]/g, "").replace(/^[\s-]+/, "");
    for (const piece of cleanedLine.split(/[,;]/)) {
      const cleaned = piece.trim().replace(/^[\s-]+/, "").replace(/\/+$/, "").trim();
      if (cleaned) areas.add(cleaned);
    }
  }
  return [...areas];
}

/**
 * @param {{base: string, baseRef?: string, files: string[], body?: string, declared?: string[], maxAreas?: number}} input
 * @returns {string[]} errors
 */
export function validatePrScope({ base = "main", files = [], body = "", declared = [], maxAreas }) {
  const errors = [];
  if (base !== "main") errors.push("PR base must be main (approved dependency stacks require a separate exception)");

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
  if (scoped.length > limit) {
    errors.push(
      `the diff spans ${scoped.length} areas (${scoped.join(", ")}); the limit is ${limit}` +
        (declaredSet.size
          ? " — split the PR or raise `--max-areas` with a stated reason"
          : " when no scope is declared — add a `Scope:` line to the PR body"),
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
