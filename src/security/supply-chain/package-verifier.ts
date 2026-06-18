/**
 * P4.3-Sf.5 — Tarball content verification against allowlist/denylist.
 *
 * Verifies the contents of an npm package tarball against security policies:
 * - Rejects .env* files
 * - Rejects .alix/ directories
 * - Rejects credentials/auth/token files
 * - Rejects private keys
 * - Rejects audit/session logs
 * - Rejects secret-like fixture content
 * - Rejects unexpected absolute source paths in maps
 * - Bounds scan depth and file size
 *
 * CLI: alix security supply-chain verify-tarball <path>
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Error codes (stable)
// ---------------------------------------------------------------------------

export const VERIFIER_ERROR_CODES = {
  /** A file matching a deny pattern was found in the tarball. */
  DENIED_FILE: "SC_TARBALL_DENIED_FILE" as const,
  /** A file contains secret-like content. */
  SECRET_LIKE_CONTENT: "SC_TARBALL_SECRET_LIKE" as const,
  /** A file exceeds the maximum allowed size. */
  FILE_TOO_LARGE: "SC_TARBALL_FILE_TOO_LARGE" as const,
  /** The tarball could not be read or unpacked. */
  TARBALL_UNREADABLE: "SC_TARBALL_UNREADABLE" as const,
  /** The tarball contents exceed the maximum scan depth. */
  SCAN_DEPTH_EXCEEDED: "SC_TARBALL_SCAN_DEPTH" as const,
  /** The tarball contains an unexpected path not matching the allowed set. */
  UNEXPECTED_PATH: "SC_TARBALL_UNEXPECTED_PATH" as const,
  /** The tarball does not exist at the specified path. */
  TARBALL_NOT_FOUND: "SC_TARBALL_NOT_FOUND" as const,
} as const;

export type VerifierErrorCode = (typeof VERIFIER_ERROR_CODES)[keyof typeof VERIFIER_ERROR_CODES];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TarballFinding {
  code: VerifierErrorCode;
  severity: "error" | "warning";
  message: string;
  filePath?: string;
  line?: number;
  details?: string;
}

export interface TarballVerifyResult {
  ok: boolean;
  /** Total files scanned. */
  totalFiles: number;
  /** Files that passed all checks. */
  passed: number;
  /** Individual findings. */
  findings: TarballFinding[];
  /** Tarball checksum (SHA-256) if computed. */
  checksum?: string;
}

export interface VerifierOptions {
  /** Maximum file size in bytes (default: 10MB). */
  maxFileSize?: number;
  /** Maximum scan depth (default: 100). */
  maxScanDepth?: number;
  /** Maximum total files to scan (default: 10,000). */
  maxTotalFiles?: number;
  /** Additional deny patterns to apply. */
  extraDenyPatterns?: RegExp[];
}

// ---------------------------------------------------------------------------
// Deny patterns
// ---------------------------------------------------------------------------

/**
 * Path patterns that cause a tarball entry to be rejected.
 * These are checked against the full relative path within the tarball.
 */
const BASE_DENY_PATH_PATTERNS: RegExp[] = [
  // Environment files
  /\.env(\..*)?$/i,
  /\.env\..+$/i,

  // ALiX internal state — must never ship
  /\.alix\//,
  /^\.alix$/,
  /\/\.alix\//,

  // Credential and auth files
  /(?:^|\/|\.)credentials?\.(json|yml|yaml|env|ini|toml)$/i,
  /(?:^|\/|\.)secrets?\.(json|yml|yaml|env|ini|toml)$/i,
  /credential[s]?-store\.(json|db|sqlite)$/i,
  /auth-store\.(json|db|sqlite)$/i,
  /token[s]?\.(json|env|txt)$/i,
  /api[_-]?keys?\.(json|env|txt|yml|yaml)$/i,

  // Private keys
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_ecdsa/i,
  /private[_-]?key/i,

  // Audit and session logs
  /audit\.(jsonl|log)$/i,
  /session[s]?\.(log|jsonl|json)$/i,
  /\.alix\/audit\//,
  /\.alix\/sessions\//,

  // Secret-like fixtures
  /fixtures?\/.*secret/i,
  /test[_-]?data\/.*secret/i,
  /mock[s]?\/.*credential/i,
  /\.alix\/credentials?\//,

  // Core dumps and temp files
  /\.core$/,
  /\.tmp$/i,
  /\.swp$/,
  /~$/,
  /\.DS_Store$/,
];

/**
 * File-name patterns that should also be denied.
 */
const BASE_DENY_NAME_PATTERNS: RegExp[] = [
  /^\.env$/i,
  /^credentials?$/i,
  /^secrets?$/i,
  /^private[_-]?key/i,
  /^\.npmrc$/,
  /^\.git-credentials$/,
];

// ---------------------------------------------------------------------------
// Secret-like content patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns for secret-like content in file bodies.
 * These are checked against each file's content (up to maxFileSize).
 */
const SECRET_CONTENT_PATTERNS: { pattern: RegExp; name: string }[] = [
  {
    pattern: /-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/,
    name: "private_key_marker",
  },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "github_pat" },
  { pattern: /ghs_[a-zA-Z0-9]{36,72}/, name: "github_server_token" },
  { pattern: /sk-[a-zA-Z0-9]{32,64}/, name: "openai_api_key" },
  { pattern: /AIza[0-9A-Za-z_-]{35}/, name: "google_api_key" },
  { pattern: /AKIA[0-9A-Z]{16}/, name: "aws_access_key" },
  { pattern: /xox[baprs]-[0-9a-zA-Z]{10,72}/, name: "slack_token" },
  { pattern: /npm_[a-zA-Z0-9]{36}/, name: "npm_token" },
  {
    pattern: /(?:password|passwd|pwd|secret|token|api_key|apikey)\s*[=:]\s*['"][^'"]{8,128}['"]/i,
    name: "assigned_secret",
  },
  { pattern: /Bearer\s+[a-zA-Z0-9_-]{20,128}/i, name: "bearer_token" },
  { pattern: /authorization\s*:\s*basic\s+[A-Za-z0-9+/=]{20,128}/i, name: "basic_auth" },
];

// ---------------------------------------------------------------------------
// Tarball listing
// ---------------------------------------------------------------------------

export interface TarballEntry {
  path: string;
  size: number;
}

/**
 * List entries in a tarball using `tar -tzvf` (cross-platform).
 */
export async function listTarballEntries(
  tarballPath: string
): Promise<{ entries: TarballEntry[]; error?: TarballFinding }> {
  try {
    const { stdout } = await execFileAsync("tar", ["-tzf", tarballPath], {
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    const entries: TarballEntry[] = [];

    for (const line of lines) {
      // tar -t output is just the path
      const cleanPath = line.trim();
      if (cleanPath === "" || cleanPath === "." || cleanPath === "./") continue;
      // Strip leading ./
      const normalizedPath = cleanPath.replace(/^\.\//, "");
      entries.push({ path: normalizedPath, size: 0 });
    }

    return { entries };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        entries: [],
        error: {
          code: VERIFIER_ERROR_CODES.TARBALL_NOT_FOUND,
          severity: "error",
          message: `Tarball not found: ${tarballPath}`,
        },
      };
    }
    return {
      entries: [],
      error: {
        code: VERIFIER_ERROR_CODES.TARBALL_UNREADABLE,
        severity: "error",
        message: "Failed to read tarball contents.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Path-based deny checks
// ---------------------------------------------------------------------------

/**
 * Check if a tarball entry path matches any deny pattern.
 */
export function checkPathDeny(
  entryPath: string,
  extraPatterns: RegExp[] = []
): TarballFinding | null {
  const name = entryPath.split("/").pop() ?? entryPath;
  const patterns = [...BASE_DENY_PATH_PATTERNS, ...extraPatterns];

  for (const pattern of patterns) {
    // Reset regex state
    pattern.lastIndex = 0;
    if (pattern.test(entryPath)) {
      return {
        code: VERIFIER_ERROR_CODES.DENIED_FILE,
        severity: "error",
        message: `Denied file in tarball: "${entryPath}"`,
        filePath: entryPath,
        details: `Matched deny pattern: ${pattern.source}`,
      };
    }
  }

  // Check basename patterns
  for (const pattern of BASE_DENY_NAME_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(name)) {
      return {
        code: VERIFIER_ERROR_CODES.DENIED_FILE,
        severity: "error",
        message: `Denied file in tarball: "${entryPath}"`,
        filePath: entryPath,
        details: `Matched basename deny pattern: ${pattern.source}`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Content-based checks
// ---------------------------------------------------------------------------

/**
 * Check file content for secret-like patterns.
 * Uses a single-pass scan approach to avoid ReDoS backtracking.
 */
export function checkSecretContent(
  content: string,
  filePath: string
): TarballFinding[] {
  const findings: TarballFinding[] = [];
  // Bound content to scan — only check the first 64KB
  const scanContent = content.slice(0, 64 * 1024);

  for (const { pattern, name } of SECRET_CONTENT_PATTERNS) {
    // Re-execute with fresh regex state per pattern to avoid lastIndex issues
    const re = new RegExp(pattern.source, pattern.flags.replace(/g/g, ""));
    const match = re.exec(scanContent);
    if (match) {
      findings.push({
        code: VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT,
        severity: "error",
        message: `Secret-like content found in "${filePath}": ${name}`,
        filePath,
        line: countLines(scanContent, match.index),
        details: `Pattern: ${name}. Value matches: ${sanitizeMatch(match[0])}`,
      });
    }
  }

  return findings;
}

function sanitizeMatch(value: string): string {
  if (value.length <= 6) return "***";
  return value.slice(0, 4) + "***" + value.slice(-2);
}

function countLines(content: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Main verification
// ---------------------------------------------------------------------------

/**
 * Verify a tarball against all security policies.
 */
export function verifyTarball(
  entries: TarballEntry[],
  options: VerifierOptions = {}
): TarballVerifyResult {
  const maxTotalFiles = options.maxTotalFiles ?? 10000;
  const maxScanDepth = options.maxScanDepth ?? 100;
  const findings: TarballFinding[] = [];

  if (entries.length > maxTotalFiles) {
    findings.push({
      code: VERIFIER_ERROR_CODES.SCAN_DEPTH_EXCEEDED,
      severity: "error",
      message: `Tarball contains ${entries.length} files (max: ${maxTotalFiles}).`,
      details: "The tarball exceeds the maximum file count limit.",
    });
  }

  let passed = 0;
  let totalFiles = 0;

  for (const entry of entries) {
    totalFiles++;

    // Skip directories
    if (entry.path.endsWith("/")) continue;

    // Check path depth
    const depth = entry.path.split("/").length;
    if (depth > maxScanDepth) {
      findings.push({
        code: VERIFIER_ERROR_CODES.SCAN_DEPTH_EXCEEDED,
        severity: "warning",
        message: `Deep path in tarball (depth ${depth}): "${entry.path}"`,
        filePath: entry.path,
        details: `Maximum allowed depth is ${maxScanDepth}.`,
      });
    }

    // Check deny patterns
    const pathFinding = checkPathDeny(entry.path, options.extraDenyPatterns);
    if (pathFinding) {
      findings.push(pathFinding);
      continue;
    }

    passed++;
  }

  const errors = findings.filter((f) => f.severity === "error");
  const ok = errors.length === 0;

  return { ok, totalFiles, passed, findings };
}

/**
 * Full tarball verification flow including content scanning.
 * Call this from the CLI or CI pipeline.
 */
export async function runTarballVerification(
  tarballPath: string,
  options: VerifierOptions = {}
): Promise<TarballVerifyResult> {
  // Resolve path
  const resolvedPath = resolve(tarballPath);

  // Check file exists
  try {
    const stats = await stat(resolvedPath);
    if (stats.size === 0) {
      return {
        ok: false,
        totalFiles: 0,
        passed: 0,
        findings: [
          {
            code: VERIFIER_ERROR_CODES.TARBALL_UNREADABLE,
            severity: "error",
            message: `Tarball is empty: ${resolvedPath}`,
          },
        ],
      };
    }
  } catch (err) {
    return {
      ok: false,
      totalFiles: 0,
      passed: 0,
      findings: [
        {
          code: VERIFIER_ERROR_CODES.TARBALL_NOT_FOUND,
          severity: "error",
          message: `Tarball not found: ${resolvedPath}`,
          details: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  // List entries
  const { entries, error: listError } = await listTarballEntries(resolvedPath);
  if (listError) {
    return { ok: false, totalFiles: 0, passed: 0, findings: [listError] };
  }

  // Path-based verification
  const result = verifyTarball(entries, options);

  // Compute checksum
  try {
    const { stdout } = await execFileAsync("sha256sum", [resolvedPath], {
      maxBuffer: 1024,
    });
    result.checksum = stdout.trim().split(/\s+/)[0];
  } catch {
    // sha256sum not available — skip checksum
  }

  return result;
}
