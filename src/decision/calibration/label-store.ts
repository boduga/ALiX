/**
 * label-store.ts — Append-only outcome-label store (J4 task 27).
 *
 * Built on the shared `JsonlStore` primitive (no bespoke JSONL parsing, per
 * #712). Labels are written separately from the ledger so the journal stays an
 * observation record and calibration evidence stays attributable and
 * revocable. Malformed lines are counted, not thrown — the storage contract.
 */

import { join } from "node:path";
import { JsonlStore } from "../../storage/jsonl-store.js";
import {
  createOutcomeLabel,
  isDecisionOutcomeLabel,
  type DecisionOutcomeLabel,
} from "./labels.js";

const LABELS_FILE = "labels.jsonl";

export class LabelWriteError extends Error {
  readonly code = "LABEL_WRITE";
  constructor(message: string, opts?: { cause?: unknown }) {
    super(`Outcome label write failed: ${message}`);
    this.name = "LabelWriteError";
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

export type LabelReadResult = {
  labels: DecisionOutcomeLabel[];
  /** Lines that failed to parse/validate. Never thrown, always surfaced. */
  malformed: number;
};

export type OutcomeLabelStore = {
  append(label: DecisionOutcomeLabel): Promise<void>;
  readAll(): Promise<LabelReadResult>;
  findByDecision(decision: DecisionOutcomeLabel["decision"]): Promise<DecisionOutcomeLabel[]>;
};

export function createOutcomeLabelStore(dir: string): OutcomeLabelStore {
  const store = new JsonlStore(join(dir, LABELS_FILE));

  async function readAll(): Promise<LabelReadResult> {
    const { records, malformed } = await store.readRecords(isDecisionOutcomeLabel);
    return { labels: records, malformed };
  }

  return {
    async append(label: DecisionOutcomeLabel): Promise<void> {
      // Validate before persisting so a bad label never reaches disk.
      const validated = createOutcomeLabel(label);
      try {
        await store.appendRecord(validated);
      } catch (cause) {
        throw new LabelWriteError((cause as Error).message, { cause });
      }
    },
    readAll,
    async findByDecision(decision): Promise<DecisionOutcomeLabel[]> {
      const { labels } = await readAll();
      return labels.filter((label) => label.decision === decision);
    },
  };
}
