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
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const base = getArg("--base") ?? "main";
const head = getArg("--head") ?? "HEAD";
const asJson = args.includes("--json");
const writeBaseline = args.includes("--write-baseline");

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

/**
 * Two diffs, not one.
 *
 * The committed range (`base...head`) is what CI sees on a branch, and it is
 * the primary input. But this script is also run by hand against a dirty tree,
 * and `git diff base...head` sees NOTHING uncommitted — so a local run would
 * report "0 files changed, 0 tokens checked" and exit 0. That is the worst
 * possible failure for a claim checker: a green that verified nothing, which
 * reads exactly like a pass.
 *
 * So the working-tree diff is unioned in. `changedFiles` is what actually
 * drives the scan, and the stale-HEAD file reads below are only a problem when
 * a file has uncommitted edits — see `readFile` below, which prefers the disk
 * copy for exactly that case.
 */
let diff;
try {
  diff = sh(`git diff ${baseSha}...${headSha} -- '*AGENTS.md'`);
} catch {
  fails(2, "git diff failed between the resolved base and head");
}

let worktreeDiff = "";
try {
  worktreeDiff = sh(`git diff HEAD -- '*AGENTS.md'; git diff --cached HEAD -- '*AGENTS.md'`);
} catch {
  worktreeDiff = "";
}
diff = `${diff}\n${worktreeDiff}`;

/**
 * Content of an AGENTS.md as it should be judged: the working-tree copy when
 * the file has uncommitted edits, else the committed `head` blob.
 *
 * Token claims resolve against the HEAD tree (`codeHas` greps `headSha`), so a
 * file edited locally is judged against the same commit for CODE but its own
 * on-disk TEXT. Reading HEAD text for a dirty file would audit the pre-edit
 * contract — the same class of bug as verifying a stash-isolated tree.
 */
const dirtyFiles = new Set(
  sh(`git diff --name-only HEAD -- '*AGENTS.md'; git diff --cached --name-only HEAD -- '*AGENTS.md'`)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean),
);
const readFile = (file) => {
  if (dirtyFiles.has(file)) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      /* fall through to the committed copy */
    }
  }
  return sh(`git show ${headSha}:${file}`);
};


const addedLines = diff
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .map((l) => l.slice(1));

const generatedBlock = new Map();

/**
 * Files changed per the diff, known BEFORE the scan. `changedFiles` cannot be
 * used here: it is filled BY the scan, so reading it earlier yields an empty
 * set — which silently exempted nothing and looked like the rule simply not
 * applying.
 */
const diffFiles = new Set(
  diff.split("\n")
    .filter((l) => l.startsWith("+++ b/"))
    .map((l) => l.slice(6).trimEnd())
    .filter(Boolean),
);
for (const file of diffFiles) {
  let text;
  try {
    text = readFile(file);
  } catch {
    continue;
  }
  const block = text.match(/<!--\s*gitnexus:start\s*-->([\s\S]*?)<!--\s*gitnexus:end\s*-->/);
  if (!block) continue;
  generatedBlock.set(
    file,
    new Set([...block[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].split(".").pop())),
  );
}

const changedFiles = new Set();

/**
 * Backticked tokens inside a tool-GENERATED block, per file.
 *
 * `<!-- gitnexus:start -->` ... `<!-- gitnexus:end -->` is rewritten by the
 * indexer, not by a human, and documents the `impact`/`detect_changes` JSON
 * contract. Its field names are legitimately absent from this repo's `.ts`
 * source, so the source-only rule cannot resolve them by construction. Keyed
 * per file so a hand-written bullet using a similar word is still audited.
 *
 * DECLARED here, POPULATED after the bullet scan: the scan reads it while
 * `changedFiles` is still being filled, so populating it earlier iterated an
 * empty set and silently exempted nothing.
 */

const problems = [];
let checked = 0;
let currentFile = "";

/**
 * ── Model-facing vocabulary (one vocabulary everywhere) ──────────────
 *
 * The model may only CALL `alix_*` names. An AGENTS.md contract is injected
 * into agent context as instruction, so a backticked executor ID inside a
 * contract bullet teaches the model a name the runtime will reject — the exact
 * loop that produced `Unknown tool "shell.run"` until the resolver grew a
 * bridging alias.
 *
 * The baseline in `docs/dox-executor-id-baseline.txt` is EMPTY: the migration is
 * complete, so this gate is ABSOLUTE for ADDED lines — any executor ID in a
 * newly added contract bullet fails CI. The file is retained only so the
 * mechanism is auditable, and an entry must never be added to silence a
 * violation.
 *
 * SCOPE, stated plainly because it is the limit of this gate: it reads ADDED
 * lines only. A pre-existing bullet that drifts out of date — a tool renamed
 * elsewhere, then deleted — is invisible here. That is why `pnpm check:dox`
 * alone cannot certify that the contracts still describe reality; the
 * whole-file spliced-bullet scan below is the one check that is not diff-scoped,
 * and it detects structural corruption, not stale tokens.
 *
 * Prose is deliberately NOT checked. A DOX file that describes CODE must name
 * the executor — `tool-manifest.ts maps alix_* names to internal executor IDs`
 * is correct prose. Only asserted contract rules are gated.
 */
/**
 * Tool executor IDs — the CLOSED SET from the manifest, not a dotted-name
 * pattern. A pattern is wrong: it also matches event types
 * (`agent.liveness.warning`), config keys, and schema fields, none of which
 * are model-facing tool names. Only a token that is literally a value of
 * `ALIX_BUILTIN_EXECUTORS` is a vocabulary violation.
 */
const EXECUTOR_IDS = (() => {
  try {
    return new Set(
      sh(`git show ${headSha}:src/agents/tool-manifest.ts`)
        .split("\n")
        .flatMap((l) => {
          // Parse `alix_key: "executor.id"` PAIRS and take the value side. An
          // earlier revision scraped every `:\s*"..."` in the file and then
          // filtered out anything starting with `alix_` to remove the keys —
          // which silently dropped `alix_execution_state_propose`, a real
          // executor id that is also its own model-facing name. Taking values
          // directly needs no filter and cannot misclassify that entry.
          const m = l.match(/^\s*alix_[A-Za-z0-9_]+:\s*"([a-zA-Z0-9_.]+)"/);
          return m ? [m[1]] : [];
        })
        // NOT filtered on "." — several built-ins have an undotted executor id
        // (`done`, `delegate`, `alix_execution_state_propose`). A dotted-only
        // rule would leave them ungated, and those are exactly the names a
        // contract is most tempted to write, since `alix_done` → `done` looks
        // obvious.
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
})();
const isExecutorId = (token) => EXECUTOR_IDS.has(token);
const BASELINE_PATH = "docs/dox-executor-id-baseline.txt";
const baseline = (() => {
  try {
    return new Set(
      sh(`git show ${headSha}:${BASELINE_PATH}`)
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
  } catch {
    return new Set();
  }
})();

/**
 * ── Spliced-bullet detection ─────────────────────────────────────────
 *
 * A contract line ending mid-sentence with a following bullet that begins its
 * own bolded title is a corruption: one bullet was inserted inside another, so
 * the outer contract's prose now reads across the inner one. Two independent
 * reviewers found this in root AGENTS.md, and `check-dox` passed it — the
 * existing audit resolves TOKENS, so it cannot see that the PROSE is incoherent.
 *
 * Signature: a `- ` bullet whose text ends without terminal punctuation AND
 * does not close its backticks, immediately followed by another `- ` bullet
 * that opens with `**`.
 */
function detectSplicedBullets(file, lines) {
  const found = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (!/^- /.test(cur) || !/^- \*\*/.test(next)) continue;
    const body = cur.slice(2).trimEnd();
    if (!body || /[.!?:;)`]$/.test(body)) continue; // closed sentence
    found.push({ file, line: body.slice(0, 60) });
  }
  return found;
}

/**
 * --write-baseline: regenerate `docs/dox-executor-id-baseline.txt` from the
 * HEAD tree. Regenerable rather than hand-maintained so the debt list cannot
 * drift from reality, and so removing a baseline entry is always a deliberate
 * migration step rather than something the tool quietly forgot.
 */
if (writeBaseline) {
  const files = tree.filter((f) => /(^|\/)AGENTS\.md$/.test(f));
  const rows = new Set();
  for (const file of files) {
    let content;
    try {
      content = sh(`git show ${headSha}:${file}`);
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!/^- /.test(line)) continue; // contract bullets only, never prose
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const raw = m[1].replace(/\(\)$/, "");
        if (!raw || raw.includes(" ") || raw.includes("/") || raw.includes("://")) continue;
        if (raw.startsWith(".")) continue;
        if (isExecutorId(raw)) rows.add(`${file}\t${raw}`);
      }
    }
  }
  const header = [
    "# Known executor-ID mentions in model-facing DOX contract bullets.",
    "# Format: <AGENTS.md path>\\t<token>",
    "#",
    "# The aim is ONE VOCABULARY: a contract may only tell the model to call an",
    "# `alix_*` name. Entries here are debt inherited from before the exact-names",
    "# cutover, tolerated so the gate is a RATCHET rather than a wall:",
    "#   * a NEW executor-ID claim fails CI and must be written as `alix_*`",
    "#   * removing a line here is one step of the migration",
    "#",
    "# Prose is not gated. A DOX file that describes CODE must name the executor.",
    "# Only asserted contract bullets (lines starting `- `) are listed.",
    "#",
    `# ${rows.size} entr${rows.size === 1 ? "y" : "ies"}`,
    "# Regenerate: node scripts/check-dox-claims.mjs --write-baseline",
    "",
  ].join("\n");
  writeFileSync(BASELINE_PATH, header + [...rows].sort().join("\n") + "\n");
  console.log(`Wrote ${BASELINE_PATH}: ${rows.size} entr${rows.size === 1 ? "y" : "ies"}`);
  process.exit(0);
}

for (const line of diff.split("\n")) {
  // `.trimEnd()` matters: the diff line carries a trailing newline, so without
  // it `currentFile` is "AGENTS.md\n" and every per-file lookup keyed by it
  // (the generated-block exemption, the baseline) silently misses.
  if (line.startsWith("+++ b/")) currentFile = line.slice(6).trimEnd();
  // Only list items: asserted rules, not prose or headings.
  if (!line.startsWith("+") || line.startsWith("+++") || !/^- /.test(line.slice(1))) continue;
  if (currentFile) changedFiles.add(currentFile);

  for (const m of line.slice(1).matchAll(/`([^`]+)`/g)) {
    const raw = m[1].replace(/\(\)$/, "");
    if (!raw || raw.includes(" ") || raw.includes("://")) continue;
    if (raw.startsWith(".")) continue; // runtime dirs, not in git
    if (raw.includes("*") && !/^(src|tests|scripts)\//.test(raw)) continue; // name vocabulary

    // Executor ID inside an asserted contract rule: the model cannot call it.
    if (isExecutorId(raw) && !raw.includes("/")) {
      const key = `${currentFile}\t${raw}`;
      if (!baseline.has(key)) {
        problems.push({
          file: currentFile,
          token: raw,
          why: "executor id in a model-facing contract (use the alix_* name)",
        });
      }
      continue;
    }

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
    // TOOL-OUTPUT VOCABULARY. The `gitnexus:start`/`gitnexus:end` block is
    // generated INTO this file and names fields of the `impact` JSON payload
    // (`riskSharedAxes`, `epistemic`, `riskNote`). Those are real, but they are
    // keys of a tool's output, not identifiers in this repository's source, so
    // the source-only rule below cannot resolve them by construction. Skip
    // backticked tokens inside the generated block rather than weakening the
    // rule for hand-written contracts, which is where the actual risk lives.
    if (generatedBlock.has(currentFile) && generatedBlock.get(currentFile).has(ident)) continue;
    if (!/[a-z][A-Z]/.test(ident)) continue; // not a JS identifier
    checked++;
    if (!codeHas(ident)) problems.push({ file: currentFile, token: raw, why: "no code" });
  }
}

// Spliced bullets are checked over the WHOLE changed file, not only added
// lines: a bullet spliced in by an earlier commit is still a live corruption
// on any branch that touches the file, and diff-scoped detection would miss it.
const spliced = [];
for (const file of changedFiles) {
  let content;
  try {
    content = readFile(file);
  } catch {
    continue;
  }
  spliced.push(...detectSplicedBullets(file, content.split("\n")));
}

if (asJson) {
  console.log(JSON.stringify(
    { base, head, checked, files: [...changedFiles], problems, spliced, baseline: baseline.size, vacuous: changedFiles.size === 0 },
    null,
    2,
  ));
  process.exit(problems.length || spliced.length ? 1 : changedFiles.size === 0 ? 2 : 0);
}

console.log(
  `DOX claim/code audit: ${changedFiles.size} AGENTS.md file(s) changed, ${checked} token(s) checked (${base}...${head.slice(0, 8)})`,
);
console.log(
  `  vocabulary baseline: ${baseline.size} known executor-ID claim(s) (docs/dox-executor-id-baseline.txt)`,
);
if (spliced.length) {
  console.error(`SPLICED CONTRACT BULLETS (${spliced.length}):`);
  for (const s of spliced) console.error(`  - ${s.file}\n      bullet ends mid-sentence: "${s.line}…"`);
  console.error(
    "      A bullet was inserted inside another; the outer contract's prose now reads across it.",
  );
}
if (problems.length) {
  console.error(`UNBACKED CLAIMS (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p.file}\n      ${p.why}  ${p.token}`);
  process.exit(1);
}
// A clean run that audited NOTHING is not a pass. `git diff base...head`
// ignores the working tree, so before the union this script could print
// "0 files changed, 0 tokens checked" and exit 0 on a dirty tree full of new
// claims — indistinguishable, in CI output, from having verified them.
// Fail loudly instead, and say which invocation DID audit something.
if (changedFiles.size === 0) {
  console.error(
    "NOTHING AUDITED: no AGENTS.md changed between the resolved refs or in the working tree.\n" +
      "  That is a vacuous pass, not a clean one. Re-run with an explicit range\n" +
      "  (--base/--head) on a branch that actually edits a contract.",
  );
  process.exit(2);
}
console.log(
  `OK: ${checked} claim token(s) across ${changedFiles.size} AGENTS.md file(s) resolve to the branch's own content.`,
);
