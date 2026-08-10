// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Chronicle store adapter.
 *
 * Read-only projection of the chronicle store
 * (.alix/chronicle/index.json + entries/<entryId>.json) into the
 * normalized KnowledgeArtifact read model. The constructor takes the
 * same root directory the ChronicleStore constructor takes — the adapter
 * is a drop-in read-only view over an existing chronicle store. Never
 * writes; on a missing dir or a read throw it returns an "unavailable"
 * status with no artifacts.
 *
 * Artifact mapping (design spec §4.1):
 * - ChronicleEntry → claim: native outcome (subject: signalCode)
 *
 * @module chronicle-adapter
 */

import { join } from "node:path";
import type { ChronicleEntry } from "../../../chronicle/chronicle-store.js";
import type { KnowledgeArtifact } from "../contracts/curation-contract.js";
import { readTextFileOrNull, runAdapter, type AdapterResult } from "./shared.js";

/** The index.json summary subset the adapter uses to enumerate entry files. */
interface ChronicleIndexEntry {
  entryId: string;
}

function entryToArtifact(entry: ChronicleEntry): KnowledgeArtifact {
  return {
    store: "chronicle",
    artifactId: entry.entryId,
    artifactKind: "ChronicleEntry",
    content: `${entry.problem}\n${entry.diagnosis}\n${entry.actionTaken}\n${entry.lesson}`,
    createdAt: entry.createdAt,
    evidenceRefs: [],
    downstreamRefs: [],
    claim: { subject: entry.signalCode, predicate: "outcome", value: entry.outcome },
  };
}

export class ChronicleAdapter {
  constructor(private readonly rootDir: string) {}

  async read(): Promise<AdapterResult> {
    const chronicleDir = join(this.rootDir, ".alix", "chronicle");
    return runAdapter(
      "chronicle",
      async () => {
        const artifacts: KnowledgeArtifact[] = [];

        const indexRaw = await readTextFileOrNull(join(chronicleDir, "index.json"));
        if (indexRaw) {
          let index: unknown;
          try {
            index = JSON.parse(indexRaw);
          } catch {
            index = null; // corrupt index — treat as empty, don't crash
          }
          if (Array.isArray(index)) {
            for (const ix of index as ChronicleIndexEntry[]) {
              if (typeof ix?.entryId !== "string") continue;
              const entryRaw = await readTextFileOrNull(join(chronicleDir, "entries", `${ix.entryId}.json`));
              if (!entryRaw) continue; // missing entry file — skip
              let entry: ChronicleEntry;
              try {
                entry = JSON.parse(entryRaw) as ChronicleEntry;
              } catch {
                continue; // corrupt entry file — skip, don't suppress neighbors
              }
              if (
                typeof entry?.entryId !== "string" ||
                typeof entry?.createdAt !== "string" ||
                typeof entry?.signalCode !== "string" ||
                typeof entry?.outcome !== "string" ||
                typeof entry?.problem !== "string" ||
                typeof entry?.diagnosis !== "string" ||
                typeof entry?.actionTaken !== "string" ||
                typeof entry?.lesson !== "string"
              ) {
                continue;
              }
              artifacts.push(entryToArtifact(entry));
            }
          }
        }

        return artifacts;
      },
      chronicleDir,
    );
  }
}
