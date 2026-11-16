/**
 * Shared advisory instruction-file selection for the Codex DOX scope and overlap
 * diagnostics. No workspace writes; no instructions are ever executed.
 */
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseStringArray(text) {
  let index = 0;
  const skip = () => {
    while (index < text.length) {
      if (/\s/.test(text[index])) index++;
      else if (text[index] === "#") {
        while (index < text.length && text[index] !== "\n") index++;
      } else break;
    }
  };
  skip();
  if (text[index++] !== "[") throw new Error("fallback filenames must be a TOML array");
  const names = [];
  skip();
  while (text[index] !== "]") {
    const quote = text[index++];
    if (quote !== "'" && quote !== '"') throw new Error("fallback filenames must be quoted strings");
    let value = "";
    if (quote === "'") {
      while (index < text.length && text[index] !== "'") value += text[index++];
      if (text[index++] !== "'") throw new Error("unterminated fallback filename");
    } else {
      let escaped = false;
      let raw = '"';
      let closed = false;
      while (index < text.length) {
        const char = text[index++];
        raw += char;
        if (char === '"' && !escaped) { closed = true; break; }
        if (char === "\\" && !escaped) escaped = true;
        else escaped = false;
      }
      if (!closed) throw new Error("unterminated fallback filename");
      try { value = JSON.parse(raw); }
      catch { throw new Error("invalid fallback filename escape"); }
    }
    names.push(value);
    skip();
    if (text[index] === ",") { index++; skip(); }
    else if (text[index] !== "]") throw new Error("invalid fallback filename array separator");
    if (index >= text.length) throw new Error("unterminated fallback filename array");
  }
  index++;
  // Anything remaining before the next line must be whitespace or a TOML
  // comment. An invalid suffix must not be accepted as a valid configuration.
  const suffix = text.slice(index).split("\n", 1)[0];
  if (!/^\s*(?:#.*)?$/.test(suffix))
    throw new Error("unexpected text after fallback filename array");
  // This parser intentionally handles only this one config key. It never
  // pretends to validate the rest of Codex's TOML file.
  return names;
}

export function loadFallbackFilenames(config) {
  if (!existsSync(config)) return [];
  const lines = readFileSync(config, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*\[/.test(line)) break; // root-level Codex setting only
    // TOML permits bare, single-quoted, and double-quoted keys.
    const assignment = /^\s*(?:project_doc_fallback_filenames|"project_doc_fallback_filenames"|'project_doc_fallback_filenames')\s*=/.exec(line);
    if (!assignment) continue;
    const value = line.slice(assignment[0].length);
    const names = parseStringArray([value, ...lines.slice(index + 1)].join("\n"));
    const filtered = [];
    for (const name of names) {
      if (typeof name !== "string") throw new Error("fallback filename must be a string");
      // Match Codex's filename-only validation before touching the filesystem.
      if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")
          || (process.platform === "win32" && /[\\:]/.test(name))) continue;
      if (!["AGENTS.override.md", "AGENTS.md", ...filtered].includes(name)) filtered.push(name);
    }
    return filtered;
  }
  return [];
}

export function instructionNames(fallbacks) {
  return ["AGENTS.override.md", "AGENTS.md", ...fallbacks];
}

export function effectiveInstruction(dir, fallbacks) {
  for (const name of instructionNames(fallbacks)) {
    const file = join(dir, name);
    try {
      lstatSync(file); // includes dangling symlinks: caller must reject them
      return file;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}
