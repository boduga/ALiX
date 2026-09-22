/**
 * label-store.ts — Append-only outcome-label store (J4 task 27).
 *
 * Mirrors the decision journal's shape: JSONL, append-only, explicit
 * read/write errors. Labels are written separately from the ledger so the
 * journal stays an observation record and calibration evidence stays
 * attributable and revocable.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createOutcomeLabel,
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

export class LabelReadError extends Error {
  readonly code = "LABEL_READ";
  constructor(message: string, opts?: { cause?: unknown }) {
    super(`Outcome label read failed: ${message}`);
    this.name = "LabelReadError";
    if (opts?.cause !== undefined) this.cause = opts.cause;
  }
}

export type OutcomeLabelStore = {
  append(label: DecisionOutcomeLabel): void;
  readAll(): DecisionOutcomeLabel[];
  findByDecision(decision: DecisionOutcomeLabel["decision"]): DecisionOutcomeLabel[];
};

export function createOutcomeLabelStore(dir: string): OutcomeLabelStore {
  const path = join(dir, LABELS_FILE);

  function readAll(): DecisionOutcomeLabel[] {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new LabelReadError((cause as Error).message, { cause });
    }
    const labels: DecisionOutcomeLabel[] = [];
    for (const [index, line] of text.split("\n").entries()) {
      if (line.trim().length === 0) continue;
      try {
        // Re-validate on read: the file is not a trusted boundary.
        labels.push(createOutcomeLabel(JSON.parse(line) as DecisionOutcomeLabel));
      } catch (cause) {
        throw new LabelReadError(`corrupt line ${index + 1}`, { cause });
      }
    }
    return labels;
  }

  return {
    append(label: DecisionOutcomeLabel): void {
      // Validate before persisting so a bad label never reaches disk.
      const validated = createOutcomeLabel(label);
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(path, `${JSON.stringify(validated)}\n`, "utf8");
      } catch (cause) {
        throw new LabelWriteError((cause as Error).message, { cause });
      }
    },
    readAll,
    findByDecision(decision): DecisionOutcomeLabel[] {
      return readAll().filter((label) => label.decision === decision);
    },
  };
}
