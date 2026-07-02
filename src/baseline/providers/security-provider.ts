/**
 * P10.10.4 — SecurityBaselineProvider.
 *
 * Observes persisted security state from .alix/ directories.
 * Persistent baseline provider — file state survives process restarts.
 *
 * @module
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { BaselineArtifact } from "../baseline-types.js";
import type { BaselineProvider } from "../baseline-provider.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLICIES_DIR = join(".alix", "policies");
const EVIDENCE_DIR = join(".alix", "security");
const CREDENTIALS_DIR = join(".alix", "credentials");

// ---------------------------------------------------------------------------
// SecurityBaselineProvider
// ---------------------------------------------------------------------------

export class SecurityBaselineProvider implements BaselineProvider {
  readonly subsystem = "security" as const;
  readonly version = "1.0.0";
  readonly description = "Security baseline provider — observes policies, evidence chain, and credentials";
  readonly state = "ready" as const;
  readonly capabilities = ["capture"];

  private baselineCache: BaselineArtifact | null = null;

  async captureBaseline(): Promise<BaselineArtifact> {
    if (this.baselineCache) return this.baselineCache;
    const artifact = this.capture();
    this.baselineCache = artifact;
    return artifact;
  }

  /** Re-reads security files on every call for comparison. */
  async captureCurrent(): Promise<BaselineArtifact> {
    return this.capture();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private capture(): BaselineArtifact {
    const cwd = process.cwd();
    const data: Record<string, number> = {};

    // -------------------------------------------------------------------
    // 1. Policies — .alix/policies/*.json
    // -------------------------------------------------------------------
    data.policyCount = 0;
    const policiesDir = join(cwd, POLICIES_DIR);
    if (existsSync(policiesDir)) {
      try {
        const files = readdirSync(policiesDir).filter((f: string) => f.endsWith(".json"));
        data.policyCount = files.length;
      } catch {
        // Directory read error — stay 0
      }
    }

    // -------------------------------------------------------------------
    // 2. Evidence — .alix/security/evidence.jsonl
    // -------------------------------------------------------------------
    data.evidenceRecordCount = 0;
    data.invalidEvidenceRecords = 0;
    data.chainIntegrityOk = 1;

    const evidenceFile = join(cwd, EVIDENCE_DIR, "evidence.jsonl");
    if (existsSync(evidenceFile)) {
      try {
        const content = readFileSync(evidenceFile, "utf-8");
        const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
        data.evidenceRecordCount = lines.length;

        let invalidCount = 0;
        const validRecords: Array<Record<string, unknown>> = [];

        for (const line of lines) {
          try {
            const record = JSON.parse(line) as Record<string, unknown>;
            validRecords.push(record);
          } catch {
            invalidCount++;
          }
        }

        data.invalidEvidenceRecords = invalidCount;

        if (invalidCount > 0) {
          data.chainIntegrityOk = 0;
        } else if (validRecords.length <= 1) {
          data.chainIntegrityOk = 1;
        } else {
          let chainOk = 1;
          for (let i = 1; i < validRecords.length; i++) {
            const prev = validRecords[i - 1];
            const curr = validRecords[i];
            if (
              !prev.fingerprint ||
              !curr.fingerprint ||
              curr.previousFingerprint !== prev.fingerprint
            ) {
              chainOk = 0;
              break;
            }
          }
          data.chainIntegrityOk = chainOk;
        }
      } catch {
        // File read error — all evidence metrics stay 0 defaults
        data.evidenceRecordCount = 0;
        data.invalidEvidenceRecords = 0;
        data.chainIntegrityOk = 0;
      }
    }

    // -------------------------------------------------------------------
    // 3. Credentials — .alix/credentials/
    // -------------------------------------------------------------------
    data.credentialFiles = 0;
    const credentialsDir = join(cwd, CREDENTIALS_DIR);
    if (existsSync(credentialsDir)) {
      try {
        const files = readdirSync(credentialsDir);
        data.credentialFiles = files.length;
      } catch {
        // Directory read error — stay 0
      }
    }

    return {
      subsystem: "security",
      capturedAt: new Date().toISOString(),
      data,
    };
  }
}
