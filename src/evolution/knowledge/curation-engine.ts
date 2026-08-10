// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A6 — Curation engine.
 *
 * Orchestrates the read-only store adapters (Task 3) and pure curation
 * detectors (Task 4): runs every adapter to project artifacts, feeds the
 * combined artifact list to every detector, and aggregates findings plus
 * store availability in a deterministic adapter-then-detector order.
 *
 * The engine performs NO detection of its own and NO store writes — it is
 * pure orchestration. An unavailable store (an adapter returning an
 * "unavailable" StoreStatus) contributes no artifacts and therefore no
 * findings, but it never suppresses findings from the other stores and is
 * always surfaced in `storeStatus`.
 *
 * @module curation-engine
 */

import type {
  CurationConfig,
  CurationFinding,
  CurationResult,
  KnowledgeArtifact,
  StoreStatus,
} from "./contracts/curation-contract.js";
import { DEFAULT_CURATION_CONFIG } from "./contracts/curation-contract.js";
import type { AdapterResult } from "./adapters/shared.js";

/**
 * Dependencies for the curation engine.
 *
 * `adapters` are read-only projections — each `read()` returns normalized
 * artifacts plus a StoreStatus and never throws to the engine (see
 * adapters/shared.ts). `detectors` are pure functions over the combined
 * artifact list; the engine supplies the resolved CurationConfig.
 */
export interface CurationEngineDeps {
  readonly adapters: ReadonlyArray<() => Promise<AdapterResult>>;
  readonly detectors: ReadonlyArray<
    (artifacts: KnowledgeArtifact[], config: CurationConfig) => CurationFinding[]
  >;
}

/**
 * Orchestrates store adapters + curation detectors for A6 Knowledge Evolution.
 */
export class CurationEngine {
  private readonly adapters: ReadonlyArray<() => Promise<AdapterResult>>;
  private readonly detectors: ReadonlyArray<
    (artifacts: KnowledgeArtifact[], config: CurationConfig) => CurationFinding[]
  >;

  constructor(deps: CurationEngineDeps) {
    this.adapters = deps.adapters;
    this.detectors = deps.detectors;
  }

  /**
   * Run every adapter and every detector, returning aggregated findings and
   * per-store availability.
   *
   * @param config Detector thresholds; defaults to `DEFAULT_CURATION_CONFIG`.
   * @returns `{ findings, storeStatus }` — findings in adapter-then-detector
   *   order, storeStatus in adapter order.
   */
  async curateAll(config?: CurationConfig): Promise<CurationResult> {
    const resolvedConfig = config ?? DEFAULT_CURATION_CONFIG;

    // 1. Run all adapters, collecting artifacts + per-store availability.
    const results: AdapterResult[] = [];
    for (const read of this.adapters) {
      results.push(await read());
    }
    // A fresh combined array — never mutates any adapter's own artifact list.
    const artifacts: KnowledgeArtifact[] = results.flatMap((r) => r.artifacts);
    const storeStatus: StoreStatus[] = results.map((r) => r.status);

    // 2. Run each detector on the combined artifact list, preserving
    //    adapter-then-detector order (adapters contribute no findings).
    const findings: CurationFinding[] = [];
    for (const detect of this.detectors) {
      findings.push(...detect(artifacts, resolvedConfig));
    }

    return { findings, storeStatus };
  }
}
