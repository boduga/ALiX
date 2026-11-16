#!/usr/bin/env node
/**
 * Read-only Codex/DOX path preflight. Does NOT claim a model has read an AGENTS.md.
 *
 * Usage: node scripts/check-dox-scope.mjs [--root DIR] [--config FILE]
 *          [--budget BYTES] [--json] [--all | --path PATH ...]
 * Default: inspect every on-disk AGENTS.md chain. --path inspects specified
 * workspace targets, including not-yet-created files.
 */
import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from "node:fs";
import { resolve, relative, dirname, join, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const values = [];
let root = process.cwd(), config = join(homedir(), ".codex/config.toml");
let budgetOverride, all = false, json = false;
function usage(message) { console.error(message); process.exit(2); }
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (["--root", "--config", "--budget", "--path"].includes(a)) {
    if (!args[i + 1]) usage("missing value for " + a);
    const v = args[++i];
    if (a === "--root") root = resolve(v);
    if (a === "--config") config = resolve(v);
    if (a === "--budget") budgetOverride = Number(v);
    if (a === "--path") values.push(v);
  } else if (a === "--all") all = true;
  else if (a === "--json") json = true;
  else usage("unknown argument: " + a);
}
if (all && values.length) usage("choose either --all or --path");
root = realpathSync(root);
const inside = (p) => p === root || p.startsWith(root + sep);
if (!existsSync(join(root, "AGENTS.md"))) usage("root AGENTS.md does not exist");
function parseBudget() {
  if (budgetOverride !== undefined) return budgetOverride;
  if (!existsSync(config)) return 32768; // Codex default
  let inRoot = true;
  for (const line of readFileSync(config, "utf8").split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inRoot = false;
    if (inRoot) {
      const m = /^\s*project_doc_max_bytes\s*=\s*(\d+)\s*(?:#.*)?$/.exec(line);
      if (m) return Number(m[1]);
    }
  }
  return 32768;
}
const budget = parseBudget();
if (!Number.isSafeInteger(budget) || budget < 1) usage("invalid instruction budget");
const findings = [];
const targets = [];
if (!values.length) {
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (new Set([".git", "node_modules", "dist", "coverage", ".alix", ".gitnexus", ".opensrc"]).has(e.name)) continue;
        walk(join(dir, e.name));
      } else if (e.isFile() && e.name === "AGENTS.md") targets.push(join(dir, e.name));
    }
  }
  walk(root);
} else {
  for (const input of values) {
    const p = resolve(root, input);
    if (!inside(p)) { findings.push({ type: "outside_workspace", path: input }); continue; }
    // Reject symlinked ancestors, including a target which does not exist yet.
    let current = p;
    while (inside(current) && current !== root) {
      if (existsSync(current) && !inside(realpathSync(current))) {
        findings.push({ type: "symlink_escape", path: input }); break;
      }
      current = dirname(current);
    }
    if (current === root) targets.push(p);
  }
}
function chainFor(target) {
  const dirs = [], targetDir = existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
  let dir = targetDir;
  while (inside(dir)) {
    dirs.push(dir);
    if (dir === root) break;
    dir = dirname(dir);
  }
  return dirs.reverse().map((d) => join(d, "AGENTS.md")).filter(existsSync);
}
const records = targets.map((target) => {
  const chain = chainFor(target);
  const bytes = chain.reduce((n, file) => n + statSync(file).size + 2, 0);
  const path = relative(root, target) || ".";
  if (bytes > budget) findings.push({ type: "budget_overflow", path, bytes, budget });
  if (!chain.some((f) => f === join(root, "AGENTS.md"))) findings.push({ type: "missing_root", path });
  return { path, bytes, chain: chain.map((f) => relative(root, f) || "AGENTS.md") };
});
const output = { ok: findings.length === 0, budget, checked: records.length, maxBytes: Math.max(0, ...records.map((r) => r.bytes)), findings, records, note: "Scope and size only: does not establish that Codex read or obeyed these contracts." };
if (json) console.log(JSON.stringify(output, null, 2));
else {
  console.log(`DOX scope: ${output.checked} path(s), budget ${budget} bytes, max chain ${output.maxBytes} bytes`);
  for (const r of records) if (values.length) console.log(`${r.path}: ${r.bytes} bytes [${r.chain.join(" -> ")}]`);
  for (const f of findings) console.error(`${f.type}: ${f.path} (${f.bytes ?? ""})`);
  console.log(output.note);
}
process.exit(findings.length ? 1 : 0);
