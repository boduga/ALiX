// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Shared adapter helpers.
 *
 * The normalized output shape every A6 store adapter returns
 * ({ artifacts, status }) plus the JSONL resilience helpers reused
 * across the file-backed adapters. Mirrors the A5 providers/shared.ts
 * pattern — adapters never throw to their callers.
 *
 * @module knowledge-adapter-shared
 */

import { readFile } from "node:fs/promises";
import type { KnowledgeArtifact, StoreStatus } from "../contracts/curation-contract.js";

/**
 * Normalized result of a read-only adapter projection.
 *
 * `status` is a StoreStatus: "available" when the store was readable
 * (even if it produced zero artifacts), "unavailable" when the store
 * dir is missing or a read threw. An unavailable store yields no
 * artifacts and no findings — it is a diagnostic, never a proposal.
 */
export interface AdapterResult {
  readonly artifacts: KnowledgeArtifact[];
  readonly status: StoreStatus;
}

/**
 * Filter JSONL lines, skipping corrupt entries.
 *
 * Reuses the resilience pattern from `src/learning/learning-store.ts`:
 * a single bad line must never suppress valid neighboring lines.
 */
export function parseLines(raw: string): unknown[] {
  const results: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // skip corrupt lines — the store doesn't crash on bad data
    }
  }
  return results;
}

/**
 * Read a text file, returning null when it is simply absent (ENOENT).
 *
 * A missing file is treated as an empty store (available, zero artifacts);
 * any other read failure rethrows so the caller can report the store as
 * unavailable.
 */
export async function readTextFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}
