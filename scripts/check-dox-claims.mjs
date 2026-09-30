#!/usr/bin/env node
/**
 * P4.3 — DOX claim/code audit.
 *
 * A contract line a branch ADDS to any AGENTS.md must be satisfiable by that
 * branch's own content. "Satisfiable" is resolved BY TOKEN KIND:
 *
 *   - hidden/runtime path (`.alix/**`) or bare name pattern (`alix_*`, `mcp__*`)
 *       vocabulary, not files — never in git, so presence proves nothing. Skip.
 *   - `src|tests|scripts` path or glob, and bare `*.ts|*.md` filenames
 *       must exist in the HEAD tree.
 *   - identifier (camelCase class member / function)
 *       must appear in SOURCE ONLY (`.ts`/`.mts`/`.mjs`), never in another doc.
 *
 * The third rule is the one that matters. Two earlier revisions of this audit
 * were false-negative machines: the first resolved identifiers against the
 * working tree, so a symbol present in the checker's own checkout looked
 * resolved on any branch; the second resolved against all of `src/` including
 * `AGENTS.md`, letting one doc's mention satisfy a claim about code. Both
 * passed on branches whose docs named functions that did not exist. Always
 * validate this script against a known-bad ref before trusting a green run.
 *
 * Scope: only lines the branch ADDS relative to `--base`. Existing claims are
 * the base's responsibility — this gates what a change introduces.
 *
 * Exit codes:
 *   0  every claim token resolves
 *   1  one or more claims are unbacked (reported)
 *   2  usage / ref-resolution failure (never a silent pass)
 *
 * Usage: node scripts/check-dox-claims.mjs [--base <ref>] [--head <ref>] [--json]
 */
import { execFileSync, execSync } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const base = getArg("--base") ?? "main";
const head = getArg("--head") ?? "HEAD";
const asJson = args.includes("--json");

const sh = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 1 << 28 });
const fails = (code, msg) => {
  console.error(asJson ? JSON.stringify({ error: msg, exitCode: code }) : `ERROR: ${msg}`);
  process.exit(code);
};

const resolveRef = (ref) => {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};

const headSha = resolveRef(head);
if (!headSha) fails(2, `cannot resolve --head '${head}'`);
const baseSha = resolveRef(base);
if (!baseSha) {
  fails(
    2,
    `cannot resolve --base '${base}'. Fetch it (git fetch origin main) or pass --base. ` +
      "Refusing to treat an unresolved base as an empty diff — that would pass every broken branch.",
  );
}

let tree = [];
try {
  tree = sh(`git ls-tree -r --name-only ${headSha}`).split("\n");
} catch {
  fails(2, `cannot read the tree of ${headSha}`);
}

// Glob against the HEAD tree. A single `*` does not cross `/` (bash-like).
// Written as a line comment, not a JSDoc: the pattern contains a glob closer.
const globMatch = (pattern) => {
  const rx = new RegExp(
    "^" +
      pattern
        .split("/")
        .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
        .join("/") +
        "$",
  );
  return tree.some((name) => rx.test(name));
};
const pathExists = (p) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${headSha}:${p}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
/** Source only. Never a doc: a doc mentioning a symbol proves nothing about code. */
const codeHas = (ident) => {
  const out = sh(
    `git grep -l -e "${ident}" ${headSha} -- 'src/**/*.ts' 'src/**/*.mts' 'tests/**/*.ts' 'scripts/**/*.mjs' 2>/dev/null || true`,
  );
  return out.trim().length > 0;
};

let diff;
try {
  diff = sh(`git diff ${baseSha}...${headSha} -- '*AGENTS.md'`);
} catch {
  fails(2, "git diff failed between the resolved base and head");
}

const addedLines = diff
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .map((l) => l.slice(1));

const changedFiles = new Set();
const problems = [];
let checked = 0;
let currentFile = "";

for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) currentFile = line.slice(6);
  // Only list items: asserted rules, not prose or headings.
  if (!line.startsWith("+") || line.startsWith("+++") || !/^- /.test(line.slice(1))) continue;
  if (currentFile) changedFiles.add(currentFile);

  for (const m of line.slice(1).matchAll(/`([^`]+)`/g)) {
    const raw = m[1].replace(/\(\)$/, "");
    if (!raw || raw.includes(" ") || raw.includes("://")) continue;
    if (raw.startsWith(".")) continue; // runtime dirs, not in git
    if (raw.includes("*") && !/^(src|tests|scripts)\//.test(raw)) continue; // name vocabulary

    if (raw.includes("*")) {
      checked++;
      if (!globMatch(raw)) problems.push({ file: currentFile, token: raw, why: "no file matches" });
      continue;
    }
    if (/^[a-z][a-zA-Z0-9_/-]*\.(ts|mts|js|mjs|md)$/.test(raw)) {
      checked++;
      if (raw.includes("/")) {
        if (!pathExists(raw)) problems.push({ file: currentFile, token: raw, why: "missing file" });
      } else if (!tree.some((n) => n.endsWith(`/${raw}`))) {
        problems.push({ file: currentFile, token: raw, why: "no such file" });
      }
      continue;
    }
    // `Class.method` -> judge the member; plain path-ish tokens were caught above.
    const ident = raw.split(".").pop();
    if (raw.includes("/") || !/^[a-z][a-zA-Z0-9]*$/.test(ident)) continue;
    if (!/[a-z][A-Z]/.test(ident)) continue; // not a JS identifier
    checked++;
    if (!codeHas(ident)) problems.push({ file: currentFile, token: raw, why: "no code" });
  }
}

if (asJson) {
  console.log(JSON.stringify({ base, head, checked, files: [...changedFiles], problems }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

console.log(
  `DOX claim/code audit: ${changedFiles.size} AGENTS.md file(s) changed, ${checked} token(s) checked (${base}...${head.slice(0, 8)})`,
);
if (problems.length) {
  console.error(`UNBACKED CLAIMS (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p.file}\n      ${p.why}  ${p.token}`);
  process.exit(1);
}
console.log("OK: every claim token resolves to the branch's own content.");
