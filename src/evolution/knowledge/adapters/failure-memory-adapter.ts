// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Failure memory adapter.
 *
 * Read-only projection of the P12.5 autonomous governance failure
 * memory store (failure-memory.jsonl) into the normalized
 * KnowledgeArtifact read model. Never writes; on a missing dir or a
 * read throw it returns an "unavailable" status with no artifacts.
 *
 * Artifact mapping (design spec §4.1):
 * - FailureRecord → subject: failureType, claim: failureType/detail
 *
 * @module failure-memory-adapter
 */

import { join } from "node:path";
import type { FailureRecord } from "../../../governance/failure-memory.js";
import type { KnowledgeArtifact } from "../contracts/curation-contract.js";
import { parseLines, readTextFileOrNull, runAdapter, type AdapterResult } from "./shared.js";

const STORAGE_FILE = "failure-memory.jsonl";

function recordToArtifact(r: FailureRecord): KnowledgeArtifact {
  return {
    store: "failure_memory",
    artifactId: `${r.runId}:${r.timestamp}`,
    artifactKind: "FailureRecord",
    subject: r.failureType,
    content: r.detail,
    createdAt: r.timestamp,
    evidenceRefs: [],
    downstreamRefs: [],
    claim: { subject: r.failureType, predicate: "failureType", value: r.detail },
  };
}

export class FailureMemoryAdapter {
  constructor(private readonly dir: string) {}

  async read(): Promise<AdapterResult> {
    return runAdapter(
      "failure_memory",
      async () => {
      const artifacts: KnowledgeArtifact[] = [];

      const raw = await readTextFileOrNull(join(this.dir, STORAGE_FILE));
      if (raw) {
        for (const line of parseLines(raw)) {
          const r = line as FailureRecord;
          if (
            typeof r?.runId !== "string" ||
            typeof r?.timestamp !== "string" ||
            typeof r?.failureType !== "string" ||
            typeof r?.detail !== "string"
          ) {
            continue;
          }
          artifacts.push(recordToArtifact(r));
        }
      }

      return artifacts;
      },
      this.dir,
    );
  }
}
