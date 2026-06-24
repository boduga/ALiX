/**
 * P9.4a — GovernanceChangeApplier.
 *
 * Applies an approved governance_change proposal by validating the payload,
 * snapshotting the target file, and performing the mutation atomically.
 *
 * CORE INVARIANT: Only approved governance_change proposals may mutate
 * governance files. Every mutation requires:
 *   validate → snapshot → pre-write hash check → atomic write → evidence
 *
 * Follows the same pattern as AgentCardApplier: the applier handles
 * snapshot + mutation. The ApprovalGate handles evidence recording and
 * status transition.
 *
 * P9.4a SUPPORTED_KINDS = { "confidence_calibration", "lens_adjustment" }
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AdaptationProposal } from "../adaptation-types.js";
import type { GovernanceChangePayload } from "../../governance/governance-types.js";
import type { SnapshotStore } from "../snapshot-store.js";
import type { EvidenceEventWriter } from "../../workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOV_DIR = ".alix/governance";
const CALIBRATION_FILE = "calibration.json";
const LENS_REGISTRY_FILE = "lens-registry.json";

const SUPPORTED_KINDS = new Set<string>([
  "confidence_calibration",
  "lens_adjustment",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`Governance file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function atomicWriteJson(path: string, data: Record<string, unknown>): void {
  const tmpPath = path + ".tmp";
  const fd = openSync(tmpPath, "w");
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2), "utf-8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

// ---------------------------------------------------------------------------
// GovernanceChangeApplier
// ---------------------------------------------------------------------------

export interface GovernanceChangeApplierOptions {
  /** Hook called after snapshot but before mutation — for testing pre-write hash mismatch. */
  onBeforeMutation?: () => void;
}

export class GovernanceChangeApplier {
  private static lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly cwd: string,
    private readonly snapshotStore: SnapshotStore,
    private readonly writer: EvidenceEventWriter,
    private readonly options?: GovernanceChangeApplierOptions,
  ) {}

  /**
   * Apply an approved governance_change proposal.
   * Throws with a descriptive message if any validation or mutation step fails.
   */
  async apply(proposal: AdaptationProposal): Promise<void> {
    // (1) Validate status
    if (proposal.status !== "approved") {
      throw new Error(
        `GovernanceChangeApplier: proposal status is "${proposal.status}", expected "approved"`,
      );
    }

    // (2) Validate action
    if (proposal.action !== "governance_change") {
      throw new Error(
        `GovernanceChangeApplier: proposal action is "${proposal.action}", expected "governance_change"`,
      );
    }

    const payload = proposal.payload as GovernanceChangePayload;

    // (3) Validate kind is supported
    if (!SUPPORTED_KINDS.has(payload.kind)) {
      throw new Error(
        `GovernanceChangeApplier does not support ${payload.kind} in P9.4a. ` +
        `Supported kinds: ${[...SUPPORTED_KINDS].join(", ")}`,
      );
    }

    // (4) Resolve target file
    const targetFile = this.resolveTargetFile(payload.kind);

    // (5) Read and validate
    const data = readJson(targetFile);
    const validatedHash = this.computeFileHash(targetFile);

    this.validateSchema(payload.kind, data);
    this.validateCurrentValues(payload, data);

    // Acquire mutation lock (serializes steps 6-9)
    const release = await this.acquireLock();
    try {
      // (6) Snapshot target file
      await this.snapshotTarget(targetFile, proposal);

      // Hook for testing pre-write hash mismatch (fire before hash check)
      this.options?.onBeforeMutation?.();

      // (7) Pre-write hash check
      const preWriteHash = this.computeFileHash(targetFile);
      if (preWriteHash !== validatedHash) {
        throw new Error(
          `Governance mutation aborted: target file changed between validation and mutation ` +
          `(hash: ${preWriteHash.slice(0, 8)} vs ${validatedHash.slice(0, 8)})`,
        );
      }

      // (8) Mutate
      const mutated = this.applyMutation(payload, data);

      // (9) Write atomically
      atomicWriteJson(targetFile, mutated);
    } finally {
      // Release lock — next governance mutation can proceed
      release();
    }
  }

  // -----------------------------------------------------------------------
  // Private: file resolution
  // -----------------------------------------------------------------------

  private resolveTargetFile(kind: string): string {
    const govDir = join(this.cwd, GOV_DIR);
    switch (kind) {
      case "confidence_calibration":
        return join(govDir, CALIBRATION_FILE);
      case "lens_adjustment":
        return join(govDir, LENS_REGISTRY_FILE);
      default:
        throw new Error(`Unknown governance payload kind: ${kind}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: schema validation
  // -----------------------------------------------------------------------

  private validateSchema(kind: string, data: Record<string, unknown>): void {
    switch (kind) {
      case "confidence_calibration": {
        if (!Array.isArray(data.calibrations)) {
          throw new Error(
            "Invalid calibration.json schema: expected 'calibrations' array",
          );
        }
        break;
      }
      case "lens_adjustment": {
        if (!Array.isArray(data.lenses)) {
          throw new Error(
            "Invalid lens-registry.json schema: expected 'lenses' array",
          );
        }
        break;
      }
      default:
        throw new Error(`Unknown governance payload kind for schema validation: ${kind}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: drift detection
  // -----------------------------------------------------------------------

  private validateCurrentValues(
    payload: GovernanceChangePayload,
    data: Record<string, unknown>,
  ): void {
    switch (payload.kind) {
      case "confidence_calibration": {
        const calibrations = data.calibrations as Array<{ target: string; value: number }>;
        const entry = calibrations.find((c) => c.target === payload.target);
        if (!entry) {
          throw new Error(
            `Calibration drift: target "${payload.target}" not found in calibration.json`,
          );
        }
        if (entry.value !== payload.currentCalibration) {
          throw new Error(
            `Calibration drift detected for "${payload.target}": ` +
            `expected ${payload.currentCalibration}, found ${entry.value}`,
          );
        }
        break;
      }
      case "lens_adjustment": {
        const lenses = data.lenses as Array<{ lens: string }>;
        const entry = lenses.find((l) => l.lens === payload.lens);
        if (!entry) {
          throw new Error(
            `Lens adjustment drift: lens "${payload.lens}" not found in lens-registry.json`,
          );
        }
        break;
      }
      default:
        throw new Error(`Unknown governance payload kind for value validation: ${(payload as any).kind}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: mutation
  // -----------------------------------------------------------------------

  private applyMutation(
    payload: GovernanceChangePayload,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (payload.kind) {
      case "confidence_calibration": {
        const calibrations = [...(data.calibrations as Array<{ target: string; value: number }>)];
        const idx = calibrations.findIndex((c) => c.target === payload.target);
        calibrations[idx] = { ...calibrations[idx], value: payload.suggestedCalibration };
        return { ...data, calibrations };
      }
      case "lens_adjustment": {
        const lenses = [...(data.lenses as Array<{ lens: string; status: string; enabled?: boolean }>)];
        const idx = lenses.findIndex((l) => l.lens === payload.lens);
        switch (payload.operation) {
          case "promote":
            lenses[idx] = { ...lenses[idx], status: "active" };
            break;
          case "demote":
            lenses[idx] = { ...lenses[idx], status: "demoted" };
            break;
          case "retire":
            lenses[idx] = { ...lenses[idx], status: "retired", enabled: false };
            break;
          default:
            throw new Error(
              `Unsupported lens_adjustment operation: "${(payload as any).operation}". ` +
              `Expected "promote", "demote", or "retire".`,
            );
        }
        return { ...data, lenses };
      }
      default:
        throw new Error(`Unsupported governance mutation kind: ${(payload as any).kind}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: snapshot
  // -----------------------------------------------------------------------

  private async snapshotTarget(
    filePath: string,
    proposal: AdaptationProposal,
  ): Promise<void> {
    const content = readFileSync(filePath, "utf-8");
    const base64 = Buffer.from(content, "utf-8").toString("base64");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const fingerprint = randomUUID();

    await this.snapshotStore.save({
      proposalId: proposal.id,
      snapshotAt: new Date().toISOString(),
      action: proposal.action,
      target: proposal.target as { kind: string } & Record<string, unknown>,
      filePath,
      content: base64,
      contentHash,
      fingerprint,
    });

    await this.writer.recordSnapshotTaken(proposal.id, {
      snapshotFingerprint: fingerprint,
      contentHash,
      filePath,
    });
  }

  // -----------------------------------------------------------------------
  // Private: hashing
  // -----------------------------------------------------------------------

  private computeFileHash(filePath: string): string {
    const content = readFileSync(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  }

  // -----------------------------------------------------------------------
  // Private: process-local mutation lock
  // -----------------------------------------------------------------------

  /**
   * Acquire the process-local governance mutation lock.
   * Serializes concurrent governance writes within the same process.
   * Returns a release function.
   */
  private async acquireLock(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const prev = GovernanceChangeApplier.lock;
    GovernanceChangeApplier.lock = next;
    await prev;
    return release!;
  }
}
