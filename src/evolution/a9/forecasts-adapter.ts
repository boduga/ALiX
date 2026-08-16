/**
 * A9 — ForecastsAdapter (Slice 2, Phase 10).
 *
 * Read-only query projection over the forecast store. It supports correlation
 * lookup by subject (proposalId), subjectCapability (capabilityId), and
 * validity window (horizon). It NEVER mutates stored records and exposes no
 * write surface.
 *
 * The adapter does NOT invent correlation semantics: it is a plain query
 * surface over stored forecasts. Cross-forecast grouping, ranking, and any
 * forecast ⇄ measurement linkage are later-slice (correlation engine, Slice 4)
 * concerns.
 *
 * @module evolution/a9/forecasts-adapter
 */

import type { A9Forecast } from "./contracts/a9-contract.js";
import type { ForecastsStore } from "./forecasts-store.js";

export class ForecastsAdapter {
  constructor(private readonly store: ForecastsStore) {}

  /**
   * All stored forecasts, in append order (oldest first).
   */
  async list(): Promise<ReadonlyArray<A9Forecast>> {
    return this.store.list();
  }

  /**
   * Forecasts whose `subject` is the given proposalId (append order).
   */
  async findByProposalId(proposalId: string): Promise<ReadonlyArray<A9Forecast>> {
    const all = await this.store.list();
    return all.filter((f) => f.subject === proposalId);
  }

  /**
   * Forecasts whose `subjectCapability` is the given capabilityId (append order).
   */
  async findByCapability(capabilityId: string): Promise<ReadonlyArray<A9Forecast>> {
    const all = await this.store.list();
    return all.filter((f) => f.subjectCapability === capabilityId);
  }

  /**
   * Forecasts whose validity window contains the given timestamp, boundaries
   * INCLUSIVE: `horizon.from <= timestamp <= horizon.to`.
   *
   * The query timestamp must be parseable (loud, deterministic failure
   * otherwise — mirroring GovernanceReviewStore.queryByWindow). A stored
   * forecast whose horizon is unparseable is deterministically excluded
   * (fail-closed), never thrown.
   *
   * @throws {Error} when `timestamp` is not parseable.
   */
  async findValidAt(timestamp: string): Promise<ReadonlyArray<A9Forecast>> {
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts)) {
      throw new Error(
        `findValidAt: timestamp=${JSON.stringify(timestamp)} is not parseable`,
      );
    }
    const all = await this.store.list();
    return all.filter((f) => {
      const from = Date.parse(f.horizon.from);
      const to = Date.parse(f.horizon.to);
      return from <= ts && ts <= to;
    });
  }
}
