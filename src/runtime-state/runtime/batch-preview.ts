/**
 * batch-preview.ts -- Batch preview builder for multi-replay selection.
 *
 * Combines diff sets from multiple replayIds into a unified safety
 * summary with overlap detection. All dry-run -- no execution.
 */

import type { ReplayDiffSet } from "./replay-diff-store.js";

// ─── Types ───────────────────────────────────────────────────────────

export type FileOverlap = {
  filePath: string;
  replayIds: string[];
};

export type BatchRollbackPreview = {
  totalReplays: number;
  totalFiles: number;
  totalRestore: number;
  totalDelete: number;
  overlaps: FileOverlap[];
  perReplay: Array<{
    replayId: string;
    files: number;
    restore: number;
    delete: number;
    warnings: string[];
  }>;
};

// ─── Overlap Detection ───────────────────────────────────────────────

export function detectFileOverlaps(fileMap: Map<string, string[]>): FileOverlap[] {
  const fileToReplays = new Map<string, Set<string>>();

  for (const [replayId, paths] of fileMap) {
    for (const path of paths) {
      const set = fileToReplays.get(path) ?? new Set();
      set.add(replayId);
      fileToReplays.set(path, set);
    }
  }

  const overlaps: FileOverlap[] = [];
  for (const [filePath, replaySet] of fileToReplays) {
    if (replaySet.size > 1) {
      overlaps.push({ filePath, replayIds: [...replaySet] });
    }
  }

  return overlaps.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

// ─── Batch Rollback Preview ──────────────────────────────────────────

export async function buildBatchRollbackPreview(
  diffSets: Map<string, ReplayDiffSet>,
): Promise<BatchRollbackPreview> {
  const perReplay: BatchRollbackPreview["perReplay"] = [];
  const fileMap = new Map<string, string[]>();
  let totalFiles = 0;
  let totalRestore = 0;
  let totalDelete = 0;

  for (const [replayId, diffSet] of diffSets) {
    let restore = 0;
    let created = 0;
    const files: string[] = [];

    for (const record of diffSet.records) {
      files.push(record.filePath);
      if (record.changeType === "created") {
        created++;
        totalDelete++;
      } else if (record.rollbackable) {
        restore++;
        totalRestore++;
      }
      totalFiles++;
    }

    fileMap.set(replayId, files);

    const warnings: string[] = [];
    if (created > 0) warnings.push(`${created} file(s) would be deleted (no before state)`);

    perReplay.push({
      replayId,
      files: diffSet.records.length,
      restore,
      delete: created,
      warnings,
    });
  }

  const overlaps = detectFileOverlaps(fileMap);

  return {
    totalReplays: diffSets.size,
    totalFiles,
    totalRestore,
    totalDelete,
    overlaps,
    perReplay,
  };
}

// ─── Safety Summary Formatting ────────────────────────────────────────

export function formatBatchRollbackPreview(preview: BatchRollbackPreview): string[] {
  const lines: string[] = [];
  if (preview.totalReplays === 0) {
    lines.push("No replays selected. Use /batch select <replayId> first.");
    return lines;
  }

  lines.push(`Batch Rollback Preview (${preview.totalReplays} replays selected)`);
  lines.push("═══════════════════════════════════════════");

  for (const r of preview.perReplay) {
    lines.push(`  ${r.replayId}:`);
    lines.push(`    ${r.files} file(s) (${r.restore} restore, ${r.delete} delete)`);
    for (const w of r.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }

  lines.push("");
  lines.push("Safety Summary:");
  lines.push(`  Total files:  ${preview.totalFiles}`);
  lines.push(`  Restore:      ${preview.totalRestore}`);
  lines.push(`  Delete:       ${preview.totalDelete}`);

  if (preview.overlaps.length > 0) {
    lines.push(`  Overlapping:  ${preview.overlaps.length} file(s)`);
    for (const o of preview.overlaps) {
      lines.push(`    ⚠ OVERLAP: ${o.filePath}`);
      lines.push(`      Affected replays: ${o.replayIds.join(", ")}`);
    }
  } else {
    lines.push("  Overlapping:  none detected");
  }

  return lines;
}
