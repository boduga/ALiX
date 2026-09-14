/**
 * security.ts — Security diagnostics and Inspector auth management for ALiX.
 *
 * Provides:
 * - `alix security doctor` — Inspector boundary state diagnostics (Sb1)
 * - `alix inspector auth create --name <name> --role <role>` (Sb2)
 * - `alix inspector auth list` (Sb2)
 * - `alix inspector auth rotate <token-id> --grace <duration>` (Sb2)
 * - `alix inspector auth revoke <token-id> [--yes]` (Sb2)
 * - `alix inspector auth doctor` (Sb2)
 * - `alix audit verify [--json]` — streaming audit log verification (Sd2)
 * - `alix audit checkpoint --output <path>` — create signed checkpoint (Sd2)
 * - `alix audit checkpoint-verify <path>` — verify checkpoint (Sd2)
 */

import "../../../config/loader.js";
import "../../../config/validator.js";
import "../../../security/inspector/auth-store.js";
import "../../../security/platform/user-state-paths.js";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import "node:crypto";
import "../../../security/credentials/credential-store.js";
import "../../../security/credentials/credential-reference.js";
import "../../../security/credentials/credential-migration.js";
import "node:os";

// Supply-chain imports (P4.3-Sf)
import "../../../security/supply-chain/dependency-policy.js";
import "../../../security/supply-chain/security-exceptions.js";
import "../../../security/supply-chain/package-verifier.js";
import { jsonMode, setJsonMode } from "./shared.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Audit verify (Sd2)
// ---------------------------------------------------------------------------

export async function handleAuditVerify(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const cwd = process.cwd();
  const auditDir = join(cwd, ".alix", "audit");
  const { verifyAuditLog } = await import("../../../security/audit/audit-verifier.js");

  const result = await verifyAuditLog({ auditDir });

  if (jsonMode) {
    console.log(JSON.stringify(result));
  } else {
    console.log("Audit Log Verification\n");

    const { legacy, v2 } = result.recordCount;
    console.log(`Records:    ${legacy} legacy, ${v2} v2`);
    console.log(`Head:       ${result.headSidecar ? `seq=${result.headSidecar.seq}, hash=${result.headSidecar.recordHash.slice(0, 16)}...` : "none"}`);
    console.log(`Findings:   ${result.findings.length}`);
    console.log();

    if (result.ok) {
      console.log("Result:     OK — no integrity issues detected.");
    } else {
      console.log("Result:     INTEGRITY FAILURE");
      console.log();
      for (const f of result.findings) {
        const prefix = {
          ok: "  [OK]",
          sequence_gap: "  [GAP]",
          hash_mismatch: "  [HASH]",
          duplicate_sequence: "  [DUP]",
          malformed_line: "  [MALF]",
          truncated_tail: "  [TRUNC]",
          legacy_modified: "  [LEGACY]",
          head_mismatch: "  [HEAD]",
          no_chain: "  [CHAIN]",
        }[f.type] ?? "  [?]";

        console.log(`${prefix} ${f.detail ?? ""}`);
        if (f.line) console.log(`         line ${f.line}`);
      }
      console.log();
      console.log("Remediation: The audit log has been tampered with or corrupted.");
      console.log("  - If this is a development environment, delete .alix/audit/ and reinitialize.");
      console.log("  - In production, investigate the integrity breach immediately.");
      console.log("  - Checkpoint evidence (if any) may help determine the last known-good state.");
    }
  }

  process.exit(result.ok ? 0 : 1);
}


// ---------------------------------------------------------------------------
// Audit chain activation (Sd1.6 legacy bridge, exposed for #683)
// ---------------------------------------------------------------------------

export async function loadHead(headPath: string): Promise<{ seq: number; recordHash: string } | null> {
  try {
    const raw = await readFile(headPath, "utf-8");
    const head = JSON.parse(raw) as { seq?: unknown; recordHash?: unknown };
    if (typeof head.seq !== "number" || typeof head.recordHash !== "string") return null;
    return { seq: head.seq, recordHash: head.recordHash };
  } catch {
    return null;
  }
}


/**
 * Seal the legacy audit segment and start the v2 integrity chain.
 * Returns true when a usable head sidecar exists afterwards.
 */
export async function activateAuditChain(auditDir: string): Promise<boolean> {
  const { AuditChainWriter } = await import("../../../security/audit/audit-chain-writer.js");
  try {
    await new AuditChainWriter({ auditDir }).activateLegacy();
  } catch (err) {
    console.error(`Activation failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  return (await loadHead(join(auditDir, "head.json"))) !== null;
}


export async function handleAuditActivate(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const cwd = process.cwd();
  const auditDir = join(cwd, ".alix", "audit");

  const existing = await loadHead(join(auditDir, "head.json"));
  if (existing) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, alreadyActive: true, seq: existing.seq }));
    } else {
      console.log(`Integrity chain already active (head seq=${existing.seq}). Nothing to do.`);
    }
    process.exit(0);
  }

  const { AuditChainWriter } = await import("../../../security/audit/audit-chain-writer.js");
  type ActivationResult = import("../../../audit/audit-types.js").ActivationResult;
  const writer = new AuditChainWriter({ auditDir });
  let result: ActivationResult;
  try {
    result = await writer.activateLegacy();
  } catch (err) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    } else {
      console.error(`Activation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, ...result }));
  } else if (result.activated) {
    console.log("Integrity chain activated.");
    console.log(`Legacy records sealed: ${result.legacyCount} (${result.legacyBytes} bytes, digest ${result.legacyDigest?.slice(0, 16)}...)`);
    console.log("New audit records are hash-chained from here on. Verify with: alix audit verify");
  } else {
    console.log(`Chain not activated: ${result.reason}`);
  }
  process.exit(0);
}


// ---------------------------------------------------------------------------
// Audit checkpoint (Sd2)
// ---------------------------------------------------------------------------

export async function handleAuditCheckpoint(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  if (!outputPath) {
    console.error("Usage: alix audit checkpoint --output <path> [--json]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const auditDir = join(cwd, ".alix", "audit");
  const headPath = join(auditDir, "head.json");

  // 1. Load the head sidecar — activating the legacy chain first when no
  // usable head exists (#683: checkpoint must not fail just because the
  // chain was never initialized).
  let head: { seq: number; recordHash: string } | null = await loadHead(headPath);
  if (!head) {
    console.error("No integrity chain present. Activating the legacy audit log first...");
    const activated = await activateAuditChain(auditDir);
    if (!activated) {
      console.error("Error: Could not initialize the integrity chain.");
      process.exit(2);
    }
    head = await loadHead(headPath);
  }

  if (!head) {
    console.error("Error: Head sidecar is malformed.");
    process.exit(2);
  }

  // 2. Load or create the checkpoint keypair.
  const { loadOrCreateCheckpointKeyPair, createCheckpoint } = await import(
    "../../../security/audit/audit-checkpoint.js"
  );

  const keyPair = loadOrCreateCheckpointKeyPair();

  // 3. Create the checkpoint.
  const workspaceId = cwd;
  const signed = createCheckpoint({
    workspaceId,
    sequence: head.seq,
    recordHash: head.recordHash,
    privateKeyPem: keyPair.privateKeyPem,
    keyId: keyPair.keyId,
  });

  // 4. Write to output.
  const outDir = join(outputPath, "..");
  await mkdir(outDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(signed, null, 2) + "\n", "utf-8");

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, path: outputPath, keyId: keyPair.keyId }));
  } else {
    console.log(`Checkpoint written to: ${outputPath}`);
    console.log(`Key ID:               ${keyPair.keyId}`);
    console.log(`Sequence:             ${head.seq}`);
    console.log(`Record hash:          ${head.recordHash.slice(0, 16)}...`);
    console.log();
    console.log("Note: This is tamper-evident evidence, not a tamper-proof guarantee.");
    console.log("  Store the checkpoint file externally (off-machine) for reliable anchoring.");
    console.log("  The private key is at: ~/.local/state/alix-inspector/audit-checkpoint.key");
  }

  process.exit(0);
}


// ---------------------------------------------------------------------------
// Audit checkpoint-verify (Sd2)
// ---------------------------------------------------------------------------

export async function handleAuditCheckpointVerify(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const checkpointPath = args[0];
  if (!checkpointPath) {
    console.error("Usage: alix audit checkpoint-verify <path> [--json]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const workspaceId = cwd;

  // 1. Load the checkpoint file.
  let checkpoint: unknown;
  try {
    const raw = await readFile(checkpointPath, "utf-8");
    checkpoint = JSON.parse(raw);
  } catch {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: "Failed to read checkpoint file" }));
    } else {
      console.error("Error: Failed to read checkpoint file.");
    }
    process.exit(2);
  }

  // 2. Verify the checkpoint signature.
  const { verifyCheckpoint, loadOrCreateCheckpointKeyPair, importTrustedPublicKey } = await import(
    "../../../security/audit/audit-checkpoint.js"
  );

  // Auto-import our own public key so self-signed checkpoints are verifiable.
  const ownKeyPair = loadOrCreateCheckpointKeyPair();
  importTrustedPublicKey(ownKeyPair.publicKeyPem, ownKeyPair.keyId);

  const sigResult = verifyCheckpoint({
    checkpoint: checkpoint as any,
    workspaceId,
  });

  if (!sigResult.ok) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, reason: sigResult.reason }));
    } else {
      console.error(`Signature verification failed: ${sigResult.reason}`);
      console.error();
      console.error("The checkpoint signature is invalid. Possible causes:");
      console.error("  - The checkpoint was created with a different keypair.");
      console.error("  - The checkpoint payload was modified after signing.");
      console.error("  - The workspace ID does not match (checkpoint from another project).");
    }
    process.exit(1);
  }

  // 3. Verify sequence/recordHash against the audit chain.
  const cp = (checkpoint as any).payload;
  const auditDir = join(cwd, ".alix", "audit");
  const headPath = join(auditDir, "head.json");

  let chainOk = false;
  let chainDetail = "";

  try {
    const raw = await readFile(headPath, "utf-8");
    const head = JSON.parse(raw);

    if (head.seq === cp.sequence && head.recordHash === cp.recordHash) {
      chainOk = true;
      chainDetail = "Checkpoint matches current head sidecar.";
    } else if (head.seq >= cp.sequence) {
      chainDetail = `Head sidecar is at seq ${head.seq} (checkpoint anchors seq ${cp.sequence}). The checkpoint refers to an earlier state.`;
    } else {
      chainDetail = `Head sidecar is at seq ${head.seq} (checkpoint anchors seq ${cp.sequence}). The checkpoint refers to a future state — head may be out of date.`;
    }
  } catch {
    chainDetail = "Could not verify against audit chain (no head sidecar).";
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      ok: true,
      signature: true,
      chainMatch: chainOk,
      detail: chainDetail,
      keyId: cp.keyId,
      workspace: cp.workspaceId,
      sequence: cp.sequence,
      timestamp: cp.timestamp,
    }));
  } else {
    console.log("Checkpoint Verification\n");
    console.log(`Signature:  OK (keyId=${cp.keyId})`);
    console.log(`Workspace:  ${cp.workspaceId === workspaceId ? "match" : "MISMATCH"}`);
    console.log(`Sequence:   ${cp.sequence}`);
    console.log(`Timestamp:  ${new Date(cp.timestamp).toISOString()}`);
    console.log(`Chain:      ${chainOk ? "match" : chainDetail}`);
    console.log();
    if (chainOk) {
      console.log("Result:     OK — checkpoint is valid and matches current chain head.");
    } else {
      console.log("Result:     Signature valid, but chain state differs.");
      console.log(`  ${chainDetail}`);
    }
  }

  process.exit(0);
}
