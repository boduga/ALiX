/**
 * config-trust-history.ts — Config Trust History integration (P4.4c).
 *
 * Wires ConfigSigner into EvidenceStore so every signing and trust evaluation
 * produces a durable evidence record. Evidence is recorded after the fact and
 * is best-effort: a failure to record evidence does not fail the signing or
 * evaluation operation.
 *
 * @module
 */

import { join } from "node:path";
import { EvidenceStore } from "./evidence-store.js";
import type { EvidenceRecord } from "./evidence-types.js";
import type { ConfigSignature, TrustReport } from "../../config/signing.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Evidence store directory relative to project root. */
const EVIDENCE_DIR = join(".alix", "security");

// ---------------------------------------------------------------------------
// ConfigTrustHistory
// ---------------------------------------------------------------------------

export class ConfigTrustHistory {
  private readonly store: EvidenceStore;

  /**
   * @param storeDir - Optional override for the evidence store directory.
   *                   Defaults to `<cwd>/.alix/security`.
   */
  constructor(storeDir?: string) {
    const root = storeDir ?? join(process.cwd(), EVIDENCE_DIR);
    this.store = new EvidenceStore({ storeDir: root });
  }

  // -----------------------------------------------------------------------
  // Record a config signing event
  // -----------------------------------------------------------------------

  /**
   * Record a config signing event as a `config_signed` evidence record.
   *
   * Links the evidence fingerprint to the config signature metadata so
   * `alix evidence show <fp>` can answer "what config was signed when."
   *
   * Errors are caught and logged to stderr — this is best-effort and must
   * never fail the enclosing signing operation.
   */
  async recordSign(sig: ConfigSignature): Promise<EvidenceRecord | null> {
    try {
      return await this.store.append("config_signed", {
        configVersion: sig.configVersion,
        keyId: sig.keyId,
        configHash: sig.configHash,
        prevConfigHash: sig.prevConfigHash ?? null,
        signatureFingerprint: sig.signature.slice(0, 16),
      });
    } catch (err) {
      console.warn(`[ConfigTrustHistory] Failed to record sign evidence: ${err}`);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Record a trust evaluation event
  // -----------------------------------------------------------------------

  /**
   * Record a trust evaluation result as a `trust_evaluation` evidence record.
   *
   * Includes whether the config was trusted, signed, signature-valid,
   * version-ok, and the count of issues. Failed evaluations record the
   * reason and error code of the first issue.
   *
   * Errors are caught and logged — this is best-effort and must never
   * fail the enclosing config loading / verification operation.
   */
  async recordTrustEvaluation(
    report: TrustReport,
    configVersion: number,
  ): Promise<EvidenceRecord | null> {
    try {
      const firstError = report.issues.find((i) => i.severity === "error");
      return await this.store.append("trust_evaluation", {
        configVersion,
        trusted: report.trusted,
        signed: report.signed,
        signatureValid: report.signatureValid,
        versionOk: report.versionOk,
        keyId: report.keyId ?? null,
        issueCount: report.issues.length,
        ...(firstError ? { firstErrorCode: firstError.code, firstErrorMessage: firstError.message } : {}),
      });
    } catch (err) {
      console.warn(`[ConfigTrustHistory] Failed to record trust evaluation evidence: ${err}`);
      return null;
    }
  }
}
