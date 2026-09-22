/**
 * fixtures.ts — Stored, redacted replay fixtures (J5 task 31).
 *
 * A fixture is a SEALED projection plus decision metadata. Only a projection
 * that passes verification can become a fixture — the boundary gate runs
 * before anything is stored, so a fixture file is replayable evidence, not
 * raw state. Files are written atomically with restrictive permissions.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeJsonFileAtomicSync } from "../../storage/jsonl-store.js";
import {
  verifySealedProjection,
  type RemoteSealedProjection,
} from "../boundary.js";
import type { DecisionType } from "../contracts.js";

export type ReplayFixture = {
  id: string;
  decision: DecisionType;
  sealed: RemoteSealedProjection<Record<string, unknown>>;
  /** Candidate set the fixture was scored against, when bounded. */
  candidates?: readonly unknown[];
  /** Ground-truth label for accuracy comparison (corpus fixture). */
  expected?: unknown;
  exportedAt: number;
};

export class FixtureValidationError extends Error {
  readonly code = "FIXTURE_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "FixtureValidationError";
  }
}

export function isReplayFixture(value: unknown): value is ReplayFixture {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.decision === "string" &&
    v.decision.length > 0 &&
    typeof v.exportedAt === "number" &&
    Number.isFinite(v.exportedAt) &&
    verifySealedProjection(v.sealed)
  );
}

function throwIfFixtureInvalid(condition: boolean, message: string): void {
  if (condition) throw new FixtureValidationError(message);
}

/**
 * Build a fixture from a sealed projection. The seal is re-verified here —
 * an unsealed or forged payload can never become a stored fixture.
 */
export function exportReplayFixture(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  input: {
    id: string;
    decision: DecisionType;
    candidates?: readonly unknown[];
    expected?: unknown;
    now?: number;
  },
): ReplayFixture {
  throwIfFixtureInvalid(!verifySealedProjection(sealed), "sealed projection failed verification");
  throwIfFixtureInvalid(typeof input.id !== "string" || input.id.length === 0, "id required");
  throwIfFixtureInvalid(
    typeof input.decision !== "string" || input.decision.length === 0,
    "decision required",
  );
  const exportedAt = input.now ?? Date.now();
  throwIfFixtureInvalid(!Number.isFinite(exportedAt), "exportedAt must be finite");
  return {
    id: input.id,
    decision: input.decision,
    sealed,
    ...(input.candidates !== undefined ? { candidates: [...input.candidates] } : {}),
    ...(input.expected !== undefined ? { expected: input.expected } : {}),
    exportedAt,
  };
}

/** Persist a fixture atomically (0o600 via the storage primitive). */
export function saveReplayFixture(path: string, fixture: ReplayFixture): void {
  throwIfFixtureInvalid(!isReplayFixture(fixture), "not a valid replay fixture");
  writeJsonFileAtomicSync(path, fixture);
}

/** Load and validate one fixture file. Throws on missing/corrupt/invalid. */
export function loadReplayFixture(path: string): ReplayFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new FixtureValidationError(`cannot read fixture ${path}: ${(cause as Error).message}`);
  }
  throwIfFixtureInvalid(!isReplayFixture(parsed), `invalid replay fixture: ${path}`);
  return parsed as ReplayFixture;
}

/** Load every `.json` fixture in a directory (sorted by filename). */
export function listReplayFixtures(dir: string): ReplayFixture[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch (cause) {
    throw new FixtureValidationError(
      `cannot list fixtures in ${dir}: ${(cause as Error).message}`,
    );
  }
  return names.map((name) => loadReplayFixture(join(dir, name)));
}
