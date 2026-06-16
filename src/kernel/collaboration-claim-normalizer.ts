/**
 * collaboration-claim-normalizer.ts — Deterministic claim extraction and normalization.
 *
 * Only narrow, testable patterns are supported initially:
 *   subject = value
 *   subject: value
 *   subject is value
 *   decision: use X
 *   version = 1.2.3
 *   digest = sha256:...
 *
 * Ambiguous prose returns null — no fabricated claims.
 */

import { createHash } from "node:crypto";
import type { FindingClaim, ClaimValueType } from "./collaboration-conflict-types.js";

export const EXTRACTION_VERSION = "1.0.0";

/**
 * Attempt to extract a structured claim from a finding's title and content.
 * Returns null when extraction is ambiguous.
 */
export function extractClaim(title: string, content: string): Partial<FindingClaim> | null {
  const text = `${title} ${content}`;

  // Digest pattern: "digest = sha256:abc123"
  const digestMatch = text.match(/(?:digest|hash|checksum)\s*[=:]\s*(sha\d+:[\w]+)/i);
  if (digestMatch) return { subject: "artifact", predicate: "digest", value: digestMatch[1], valueType: "digest" as const };

  // Version pattern: "version = 1.2.3" or "version: 1.2.3"
  const versionMatch = text.match(/(?:version)\s*[=:]\s*(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?)/i);
  if (versionMatch) return { subject: "version", predicate: "detected", value: versionMatch[1], valueType: "version" as const };

  // Boolean pattern: "is true" or "is false"
  const boolMatch = text.match(/\bis\s+(true|false)\b/i);
  if (boolMatch) return { subject: "claim", predicate: "is", value: boolMatch[1].toLowerCase(), valueType: "boolean" as const };

  // Decision pattern: "decision: use X" or "decision = X"
  const decisionMatch = text.match(/decision\s*[=:]\s*use\s+(.+)/i);
  if (decisionMatch) return { subject: "decision", predicate: "choice", value: decisionMatch[1].trim(), valueType: "enum" as const };

  // Key = value pattern (simple)
  const kvMatch = text.match(/(\w+)\s*[=:]\s*(.+)/);
  if (kvMatch && kvMatch[2].trim().length < 100) {
    const predicate = kvMatch[1].trim().toLowerCase();
    const value = kvMatch[2].trim();
    const valueType: ClaimValueType = /^\d+$/.test(value) ? "number" : /^\d+\.\d+$/.test(value) ? "number" : "string";
    return { subject: "general", predicate, value, valueType };
  }

  return null;
}

/**
 * Normalize a claim: case-fold, trim, normalize values.
 */
export function normalizeClaim(input: Partial<FindingClaim>): FindingClaim {
  const subject = (input.subject ?? "").trim().toLowerCase();
  const predicate = (input.predicate ?? "").trim().toLowerCase();
  let value = (input.value ?? "").trim();
  let valueType = input.valueType ?? "unknown";

  if (valueType === "boolean") value = value.toLowerCase();
  if (valueType === "number") value = value.replace(/^0+/, "") || "0";
  if (valueType === "version") value = value.toLowerCase();

  return {
    subject, predicate, value, valueType,
    unit: input.unit,
    scope: input.scope,
    normalizedSubject: subject,
    normalizedPredicate: predicate,
    normalizedValue: value,
    extractionMethod: input.extractionMethod ?? "deterministic",
    extractionVersion: EXTRACTION_VERSION,
  };
}

/**
 * Compute a deterministic topic key from a claim.
 */
export function computeTopicKey(claim: FindingClaim): string {
  const input = { subject: claim.normalizedSubject, predicate: claim.normalizedPredicate, scope: claim.scope ?? "" };
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(canonical).digest("hex");
}
