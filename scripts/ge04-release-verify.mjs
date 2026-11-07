#!/usr/bin/env node
/**
 * GE-04 offline release identity verifier — evidence only, NEVER authority.
 *
 * A root-owned installation and public key must be provisioned independently.
 * This program does not sign, install, execute, update a rollback floor, or
 * activate any filesystem mutation. It cannot be called by production ALiX.
 */
import { constants, statSync } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import { dirname, isAbsolute, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SUPERVISOR_RELEASE_PROTOCOL = "ALIX_GE04_RELEASE_V1";
export const SUPERVISOR_TRUST_PATH = "/etc/alix/ge04/trust.json";
export const SUPERVISOR_RELEASE_PATH = "/usr/local/lib/alix/ge04/release.json";
export const SUPERVISOR_ARTIFACT_PATH = "/usr/local/lib/alix/ge04/supervisor.bin";
export const MAX_METADATA_BYTES = 8192;
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export class ReleaseVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleaseVerificationError";
  }
}

const fail = (message) => { throw new ReleaseVerificationError(message); };
const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const keysExactly = (value, keys) => {
  if (!isObject(value)) fail("Expected a strict object");
  const actual = Object.keys(value).sort().join(",");
  if (actual !== [...keys].sort().join(",")) fail("Unexpected or missing metadata fields");
};
const hexSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Signed bytes are a canonical fixed-order JSON object followed by LF. */
export function canonicalReleaseBytes(release) {
  keysExactly(release, ["protocol", "sequence", "artifactSha256"]);
  if (release.protocol !== SUPERVISOR_RELEASE_PROTOCOL) fail("Unknown release protocol");
  if (!Number.isSafeInteger(release.sequence) || release.sequence < 1) fail("Invalid release sequence");
  if (!hexSha256(release.artifactSha256)) fail("Invalid artifact digest");
  return Buffer.from(JSON.stringify({
    protocol: SUPERVISOR_RELEASE_PROTOCOL,
    sequence: release.sequence,
    artifactSha256: release.artifactSha256,
  }) + "\n", "utf8");
}

function decodeStrictBase64(value) {
  // A 64-byte Ed25519 signature has 86 base64 payload characters + "==".
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value)) {
    fail("Invalid Ed25519 signature encoding");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== value) fail("Non-canonical signature encoding");
  return bytes;
}

/**
 * Pure cryptographic fixture check. The supplied key and floor here are NOT
 * proof of custody. Only verifyRootProvisionedRelease() can check custody.
 */
export function verifyReleasePayload({ release, signatureBase64, artifactBytes, publicKeyPem, floor }) {
  if (!Number.isSafeInteger(floor) || floor < 1) fail("Missing or invalid administrator rollback floor");
  const signed = canonicalReleaseBytes(release);
  if (release.sequence < floor) fail("Release sequence below administrator floor");
  if (!Buffer.isBuffer(artifactBytes)) fail("Artifact must be pinned bytes");
  if (artifactBytes.length > MAX_ARTIFACT_BYTES) fail("Artifact exceeds allowed size");
  if (sha256(artifactBytes) !== release.artifactSha256) fail("Runtime artifact digest mismatch");
  let key;
  try {
    key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") fail("Expected Ed25519 release verification key");
  } catch (error) {
    if (error instanceof ReleaseVerificationError) throw error;
    fail("Invalid independently pinned Ed25519 public key");
  }
  const signature = decodeStrictBase64(signatureBase64);
  if (!verify(null, signed, key, signature)) fail("Release signature verification failed");
  return Object.freeze({
    protocol: SUPERVISOR_RELEASE_PROTOCOL,
    sequence: release.sequence,
    artifactSha256: release.artifactSha256,
    // Evidence only, not an authorization token.
    status: "CRYPTOGRAPHIC_EVIDENCE_ONLY",
  });
}

/**
 * Never accept path overrides from ALiX or model-originated configuration.
 * Checks the privileged path chain before/after reading; these checks are
 * insufficient against a privileged adversary who can mutate the mount.
 */
async function readPrivilegedRegular(path, maxBytes) {
  if (!isAbsolute(path) || resolve(path) !== path) fail("Trust paths must be absolute");
  const parts = [];
  for (let p = path; ; p = dirname(p)) {
    parts.push(p);
    if (p === parse(p).root) break;
  }
  for (const p of parts.reverse()) {
    const st = await lstat(p);
    if (st.isSymbolicLink() || st.uid !== 0 || (st.mode & 0o022)) fail("Untrusted privileged path component");
    if (p === path ? !st.isFile() : !st.isDirectory()) fail("Unexpected privileged path type");
  }
  const original = await lstat(path);
  if (original.nlink !== 1) fail("Hard-linked privileged file");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0));
  try {
    const pinned = await file.stat();
    if (!pinned.isFile() || pinned.dev !== original.dev || pinned.ino !== original.ino ||
        pinned.nlink !== 1 || pinned.uid !== 0 || (pinned.mode & 0o022)) {
      fail("Privileged file identity changed");
    }
    const chunks = [];
    let length = 0;
    while (true) {
      const buf = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - length));
      const { bytesRead } = await file.read(buf, 0, buf.length, length);
      if (!bytesRead) break;
      chunks.push(buf.subarray(0, bytesRead));
      length += bytesRead;
      if (length > maxBytes) fail("Privileged file size exceeds maximum");
    }
    const after = await lstat(path);
    if (after.dev !== pinned.dev || after.ino !== pinned.ino || after.nlink !== 1 ||
        await realpath(path) !== path) fail("Privileged pathname changed during read");
    return Buffer.concat(chunks);
  } finally {
    await file.close();
  }
}

function parseStrictJson(buffer, fields) {
  const text = buffer.toString("utf8");
  let result;
  try { result = JSON.parse(text); } catch { fail("Malformed release metadata"); }
  keysExactly(result, fields);
  if (JSON.stringify(result) + "\n" !== text) fail("Noncanonical metadata encoding");
  return result;
}

/** The ONLY production-path verifier. Does not return an authorization. */
export async function verifyRootProvisionedRelease() {
  if (process.platform !== "linux") fail("Root-provisioned supervisor verification is Linux-only");
  const trust = parseStrictJson(
    await readPrivilegedRegular(SUPERVISOR_TRUST_PATH, MAX_METADATA_BYTES),
    ["protocol", "publicKeyPem", "minimumSequence"],
  );
  if (trust.protocol !== SUPERVISOR_RELEASE_PROTOCOL) fail("Unknown trusted release protocol");
  // The trust root is separately administered. Never write back, silently
  // create a floor, accept a caller-selected public key, or auto-advance.
  const manifest = parseStrictJson(
    await readPrivilegedRegular(SUPERVISOR_RELEASE_PATH, MAX_METADATA_BYTES),
    ["protocol", "sequence", "artifactSha256", "signatureBase64"],
  );
  const { signatureBase64, ...release } = manifest;
  const artifactBytes = await readPrivilegedRegular(SUPERVISOR_ARTIFACT_PATH, MAX_ARTIFACT_BYTES);
  return verifyReleasePayload({
    release, signatureBase64, artifactBytes,
    publicKeyPem: trust.publicKeyPem,
    floor: trust.minimumSequence,
  });
}

// Match the actual program inode, not only the spelling of argv[1]. A
// symlink/hardlink launcher must not accidentally bypass the deny-only CLI.
function invokedAsProgram() {
  if (!process.argv[1]) return false;
  try {
    const entry = statSync(process.argv[1]);
    const source = statSync(fileURLToPath(import.meta.url));
    return entry.dev === source.dev && entry.ino === source.ino;
  } catch {
    return false;
  }
}
if (invokedAsProgram()) {
  // Even when verified, no service launch or mutation is permitted.
  try {
    if (process.argv.length !== 2) fail("Command-line trust or release overrides are prohibited");
    const evidence = await verifyRootProvisionedRelease();
    process.stdout.write(JSON.stringify(evidence) + "\n");
    process.stderr.write("SUPERVISOR_SECURITY_HOLD: release evidence is NOT permission to start a supervisor\n");
    process.exitCode = 78;
  } catch (error) {
    process.stderr.write("Supervisor release verification denied: " +
      (error instanceof ReleaseVerificationError ? error.message : "unverified privileged input") + "\n");
    process.exitCode = 78;
  }
}
