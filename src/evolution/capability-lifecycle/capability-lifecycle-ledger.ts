// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CapabilityLifecycleIntent,
  CapabilityLifecycleRecord,
} from "./contracts/lifecycle-contract.js";
import { parseLines } from "../knowledge/adapters/shared.js";

/** Default A7 ledger location (the `.alix` convention). */
export const DEFAULT_CAPABILITY_LIFECYCLE_FILE = join(
  ".alix", "capability-lifecycle", "lifecycle.jsonl",
);

export interface CapabilityLifecycleLedger {
  /** Append a record. Assigns a write-time-unique recordId that never changes. */
  append(record: Omit<CapabilityLifecycleRecord, "recordId">): Promise<CapabilityLifecycleRecord>;
  list(): Promise<CapabilityLifecycleRecord[]>;
  listByCapability(capabilityId: string): Promise<CapabilityLifecycleRecord[]>;
  listByIntent(intent: CapabilityLifecycleIntent): Promise<CapabilityLifecycleRecord[]>;
  listLatestForCapability(capabilityId: string): Promise<CapabilityLifecycleRecord | null>;
}

/**
 * Append-only JSONL lifecycle ledger. The ledger is history, never authority:
 * current capability state always reads the M-series CapabilityRegistry.
 *
 * Identity rule (spec §5.2): `recordId` is generated once on append and never
 * changes; it is NOT the identity of the proposal/decision. A timestamp is
 * never part of the identity.
 *
 * Never throws on read: a missing file returns empty lists; corrupt lines are
 * skipped (reusing the `parseLines` helper).
 */
export class JsonlCapabilityLifecycleLedger implements CapabilityLifecycleLedger {
  constructor(private readonly filePath: string) {}

  async append(
    record: Omit<CapabilityLifecycleRecord, "recordId">,
  ): Promise<CapabilityLifecycleRecord> {
    const full: CapabilityLifecycleRecord = {
      ...record,
      recordId: `clr-${randomUUID()}`,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, "utf-8");
    return full;
  }

  async list(): Promise<CapabilityLifecycleRecord[]> {
    return this.readAll();
  }

  async listByCapability(capabilityId: string): Promise<CapabilityLifecycleRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.target.capabilityId === capabilityId);
  }

  async listByIntent(intent: CapabilityLifecycleIntent): Promise<CapabilityLifecycleRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.intent === intent);
  }

  async listLatestForCapability(capabilityId: string): Promise<CapabilityLifecycleRecord | null> {
    const byCap = await this.listByCapability(capabilityId);
    if (byCap.length === 0) return null;
    return byCap[byCap.length - 1];
  }

  private readAll(): CapabilityLifecycleRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch {
      return []; // missing file → empty list, never throws
    }
    return parseLines(raw).filter(
      (line): line is CapabilityLifecycleRecord =>
        typeof line === "object" && line !== null &&
        typeof (line as Record<string, unknown>).recordId === "string",
    );
  }
}
