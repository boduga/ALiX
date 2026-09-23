/**
 * experiment-store.ts — protected experiment projection store (spec §16).
 *
 * The journal deliberately keeps only `projectionHash` (JEV-2: never persist
 * payload), but an operator cannot establish ground truth from a hash alone.
 * This store keeps the SEALED (post-redaction) projection that was actually
 * evaluated, so `label-pair` can show claim + evidence before truth entry.
 *
 * User-scoped by design — see §16.4: the journal is project-scoped
 * (`{cwd}/.alix/decisions/decisions.jsonl`) while retained evidence lives
 * outside every repository and answers to one user-level retention policy.
 * Resolve via `storeDir ?? join(homedir(), ".alix")`: the same convention as
 * `src/config/calibration-store.ts`. Never hardcode `~`.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { JsonlStore } from "../../../storage/jsonl-store.js";

export type ClaimVerificationExperimentProjection = {
  projectionHash: string;
  decision: "claim-verification";
  claim: string;
  evidence: Array<{ source?: string; excerpt: string }>;
  createdAt: string;
};

export const EXPERIMENTS_FILE = "experiments.jsonl";

/** Canonical: `~/.alix/decisions/experiments.jsonl` (spec §16.4). */
export function experimentStorePath(storeDir?: string): string {
  return join(storeDir ?? join(homedir(), ".alix"), "decisions", EXPERIMENTS_FILE);
}

function isExperimentProjection(value: unknown): value is ClaimVerificationExperimentProjection {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.projectionHash === "string" &&
    record.decision === "claim-verification" &&
    typeof record.claim === "string" &&
    Array.isArray(record.evidence) &&
    typeof record.createdAt === "string"
  );
}

export type ExperimentProjectionStore = {
  path: string;
  append(record: ClaimVerificationExperimentProjection): Promise<void>;
  has(projectionHash: string): Promise<boolean>;
  readByHash(projectionHash: string): Promise<ClaimVerificationExperimentProjection | undefined>;
};

export function createExperimentProjectionStore(storeDir?: string): ExperimentProjectionStore {
  const store = new JsonlStore(experimentStorePath(storeDir));
  async function all(): Promise<ClaimVerificationExperimentProjection[]> {
    const { records } = await store.readRecords(isExperimentProjection);
    return records;
  }
  return {
    path: store.filePath,
    async append(record) {
      await store.appendRecord(record);
    },
    async has(projectionHash) {
      return (await all()).some((r) => r.projectionHash === projectionHash);
    },
    async readByHash(projectionHash) {
      return (await all()).find((r) => r.projectionHash === projectionHash);
    },
  };
}
