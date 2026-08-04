/**
 * Layer 1 + Layer 2 of skill pre-install safety.
 *
 * Layer 1 (this file's manifest section): surface the declarative fields of a
 * skill manifest and hard-deny known-bad declarations. Skill content is
 * injected verbatim into agent prompts (src/agent/session.ts), so what a
 * manifest declares is part of the trust decision a user makes at install time.
 *
 * Layer 2 (scan section): scan the files a skill package would install with the
 * same deny heuristics as the npm tarball verifier (package-verifier.ts) plus a
 * conservative shell-pattern heuristic that WARNs (never hard-blocks).
 */

import type { SkillManifest } from "./types.js";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { checkPathDeny, checkSecretContent } from "../security/supply-chain/package-verifier.js";

// ---------------------------------------------------------------------------
// Layer 1: manifest checks
// ---------------------------------------------------------------------------

export const MANIFEST_DENY_CODES = {
  /** A skill installed from a non-core source claims is_core: true. */
  SPOOFED_CORE: "SC_SKILL_SPOOFED_CORE",
} as const;

export interface ManifestReport {
  requestedTools: string[];
  requires: string[];
  license?: string;
  warnings: string[];
  deny: boolean;
  denyCode?: string;
}

/** Tool-name classes that warrant a warning when a skill declares them in allowed-tools. */
const WARNING_TOOL_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /mcp__.*__(?:read_|get_|list_)?(?:env|secret|credential|token)/i, message: "requests credential/environment-reading tools" },
  { pattern: /(?:curl|wget|fetch|http)\b/i, message: "requests network-capable tools" },
];

/**
 * Evaluate a skill manifest for declarative trust signals. Denies only the
 * spoofed-core case (deterministic, low false-positive); everything else is a
 * warning surfaced to the user so the decision stays visible.
 */
export function checkManifest(manifest: SkillManifest, opts?: { core?: boolean }): ManifestReport {
  const warnings: string[] = [];
  const deny = manifest.is_core === true && opts?.core !== true;
  if (deny) {
    warnings.push("declares is_core: true but is not a bundled core skill — the core flag is reserved for skills shipped with ALiX");
  }
  for (const tool of manifest.allowed_tools ?? []) {
    for (const { pattern, message } of WARNING_TOOL_PATTERNS) {
      if (pattern.test(tool)) {
        warnings.push(`allowed-tool '${tool}' ${message}`);
        break;
      }
    }
  }
  if (manifest.license === undefined && manifest.is_core !== true) {
    warnings.push("no license declared");
  }
  return {
    requestedTools: manifest.allowed_tools ?? [],
    requires: manifest.requires ?? [],
    license: manifest.license,
    warnings,
    deny,
    denyCode: deny ? MANIFEST_DENY_CODES.SPOOFED_CORE : undefined,
  };
}

// ---------------------------------------------------------------------------
// Layer 2: script/package scanning
// ---------------------------------------------------------------------------

export interface SkillScanFinding {
  code: string;
  severity: "error" | "warning";
  message: string;
  filePath: string;
  details?: string;
}

export interface SkillScanResult {
  ok: boolean;
  filesScanned: number;
  errorCount: number;
  warningCount: number;
  findings: SkillScanFinding[];
}

/** Upper bound on a single scanned file's bytes (avoid reading giant blobs). */
const MAX_SCAN_BYTES = 1024 * 1024;

export interface DangerousShellPattern {
  /** Stable identifier used as the finding code and for `skills.safety.ignoreWarningPatterns`. */
  code: string;
  pattern: RegExp;
  message: string;
}

/**
 * Conservative shell-pattern heuristics. These WARN (false-positive risk) and
 * never hard-block — hard denials come from package-verifier.ts's deny logic.
 *
 * Each pattern carries a stable `code`. Warnings for a specific code can be
 * acknowledged/suppressed by an operator who has reviewed the skill via
 * `skills.safety.ignoreWarningPatterns: ["<code>", ...]` — the default is
 * empty, so every pattern warns until explicitly acknowledged.
 */
export const DANGEROUS_SHELL_PATTERNS: DangerousShellPattern[] = [
  { code: "rm-root", pattern: /rm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\s+(\/\/?|\/|\*)\s*(\s|;|$)/, message: "recursive force delete of filesystem root" },
  { code: "pipe-to-shell", pattern: /\b(?:curl|wget)\b[^\n;|]*\|\s*(?:bash|zsh|dash|sh)\b/i, message: "pipe-to-shell pattern (curl | sh)" },
  { code: "base64-decode", pattern: /(?:base64\s+-[dD]|from\s+base64\s+import\b)/i, message: "base64 payload decoding" },
  { code: "netcat-listener", pattern: /\b(?:ncat|nc)\b\s+-[a-zA-Z]*[el][a-zA-Z]*/, message: "netcat listener (possible reverse shell)" },
  // `eval` is a legitimate built-in in JS/Python, so a bare `eval(` is NOT a
  // warning. Only flag the genuinely dangerous forms: eval of a variable (which
  // may hold external input) and eval/Function() fed decoded data — the classic
  // obfuscation shape (`eval(atob("..."))`). Literal `eval("1+1")` stays quiet.
  { code: "eval-variable", pattern: /\beval\s*\(\s*[a-zA-Z_$][\w$.:]*\s*\)/i, message: "eval() of a variable (possibly external input)" },
  { code: "eval-decoded", pattern: /\beval\s*\(\s*(?:atob|Buffer\.from|fromCharCode|unescape|hex2bin)\s*\(/i, message: "eval() of decoded/obfuscated data" },
  { code: "dynamic-exec", pattern: /\bnew\s+Function\s*\(\s*(?:atob|Buffer\.from|fromCharCode|unescape)\s*\(/i, message: "Function() constructor from decoded/obfuscated data" },
  { code: "exec-exec", pattern: /\bexec\s*\(/, message: "exec() execution" },
  { code: "download-to-file", pattern: /(?:https?|ftp):\/\/[^\s"']*\s+(?:-o|-O|>)\s*/, message: "remote download written to a local file" },
  { code: "ssh-key-ref", pattern: /(?:~\/)?\.ssh\//, message: "references SSH keys" },
  { code: "etc-creds-ref", pattern: /\/etc\/(?:passwd|shadow)\b/, message: "references system credential files" },
];

function checkDangerousScript(
  content: string,
  filePath: string,
  ignorePatternCodes?: ReadonlySet<string>,
): SkillScanFinding[] {
  const isScript = filePath.split("/").includes("scripts") || /\.(sh|bash|py|js|rb|pl)$/i.test(filePath);
  if (!isScript) return [];
  const findings: SkillScanFinding[] = [];
  for (const { code, pattern, message } of DANGEROUS_SHELL_PATTERNS) {
    if (ignorePatternCodes?.has(code)) continue;
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      findings.push({
        code,
        severity: "warning",
        message: `possible dangerous pattern in ${filePath}: ${message}`,
        filePath,
        details: pattern.source,
      });
    }
  }
  return findings;
}

export interface SkillScanOptions {
  /**
   * DANGEROUS_SHELL_PATTERNS codes to skip (operator-acknowledged as reviewed).
   * Only affects shell-heuristic warnings — package-verifier deny errors and the
   * suppression list can never silence them.
   */
  ignorePatternCodes?: readonly string[];
}

/**
 * Scan an in-memory set of package files (from a GitHub URL package). Reuses
 * the supply-chain verifier's deny patterns so skills are held to the same bar
 * as npm tarballs. Structural type `{ relPath, content }` matches
 * `SkillPackageFile` without importing from the CLI layer.
 */
export function scanSkillFiles(
  files: { relPath: string; content: string }[],
  opts?: SkillScanOptions,
): SkillScanResult {
  const ignore = opts?.ignorePatternCodes ? new Set(opts.ignorePatternCodes) : undefined;
  const findings: SkillScanFinding[] = [];
  let filesScanned = 0;
  for (const file of files) {
    filesScanned++;
    const pathFinding = checkPathDeny(file.relPath);
    if (pathFinding) {
      findings.push({
        code: pathFinding.code,
        severity: pathFinding.severity,
        message: pathFinding.message,
        filePath: file.relPath,
        details: pathFinding.details,
      });
      continue;
    }
    for (const f of checkSecretContent(file.content, file.relPath)) {
      findings.push({ code: f.code, severity: f.severity, message: f.message, filePath: f.filePath ?? file.relPath, details: f.details });
    }
    findings.push(...checkDangerousScript(file.content, file.relPath, ignore));
  }
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.length - errorCount;
  return { ok: errorCount === 0, filesScanned, errorCount, warningCount, findings };
}

/**
 * Scan a directory tree (a local package source before install). `excluded`
 * mirrors install.ts's EXCLUDED_DIRS so we scan exactly what would be copied.
 */
export async function scanSkillDirectory(
  dir: string,
  opts?: { excluded?: readonly string[] } & SkillScanOptions,
): Promise<SkillScanResult> {
  const excluded = opts?.excluded ?? [];
  const files: { relPath: string; content: string }[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    const entries = await readdir(current);
    for (const entry of entries) {
      if (excluded.includes(entry)) continue;
      const full = join(current, entry);
      const childRel = rel ? `${rel}/${entry}` : entry;
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full, childRel);
      } else {
        if (st.size > MAX_SCAN_BYTES) continue;
        files.push({ relPath: childRel, content: await readFile(full, "utf8") });
      }
    }
  }
  await walk(dir, "");
  return scanSkillFiles(files, opts?.ignorePatternCodes ? { ignorePatternCodes: opts.ignorePatternCodes } : undefined);
}
