/**
 * P4.3-Sf.2 — Advisory exception policy and validation.
 *
 * Loads and validates audit-exceptions.json and lifecycle-script-allowlist.json.
 * Provides CLI commands for listing and checking exceptions.
 *
 * CLI: alix security supply-chain exceptions list
 *      alix security supply-chain exceptions check
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Error codes (stable)
// ---------------------------------------------------------------------------

export const EXCEPTION_ERROR_CODES = {
  /** An advisory has no matching exception. */
  UNEXCEPTED_ADVISORY: "SC_UNEXCEPTED_ADVISORY" as const,
  /** An exception entry has expired. */
  EXCEPTION_EXPIRED: "SC_EXCEPTION_EXPIRED" as const,
  /** The exceptions file could not be read or parsed. */
  EXCEPTIONS_FILE_UNREADABLE: "SC_EXCEPTIONS_FILE_UNREADABLE" as const,
  /** The exceptions file is not present. */
  EXCEPTIONS_FILE_MISSING: "SC_EXCEPTIONS_FILE_MISSING" as const,
  /** The npm audit command failed. */
  AUDIT_FAILED: "SC_AUDIT_FAILED" as const,
  /** The audit output could not be parsed. */
  AUDIT_PARSE_FAILED: "SC_AUDIT_PARSE_FAILED" as const,
} as const;

export type ExceptionErrorCode = (typeof EXCEPTION_ERROR_CODES)[keyof typeof EXCEPTION_ERROR_CODES];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisoryException {
  /** Advisory ID (GHSA-xxxx-xxxx-xxxx or package name). */
  id: string;
  /** Vulnerability severity. */
  severity: string;
  /** Affected package name. */
  package: string;
  /** Advisory title/description. */
  title: string;
  /** Justification for accepting the risk. */
  reason: string;
  /** Owner accountable for this exception. */
  owner: string;
  /** ISO date when the exception was created. */
  created: string;
  /** ISO date when the exception expires. */
  expiry: string;
}

export interface ExceptionsFile {
  description?: string;
  lastReviewed?: string;
  policy?: {
    failOnUnexcepted?: boolean;
    failOnExpired?: boolean;
    failSeverity?: string;
    warnSeverity?: string;
    expiryWindowDays?: number;
    productionOnly?: boolean;
  };
  advisories: AdvisoryException[];
}

export interface AdvisoryFinding {
  id: string;
  severity: string;
  package: string;
  title: string;
  isProduction: boolean;
  isDev: boolean;
}

export interface ExceptionFinding {
  code: ExceptionErrorCode;
  severity: "error" | "warning";
  message: string;
  advisoryId?: string;
  packageName?: string;
  details?: string;
}

export interface ExceptionsCheckResult {
  ok: boolean;
  totalAdvisories: number;
  excepted: AdvisoryFinding[];
  unexcepted: AdvisoryFinding[];
  expiredExceptions: AdvisoryException[];
  findings: ExceptionFinding[];
}

// ---------------------------------------------------------------------------
// Audit JSON parsing
// ---------------------------------------------------------------------------

interface NpmAuditResult {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
}

interface NpmAuditVulnerability {
  isDirect?: boolean;
  name: string;
  severity: "low" | "moderate" | "high" | "critical";
  via?: (string | { title?: string; name?: string })[];
  range?: string;
  effects?: string[];
}

/**
 * Parse npm audit JSON output into structured advisory findings.
 */
export function parseAuditResult(raw: string): {
  findings: AdvisoryFinding[];
  error?: ExceptionFinding;
} {
  try {
    const parsed: NpmAuditResult = JSON.parse(raw);
    const vulns = parsed.vulnerabilities ?? {};

    const findings: AdvisoryFinding[] = [];
    for (const [id, vuln] of Object.entries(vulns)) {
      // Determine if it's a production or dev dependency
      const isDirect = vuln.isDirect ?? false;
      const effects = vuln.effects ?? [];
      const hasProductionEffect = effects.length === 0 || effects.some((e) => e !== "dev");

      findings.push({
        id: vuln.name,
        severity: vuln.severity,
        package: vuln.name,
        title: extractTitle(vuln),
        isProduction: hasProductionEffect && !isDevOnly(effects),
        isDev: isDevOnly(effects),
      });
    }

    return { findings };
  } catch (err) {
    return {
      findings: [],
      error: {
        code: EXCEPTION_ERROR_CODES.AUDIT_PARSE_FAILED,
        severity: "error",
        message: "Failed to parse npm audit output as JSON.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

function extractTitle(vuln: NpmAuditVulnerability): string {
  const via = vuln.via ?? [];
  for (const v of via) {
    if (typeof v === "object" && v.title) {
      return v.title;
    }
  }
  return `${vuln.name} advisory (${vuln.severity})`;
}

function isDevOnly(effects: string[]): boolean {
  if (effects.length === 0) return false;
  return effects.every((e) => e === "dev");
}

// ---------------------------------------------------------------------------
// Exceptions loading
// ---------------------------------------------------------------------------

/**
 * Load and parse the audit-exceptions.json file.
 */
export async function loadExceptions(
  exceptionsPath: string
): Promise<{ exceptions: ExceptionsFile | null; error?: ExceptionFinding }> {
  try {
    const raw = await readFile(exceptionsPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed.advisories || !Array.isArray(parsed.advisories)) {
      return {
        exceptions: null,
        error: {
          code: EXCEPTION_ERROR_CODES.EXCEPTIONS_FILE_UNREADABLE,
          severity: "error",
          message: "Audit exceptions file is missing the 'advisories' array.",
          details: `Path: ${exceptionsPath}`,
        },
      };
    }

    // Validate each entry
    for (let i = 0; i < parsed.advisories.length; i++) {
      const adv = parsed.advisories[i];
      if (!adv.id) {
        return {
          exceptions: null,
          error: {
            code: EXCEPTION_ERROR_CODES.EXCEPTIONS_FILE_UNREADABLE,
            severity: "error",
            message: `Exception entry ${i} is missing the 'id' field.`,
            details: JSON.stringify(adv),
          },
        };
      }
    }

    return { exceptions: parsed as ExceptionsFile };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exceptions: null,
        error: {
          code: EXCEPTION_ERROR_CODES.EXCEPTIONS_FILE_MISSING,
          severity: "error",
          message: "Audit exceptions file not found.",
          details: `Expected at: ${exceptionsPath}`,
        },
      };
    }
    return {
      exceptions: null,
      error: {
        code: EXCEPTION_ERROR_CODES.EXCEPTIONS_FILE_UNREADABLE,
        severity: "error",
        message: "Failed to parse audit exceptions file.",
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Policy check
// ---------------------------------------------------------------------------

/**
 * Check audit findings against the exceptions file.
 */
export function checkExceptionsPolicy(
  auditFindings: AdvisoryFinding[],
  exceptions: ExceptionsFile,
  now: Date = new Date()
): ExceptionsCheckResult {
  const policy = exceptions.policy ?? {};
  const findings: ExceptionFinding[] = [];
  const excepted: AdvisoryFinding[] = [];
  const unexcepted: AdvisoryFinding[] = [];
  const expiredExceptions: AdvisoryException[] = [];

  const failSeverity = policy.failSeverity ?? "critical";
  const warnSeverity = policy.warnSeverity ?? "high";

  for (const vuln of auditFindings) {
    const match = exceptions.advisories.find(
      (e) => e.id === vuln.id || e.package === vuln.package
    );

    if (match) {
      // Check expiry
      if (match.expiry) {
        const expiryDate = new Date(match.expiry);
        if (now >= expiryDate) {
          expiredExceptions.push(match);
          if (policy.failOnExpired !== false) {
            findings.push({
              code: EXCEPTION_ERROR_CODES.EXCEPTION_EXPIRED,
              severity: "error",
              message: `Exception for advisory "${match.id}" expired on ${match.expiry}.`,
              advisoryId: match.id,
              packageName: match.package,
              details: `Owner: ${match.owner}. Reason: ${match.reason}`,
            });
          }
        }
      }
      excepted.push(vuln);
    } else {
      // Determine severity threshold
      const severityOrder = ["low", "moderate", "high", "critical"];
      const vulnLevel = severityOrder.indexOf(vuln.severity);
      const failLevel = severityOrder.indexOf(failSeverity);
      const warnLevel = severityOrder.indexOf(warnSeverity);

      if (policy.failOnUnexcepted !== false && vulnLevel >= failLevel) {
        // Production-only check
        if (policy.productionOnly && vuln.isDev) {
          // Skip — dev-only advisory
          excepted.push(vuln);
          continue;
        }
        unexcepted.push(vuln);
        findings.push({
          code: EXCEPTION_ERROR_CODES.UNEXCEPTED_ADVISORY,
          severity: "error",
          message: `Unexcepted ${vuln.severity} advisory for "${vuln.package}": ${vuln.title}`,
          advisoryId: vuln.id,
          packageName: vuln.package,
          details:
            "Add an exception to security/audit-exceptions.json with a reason, owner, and expiry date.",
        });
      } else if (vulnLevel >= warnLevel) {
        findings.push({
          code: EXCEPTION_ERROR_CODES.UNEXCEPTED_ADVISORY,
          severity: "warning",
          message: `Unreviewed ${vuln.severity} advisory for "${vuln.package}": ${vuln.title}`,
          advisoryId: vuln.id,
          packageName: vuln.package,
          details:
            "Review and add an exception or upgrade the dependency.",
        });
        unexcepted.push(vuln);
      } else {
        // Below fail/warn threshold — accept
        excepted.push(vuln);
      }
    }
  }

  // Also check for expired exceptions not in current audit
  for (const exc of exceptions.advisories) {
    if (exc.expiry) {
      const expiryDate = new Date(exc.expiry);
      if (now >= expiryDate && !expiredExceptions.some((e) => e.id === exc.id)) {
        expiredExceptions.push(exc);
        if (policy.failOnExpired !== false) {
          findings.push({
            code: EXCEPTION_ERROR_CODES.EXCEPTION_EXPIRED,
            severity: "error",
            message: `Exception for "${exc.id}" expired on ${exc.expiry}.`,
            advisoryId: exc.id,
            packageName: exc.package,
            details: `Owner: ${exc.owner}. Remove the entry or renew with a new expiry.`,
          });
        }
      }
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  const ok = errors.length === 0;

  return {
    ok,
    totalAdvisories: auditFindings.length,
    excepted,
    unexcepted,
    expiredExceptions,
    findings,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export async function runExceptionsCheck(
  projectRoot: string,
  exceptionsRelPath: string = "security/audit-exceptions.json"
): Promise<ExceptionsCheckResult> {
  const exceptionsPath = resolve(projectRoot, exceptionsRelPath);

  // Load exceptions file
  const { exceptions, error: loadError } = await loadExceptions(exceptionsPath);
  if (!exceptions) {
    return {
      ok: false,
      totalAdvisories: 0,
      excepted: [],
      unexcepted: [],
      expiredExceptions: [],
      findings: loadError
        ? [loadError]
        : [
            {
              code: EXCEPTION_ERROR_CODES.EXCEPTIONS_FILE_UNREADABLE,
              severity: "error",
              message: "Failed to load audit exceptions file.",
            },
          ],
    };
  }

  // For listing — return all exceptions without audit data
  return {
    ok: true,
    totalAdvisories: exceptions.advisories.length,
    excepted: exceptions.advisories.map((a) => ({
      id: a.id,
      severity: a.severity,
      package: a.package,
      title: a.title,
      isProduction: true,
      isDev: false,
    })),
    unexcepted: [],
    expiredExceptions: [],
    findings: [],
  };
}
