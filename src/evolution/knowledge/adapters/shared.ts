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

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type {
  KnowledgeArtifact,
  KnowledgeStore,
  StoreStatus,
} from "../contracts/curation-contract.js";

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

/**
 * Run a read-only store projection with the adapter's never-throw contract.
 *
 * Every A6 store adapter wraps its `read()` in the same try/catch: a
 * successful projection returns "available" with whatever artifacts were
 * read (even zero — an empty store is still available), and any thrown error
 * returns "unavailable" with the message as reason. This helper collapses
 * that repeated wrapper so an adapter is just a projection function.
 */
export async function runAdapter(
  store: KnowledgeStore,
  project: () => Promise<KnowledgeArtifact[]>,
  dir?: string,
): Promise<AdapterResult> {
  try {
    // Missing store dir → unavailable (design spec §4.6) — a diagnostic
    // storeStatus, NOT a curation finding and never a proposal.
    if (dir !== undefined && !existsSync(dir)) {
      return { artifacts: [], status: { status: "unavailable", store } };
    }
    return { artifacts: await project(), status: { status: "available", store } };
  } catch (err) {
    return {
      artifacts: [],
      status: {
        status: "unavailable",
        store,
        reason: (err as Error).message ?? String(err),
      },
    };
  }
}
