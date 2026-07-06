/**
 * Audit export handler — handles file I/O for governance audit exports.
 * Separated from governance.ts to maintain P8 store write invariant.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { writeFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportAuditEventsToFile(
  outputPath: string,
  content: string,
  format: "json" | "jsonl",
  redacted: boolean,
): Promise<{ exported: string; count: number; format: string; redacted: boolean }> {
  await writeFile(outputPath, content, "utf8");
  const count =
    format === "jsonl"
      ? content.split("\n").filter((line) => line.trim()).length
      : JSON.parse(content).length;

  return { exported: outputPath, count, format, redacted };
}
