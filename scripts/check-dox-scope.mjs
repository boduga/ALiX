#!/usr/bin/env node
/**
 * Read-only Codex/DOX path preflight. Does NOT claim a model has read an AGENTS.md.
 *
 * Usage: node scripts/check-dox-scope.mjs [--root DIR] [--config FILE]
 *          [--budget BYTES] [--json] [--all | --path PATH ...]
 * Default: inspect every on-disk AGENTS.md chain. --path inspects specified
 * workspace targets, including not-yet-created files.
 */
import { readFileSync, existsSync, realpathSync, statSync, lstatSync, readdirSync } from "node:fs";
import { resolve, relative, dirname, join, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { effectiveInstruction, instructionNames, loadFallbackFilenames } from "./codex-instruction-files.mjs";

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
// Share actual instruction-file selection with the overlap audit. The
// caller validates each selected path with lstat before counting its bytes.
let fallbackNames;
try { fallbackNames = loadFallbackFilenames(config); }
catch (error) { usage("invalid project_doc_fallback_filenames: " + error.message); }
const instructionFor = (dir) => effectiveInstruction(dir, fallbackNames);
const relevantNames = new Set(instructionNames(fallbackNames));
function tomlInteger(value) {
  // TOML integers permit digit separators and base-prefixed values. Reject
  // malformed configured values; a silent default can approve excess DOX.
  let sign=1, signed=false;
  if(value.startsWith("+")||value.startsWith("-")){
    signed=true;
    sign=value[0]==="-"?-1:1;
    value=value.slice(1);
  }
  const forms=[
    [/^(?:0|[1-9](?:_?[0-9])*)$/,10],
    [/^0x[0-9a-fA-F](?:_?[0-9a-fA-F])*$/,16],
    [/^0o[0-7](?:_?[0-7])*$/,8],
    [/^0b[01](?:_?[01])*$/,2],
  ];
  for(const [pattern,radix] of forms){
    if(pattern.test(value)){
      // TOML signs apply only to decimal integers, not 0x/0o/0b forms.
      if (signed && radix !== 10) return null;
      const clean=value.replaceAll("_","");
      const parsed=Number.parseInt(radix===10?clean:clean.slice(2),radix)*sign;
      return Number.isSafeInteger(parsed)?parsed:null;
    }
  }
  return null;
}
function parseBudget() {
  if (budgetOverride !== undefined) return budgetOverride;
  if (!existsSync(config)) return 32768; // Codex default
  let inRoot = true;
  for (const line of readFileSync(config, "utf8").split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) inRoot = false;
    if (inRoot) {
      const m = /^\s*project_doc_max_bytes\s*=\s*([^\s#]+)\s*(?:#.*)?$/.exec(line);
      if (m) {
        const value=tomlInteger(m[1]);
        if(value===null)usage("invalid project_doc_max_bytes in config");
        return value;
      }
      if(/^\s*project_doc_max_bytes\s*=/.test(line))
        usage("invalid project_doc_max_bytes in config");
    }
  }
  return 32768;
}
const budget = parseBudget();
if (!Number.isSafeInteger(budget) || budget < 1) usage("invalid instruction budget");
const findings = [];
const targets = [];
const targetSet = new Set();
const addTarget = (path) => { if(!targetSet.has(path)){targetSet.add(path);targets.push(path);} };
if (!values.length) {
  function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) {
        // Do not traverse directory aliases, but inspect symlinked DOX entries
        // so --all reports their invalid instruction source rather than skipping it.
        if (relevantNames.has(e.name)) addTarget(dir);
        continue;
      }
      if (e.isDirectory()) {
        if (new Set([".git", "node_modules", "dist", "coverage", ".alix", ".gitnexus", ".opensrc"]).has(e.name)) continue;
        walk(join(dir, e.name));
      } else if (e.isFile() && (relevantNames.has(e.name))) {
        addTarget(dir);
      }
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
      // The lexical chain is valid only when it is also the real DOX chain.
      // Internal symlinks can silently hide the target's parent AGENTS.md,
      // while broken symlinks are missed by existsSync. Fail closed on both.
      try {
        if (lstatSync(current).isSymbolicLink() || !inside(realpathSync(current))) {
          findings.push({ type: "symlink_escape", path: input }); break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          findings.push({ type: "unverified_path", path: input }); break;
        }
      }
      current = dirname(current);
    }
    if (current === root) addTarget(p);
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
  return dirs.reverse().map(instructionFor).filter(Boolean);
}
const records = targets.map((target) => {
  const chain = chainFor(target);
  // Validate the effective instruction files themselves. Target-path checks
  // cannot validate an override symlink, and statSync would dereference it.
  let bytes = 0;
  for (const file of chain) {
    const name = relative(root, file);
    try {
      const st = lstatSync(file);
      if (!st.isFile()) {
        findings.push({ type: "unverified_instruction", path: name });
        continue;
      }
      bytes += st.size + 2;
    } catch {
      findings.push({ type: "unverified_instruction", path: name });
    }
  }
  const path = relative(root, target) || ".";
  if (bytes > budget) findings.push({ type: "budget_overflow", path, bytes, budget });
  if (!chain.some((f) => f === instructionFor(root))) findings.push({ type: "missing_root", path });
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
