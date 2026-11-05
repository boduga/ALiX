#!/usr/bin/env node
/**
 * GE-04 read-only installation preflight.
 *
 * Only describes visible filesystem facts. It cannot establish independent
 * administration, immutable runtime custody or permission to mutate files.
 * No CLI-controlled roots, no writes, no service launch and no approval grant.
 * Always exits 78 (GE-04 security hold).
 */
import { constants, statSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, normalize, parse } from "node:path";

export const GE04_INSTALL_PATHS = Object.freeze({
  trust: "/etc/alix/ge04/trust.json",
  release: "/usr/local/lib/alix/ge04/release.json",
  executable: "/usr/local/lib/alix/ge04/supervisor.bin",
  service: "/etc/systemd/system/alix-ge04-supervisor.service",
});
export const GE04_QUALIFICATION_HOLD = "GE04_SECURITY_HOLD_ACTIVE";

function normalizeFailure(error) {
  if (error && typeof error === "object" && typeof error.code === "string") {
    if (["ENOENT", "EACCES", "EPERM", "ELOOP"].includes(error.code)) return error.code;
  }
  return "PATH_NOT_VERIFIED";
}

/**
 * Necessary but NOT sufficient custody observations.
 * A privileged adversary or concurrently modified mount can invalidate the
 * path between these checks. A caller-supplied path here is a test input,
 * NEVER a trusted replacement for the fixed CLI paths.
 */
export async function inspectRootOwnedRegularFile(path) {
  if (typeof path !== "string" || !isAbsolute(path) || normalize(path) !== path) {
    return Object.freeze({ observed: false, reason: "INVALID_PATH" });
  }
  const chain = [];
  for (let parent = path; ; parent = dirname(parent)) {
    chain.push(parent);
    if (parent === parse(parent).root) break;
  }
  try {
    for (const entry of chain.reverse()) {
      const stat = await lstat(entry);
      if (stat.isSymbolicLink()) return Object.freeze({ observed: false, reason: "SYMLINK_IN_TRUST_CHAIN" });
      if (stat.uid !== 0) return Object.freeze({ observed: false, reason: "NOT_ROOT_OWNED" });
      if ((stat.mode & 0o022) !== 0) return Object.freeze({ observed: false, reason: "WRITABLE_BY_GROUP_OR_OTHER" });
      if (entry === path ? !stat.isFile() : !stat.isDirectory()) {
        return Object.freeze({ observed: false, reason: "WRONG_FILE_TYPE" });
      }
      if (entry === path && stat.nlink !== 1) return Object.freeze({ observed: false, reason: "HARDLINKED_FILE" });
    }
    const before = await lstat(path);
    const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const current = await fd.stat();
      if (!current.isFile() || current.uid !== 0 || (current.mode & 0o022) !== 0 ||
          current.nlink !== 1 || current.dev !== before.dev || current.ino !== before.ino) {
        return Object.freeze({ observed: false, reason: "IDENTITY_CHANGED" });
      }
      const after = await lstat(path);
      if (after.dev !== current.dev || after.ino !== current.ino || after.nlink !== 1) {
        return Object.freeze({ observed: false, reason: "IDENTITY_CHANGED" });
      }
      return Object.freeze({ observed: true, reason: "PATH_ATTRIBUTES_OBSERVED_ONLY" });
    } finally {
      await fd.close();
    }
  } catch (error) {
    return Object.freeze({ observed: false, reason: normalizeFailure(error) });
  }
}

/**
 * Never returns a READY / PASS / ALLOW decision.
 * Independent signer custody, rollback-floor durability, executable/loader
 * identity, separate security principal, authenticated channel, native
 * syscall check and crash evidence cannot be proven by these path checks.
 */
export async function inspectGE04Qualification() {
  const entries = [];
  for (const [name, path] of Object.entries(GE04_INSTALL_PATHS)) {
    const evidence = process.platform === "linux"
      ? await inspectRootOwnedRegularFile(path)
      : { observed: false, reason: "UNSUPPORTED_PLATFORM" };
    entries.push(Object.freeze({
      name, path, observed: evidence.observed, explanation: evidence.reason,
    }));
  }
  return Object.freeze({
    protocol: "ALIX_GE04_QUALIFICATION_PREFLIGHT_V1",
    disposition: "HOLD",
    code: GE04_QUALIFICATION_HOLD,
    // These are independent external requirements, not auto-resolvable flags.
    outstanding: Object.freeze([
      "INDEPENDENT_OPERATOR_AND_KEY_CUSTODY",
      "PROTECTED_MONOTONIC_ROLLBACK_FLOOR",
      "TRUSTED_RUNTIME_LOADER_MOUNT_AND_PROCESS_IDENTITY",
      "AUTHENTICATED_DISTINCT_UID_SUPERVISOR_CHANNEL",
      "FINAL_SYSCALL_POLICY_APPROVAL_AND_LEASE_FENCE",
      "ATOMIC_EFFECT_JOURNAL_AND_INDEPENDENT_RECEIPT",
      "REAL_CRASH_POWER_LOSS_AND_ADVERSARIAL_QUALIFICATION",
      "INDEPENDENT_SECURITY_SIGNOFF",
    ]),
    paths: Object.freeze(entries),
    note: "Observed paths never establish authenticity, mutation authority, or permission to lift the hold.",
  });
}

async function main() {
  if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== "--json")) {
    process.stderr.write("GE-04: only --json is supported; filesystem path overrides are prohibited\n");
    return 78;
  }
  const report = await inspectGE04Qualification();
  if (process.argv[2] === "--json") process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    process.stdout.write("GE-04: SECURITY HOLD ACTIVE; independent supervisor qualification pending\n");
    for (const item of report.paths) {
      process.stdout.write(`${item.name}: ${item.observed ? "attributes observed (not trusted)" : item.explanation}\n`);
    }
    process.stdout.write(`Outstanding independent gates: ${report.outstanding.length}\n`);
  }
  return 78;
}

function invokedAsProgram() {
  if (!process.argv[1]) return false;
  try {
    const entry = statSync(process.argv[1]);
    const source = statSync(new URL(import.meta.url));
    return entry.dev === source.dev && entry.ino === source.ino;
  } catch {
    return false;
  }
}

if (invokedAsProgram()) {
  process.exitCode = await main();
}
