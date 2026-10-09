import type { VerificationCheck, VerificationResult } from "./verifier.js";

export function buildRiskReport(
  allChecks: VerificationCheck[],
  results: Array<{ check: VerificationCheck; result: VerificationResult }>
): string {
  const lines: string[] = [];
  const resultMap = new Map(results.map(r => [r.check.command, r.result]));

  for (const check of allChecks) {
    const result = resultMap.get(check.command);
    if (!result) {
      lines.push(`[NOT RUN] ${check.command} (${check.reason})`);
    } else if (result.status === "failed") {
      lines.push(`[FAILED] ${check.command}`);
      if (result.output) {
        lines.push(result.output.split("\n").slice(0, 10).join("\n"));
      }
    }
  }

  return lines.join("\n");
}

export function formatVerificationSummary(
  allChecks: VerificationCheck[],
  results: Array<{ check: VerificationCheck; result: VerificationResult }>
): string {
  const passed = results.filter(r => r.result.status === "passed").length;
  const failed = results.filter(r => r.result.status === "failed").length;
  const skipped = allChecks.length - results.length;

  const parts: string[] = [`Verification: ${passed} passed, ${failed} failed, ${skipped} not run`];

  const riskReport = buildRiskReport(allChecks, results);
  if (riskReport) {
    parts.push("\nResidual risk (not verified):");
    parts.push(riskReport);
  }

  return parts.join("");
}