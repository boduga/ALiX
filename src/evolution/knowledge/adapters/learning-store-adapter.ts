// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Learning store adapter.
 *
 * Read-only projection of the P8 LearningStore
 * (signals.jsonl, profiles.jsonl, reports.jsonl) into the normalized
 * KnowledgeArtifact read model. Never writes; on a missing dir or a
 * read throw it returns an "unavailable" status with no artifacts.
 *
 * Artifact mapping (design spec §4.1):
 * - LearningSignal      → subject: signalType, claim: delta when present
 * - CalibrationProfile  → subject: target+targetName, claim: suggested value
 * - LearningReport      → artifactKind only
 *
 * @module learning-store-adapter
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CalibrationProfile, LearningReport, LearningSignal } from "../../../learning/learning-types.js";
import type { KnowledgeArtifact } from "../contracts/curation-contract.js";
import { parseLines, readTextFileOrNull, type AdapterResult } from "./shared.js";

const SIGNALS_FILE = "signals.jsonl";
const PROFILES_FILE = "profiles.jsonl";
const REPORTS_FILE = "reports.jsonl";

function signalToArtifact(s: LearningSignal): KnowledgeArtifact {
  return {
    store: "learning",
    artifactId: s.id,
    artifactKind: "LearningSignal",
    subject: s.signalType,
    content: `${s.signalType}: ${s.summary}`,
    createdAt: s.generatedAt,
    evidenceRefs: s.evidenceRefs ?? [],
    downstreamRefs: [],
    ...(s.delta
      ? { claim: { subject: s.signalType, predicate: "delta", value: JSON.stringify(s.delta) } }
      : {}),
  };
}

function profileToArtifact(p: CalibrationProfile): KnowledgeArtifact {
  return {
    store: "learning",
    artifactId: p.id,
    artifactKind: "CalibrationProfile",
    subject: `${p.target}+${p.targetName}`,
    content: `${p.target} ${p.targetName}: ${p.previousValue} -> ${p.suggestedValue}`,
    createdAt: p.generatedAt,
    evidenceRefs: p.evidenceRefs ?? [],
    downstreamRefs: [],
    claim: { subject: p.target, predicate: "value", value: String(p.suggestedValue) },
  };
}

function reportToArtifact(r: LearningReport): KnowledgeArtifact {
  return {
    store: "learning",
    artifactId: r.id,
    artifactKind: "LearningReport",
    content: `LearningReport ${r.windowStart}..${r.windowEnd}: ${r.signals?.length ?? 0} signals, ${r.profiles?.length ?? 0} profiles`,
    createdAt: r.generatedAt,
    evidenceRefs: [],
    downstreamRefs: [],
  };
}

export class LearningStoreAdapter {
  constructor(private readonly dir: string) {}

  async read(): Promise<AdapterResult> {
    try {
      if (!existsSync(this.dir)) {
        return { artifacts: [], status: { status: "unavailable", store: "learning" } };
      }

      const artifacts: KnowledgeArtifact[] = [];

      const signalsRaw = await readTextFileOrNull(join(this.dir, SIGNALS_FILE));
      if (signalsRaw) {
        for (const line of parseLines(signalsRaw)) {
          const s = line as LearningSignal;
          if (typeof s?.id !== "string" || typeof s?.generatedAt !== "string") continue;
          artifacts.push(signalToArtifact(s));
        }
      }

      const profilesRaw = await readTextFileOrNull(join(this.dir, PROFILES_FILE));
      if (profilesRaw) {
        for (const line of parseLines(profilesRaw)) {
          const p = line as CalibrationProfile;
          if (typeof p?.id !== "string" || typeof p?.generatedAt !== "string") continue;
          artifacts.push(profileToArtifact(p));
        }
      }

      const reportsRaw = await readTextFileOrNull(join(this.dir, REPORTS_FILE));
      if (reportsRaw) {
        for (const line of parseLines(reportsRaw)) {
          const r = line as LearningReport;
          if (typeof r?.id !== "string" || typeof r?.generatedAt !== "string") continue;
          artifacts.push(reportToArtifact(r));
        }
      }

      return { artifacts, status: { status: "available", store: "learning" } };
    } catch (err) {
      return {
        artifacts: [],
        status: { status: "unavailable", store: "learning", reason: (err as Error).message ?? String(err) },
      };
    }
  }
}
