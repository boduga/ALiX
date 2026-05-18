/**
 * Validates subagent results against expected output contract.
 */
import type { SubagentResult } from "../config/schema.js";

export type ValidationResult = {
  valid: boolean;
  warnings: string[];
};

export function validateResult(result: SubagentResult, expected?: string): ValidationResult {
  const warnings: string[] = [];

  if (expected && result.status === "success") {
    const hasExpected = result.findings.some(f => f.content.includes(expected));
    if (!hasExpected) {
      warnings.push(`Expected output "${expected}" not found in findings`);
    }
  }

  if (result.findings.length === 0 && result.status === "success") {
    warnings.push("Subagent returned success but no findings were recorded");
  }

  return { valid: warnings.length === 0, warnings };
}