/**
 * import-graph.ts — shared helper for structural sentinels (#697).
 *
 * Extracts the *real* module specifiers and imported bindings from a source
 * file (static `import`, bare `import`, `export … from`, and dynamic
 * `import()`), after stripping comments. This lets purity sentinels assert on
 * actual dependencies instead of a whole-file substring scan, which a comment
 * or unrelated mention would satisfy.
 */
import { readFileSync } from "node:fs";

export interface ImportRecord {
  /** The module specifier as written (e.g. "../../adaptation/approval-gate.js"). */
  specifier: string;
  /** Named/default/namespace bindings introduced by the import (empty for bare/dynamic). */
  bindings: string[];
  /** True for `import type …` / `export type … from`. */
  typeOnly: boolean;
}

/** Strip block and line comments so commented-out imports never count. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Public alias: source text with comments removed (for call-site scans). */
export function codeOnly(src: string): string {
  return stripComments(src);
}

/**
 * Normalize a filesystem path to POSIX separators. Sentinels compare paths
 * against `/`-joined literals; on Windows `readdir`/`glob` return `\` paths,
 * so comparisons must be separator-agnostic.
 */
export function toPosix(p: string): string {
  return p.split("\\").join("/");
}

/** Parse the bindings from an import/export clause (the part before `from`). */
function parseBindings(clause: string): string[] {
  const out: string[] = [];
  const named = /\{([\s\S]*?)\}/.exec(clause);
  if (named) {
    for (const part of named[1].split(",")) {
      const t = part.trim().replace(/^type\s+/, "");
      if (!t) continue;
      const as = /\bas\s+([A-Za-z0-9_$]+)/.exec(t);
      out.push(as ? as[1] : t);
    }
  }
  const ns = /\*\s+as\s+([A-Za-z0-9_$]+)/.exec(clause);
  if (ns) out.push(ns[1]);
  // Default import: a lone identifier before `{` (or the whole clause).
  const beforeBrace = clause.split("{")[0].replace(/\*/g, "").trim().replace(/,$/, "");
  if (/^[A-Za-z_$][\w$]*$/.test(beforeBrace)) out.push(beforeBrace);
  return out;
}

/** Extract every import/export-from/dynamic-import record from source text. */
export function extractImports(source: string): ImportRecord[] {
  const src = stripComments(source);
  const records: ImportRecord[] = [];
  let m: RegExpExecArray | null;

  const staticRe = /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  while ((m = staticRe.exec(src))) {
    records.push({ typeOnly: !!m[1], bindings: parseBindings(m[2]), specifier: m[3] });
  }
  const bareRe = /\bimport\s*["']([^"']+)["']/g;
  while ((m = bareRe.exec(src))) {
    records.push({ typeOnly: false, bindings: [], specifier: m[1] });
  }
  const exportRe = /\bexport\s+(type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s*["']([^"']+)["']/g;
  while ((m = exportRe.exec(src))) {
    records.push({ typeOnly: !!m[1], bindings: parseBindings(m[0]), specifier: m[2] });
  }
  const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((m = dynRe.exec(src))) {
    records.push({ typeOnly: false, bindings: [], specifier: m[1] });
  }
  return records;
}

export function readImports(absPath: string): ImportRecord[] {
  return extractImports(readFileSync(absPath, "utf-8"));
}

/** All module specifiers imported (static + bare + export-from + dynamic). */
export function importedSpecifiers(absPath: string): Set<string> {
  return new Set(readImports(absPath).map((r) => r.specifier));
}

/** All named/default/namespace bindings imported. */
export function importedBindings(absPath: string): Set<string> {
  const out = new Set<string>();
  for (const r of readImports(absPath)) for (const b of r.bindings) out.add(b);
  return out;
}
