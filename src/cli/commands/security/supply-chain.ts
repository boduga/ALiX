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
import "node:path";
import "node:crypto";
import "../../../security/credentials/credential-store.js";
import "../../../security/credentials/credential-reference.js";
import "../../../security/credentials/credential-migration.js";
import "node:os";

// Supply-chain imports (P4.3-Sf)
import { runLifecycleCheck } from "../../../security/supply-chain/dependency-policy.js";
import { runExceptionsCheck } from "../../../security/supply-chain/security-exceptions.js";
import { runTarballVerification } from "../../../security/supply-chain/package-verifier.js";
import { jsonMode, setJsonMode } from "./shared.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// P4.3-Sf supply-chain commands
// ---------------------------------------------------------------------------

/**
 * alix security supply-chain lifecycle-check
 */
export async function handleSupplyChainLifecycleCheck(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));
  const cwd = process.cwd();

  const result = await runLifecycleCheck(cwd);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log(`\nLifecycle Script Check — ${result.ok ? "PASSED" : "FAILED"}\n`);
  console.log(`Total packages with lifecycle scripts: ${result.totalLifecyclePackages}`);
  console.log(`Approved: ${result.approved.length}`);
  console.log(`Unapproved: ${result.newUnapproved.length}`);
  console.log(`Expired entries: ${result.expiredEntries.length}`);
  console.log();

  if (result.newUnapproved.length > 0) {
    console.log("NEW UNAPPROVED PACKAGES:");
    for (const p of result.newUnapproved) {
      console.log(`  - ${p.name}@${p.version} (${p.nodeModulesPath}) [${p.isDirect ? "direct" : "transitive"}]`);
    }
    console.log();
  }

  if (result.expiredEntries.length > 0) {
    console.log("EXPIRED ALLOWLIST ENTRIES:");
    for (const e of result.expiredEntries) {
      console.log(`  - ${e.name} (expired: ${e.expiry}, owner: ${e.owner})`);
    }
    console.log();
  }

  if (result.approved.length > 0) {
    console.log("APPROVED:");
    for (const p of result.approved) {
      console.log(`  - ${p.name}@${p.version}`);
    }
    console.log();
  }

  for (const f of result.findings) {
    const prefix = f.severity === "error" ? "ERROR" : "WARNING";
    console.log(`[${prefix}] [${f.code}] ${f.message}`);
    if (f.details) console.log(`  ${f.details}`);
    console.log();
  }

  process.exit(result.ok ? 0 : 1);
}


/**
 * alix security supply-chain exceptions list
 * alix security supply-chain exceptions check
 */
export async function handleSupplyChainExceptions(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));
  const cwd = process.cwd();

  const result = await runExceptionsCheck(cwd);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log(`\nAudit Exceptions — ${result.ok ? "OK" : "ISSUES FOUND"}\n`);
  console.log(`Total exceptions: ${result.excepted.length}`);
  console.log(`Unexcepted advisories: ${result.unexcepted.length}`);
  console.log(`Expired exceptions: ${result.expiredExceptions.length}`);
  console.log();

  if (result.excepted.length > 0) {
    console.log("EXCEPTED:");
    for (const e of result.excepted) {
      console.log(`  - [${e.severity}] ${e.package}: ${e.title}`);
    }
    console.log();
  }

  if (result.unexcepted.length > 0) {
    console.log("UNEXCEPTED:");
    for (const u of result.unexcepted) {
      console.log(`  - [${u.severity}] ${u.package}: ${u.title}`);
    }
    console.log();
  }

  for (const f of result.findings) {
    const prefix = f.severity === "error" ? "ERROR" : "WARNING";
    console.log(`[${prefix}] [${f.code}] ${f.message}`);
    if (f.details) console.log(`  ${f.details}`);
    console.log();
  }

  process.exit(result.ok ? 0 : 1);
}


/**
 * alix security supply-chain verify-tarball <path>
 */
export async function handleSupplyChainVerifyTarball(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));
  const tarballPath = args[0];

  if (!tarballPath) {
    console.error("Usage: alix security supply-chain verify-tarball <path>");
    process.exit(1);
  }

  const result = await runTarballVerification(tarballPath);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log(`\nTarball Verification — ${result.ok ? "PASSED" : "FAILED"}\n`);
  console.log(`Total files: ${result.totalFiles}`);
  console.log(`Passed: ${result.passed}`);
  console.log(`Findings: ${result.findings.length}`);
  if (result.checksum) {
    console.log(`Checksum (SHA-256): ${result.checksum}`);
  }
  console.log();

  for (const f of result.findings) {
    const prefix = f.severity === "error" ? "ERROR" : "WARNING";
    const location = f.filePath ? ` (${f.filePath}${f.line ? `:${f.line}` : ""})` : "";
    console.log(`[${prefix}] [${f.code}] ${f.message}${location}`);
    if (f.details) console.log(`  ${f.details}`);
    console.log();
  }

  process.exit(result.ok ? 0 : 1);
}
