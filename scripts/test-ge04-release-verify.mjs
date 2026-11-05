import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { symlinkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  canonicalReleaseBytes, verifyReleasePayload,
  GE04_RELEASE_PROTOCOL, GE04_TRUST_PATH, GE04_RELEASE_PATH, GE04_ARTIFACT_PATH,
  ReleaseVerificationError,
} from "./ge04-release-verify.mjs";

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const secondPair = generateKeyPairSync("ed25519");
  const artifactBytes = Buffer.from("inert fixture, never an executable");
  const release = {
    protocol: GE04_RELEASE_PROTOCOL,
    sequence: 14,
    artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"),
  };
  const signatureBase64 = sign(null, canonicalReleaseBytes(release), privateKey).toString("base64");
  return {
    release, signatureBase64, artifactBytes,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    otherPublicKeyPem: secondPair.publicKey.export({ format: "pem", type: "spki" }).toString(),
    floor: 13,
  };
}

test("a correctly pinned signature, digest and floor generate evidence only", () => {
  const evidence = verifyReleasePayload(fixture());
  assert.equal(evidence.status, "CRYPTOGRAPHIC_EVIDENCE_ONLY");
  assert.equal(evidence.sequence, 14);
  assert.equal(evidence.protocol, GE04_RELEASE_PROTOCOL);
  assert.equal("authorized" in evidence, false);
  assert.equal("canMutate" in evidence, false);
});

test("floor above signed release denies downgrade", () => {
  assert.throws(() => verifyReleasePayload({ ...fixture(), floor: 15 }), /below administrator floor/);
  assert.throws(() => verifyReleasePayload({ ...fixture(), floor: 0 }), /rollback floor/);
  assert.throws(() => verifyReleasePayload({ ...fixture(), floor: -1 }), /rollback floor/);
  assert.throws(() => verifyReleasePayload({ ...fixture(), floor: undefined }), /rollback floor/);
});

test("artifact tampering is denied despite valid signed metadata", () => {
  assert.throws(() => verifyReleasePayload({
    ...fixture(), artifactBytes: Buffer.from("tampered payload"),
  }), /digest mismatch/);
});

test("caller-supplied alternate key cannot verify a pinned release", () => {
  const input = fixture();
  assert.throws(() => verifyReleasePayload({
    ...input, publicKeyPem: input.otherPublicKeyPem,
  }), /signature verification failed/);
});

test("ed25519 signature tampering, missing signature, and noncanonical encoding deny", () => {
  const input = fixture();
  const corrupted = Buffer.from(input.signatureBase64, "base64");
  corrupted[10] ^= 1;
  assert.throws(() => verifyReleasePayload({
    ...input, signatureBase64: corrupted.toString("base64"),
  }), /signature verification failed/);
  assert.throws(() => verifyReleasePayload({ ...input, signatureBase64: "" }), /signature encoding/);
  assert.throws(() => verifyReleasePayload({
    ...input, signatureBase64: input.signatureBase64.replace(/==$/, "="),
  }), /signature encoding/);
});

test("only the fixed release schema and safe integer sequence are signed", () => {
  const input = fixture();
  assert.throws(() => canonicalReleaseBytes({ ...input.release, admin: true }), /metadata fields/);
  assert.throws(() => canonicalReleaseBytes({ ...input.release, sequence: 1.5 }), /Invalid release sequence/);
  assert.throws(() => canonicalReleaseBytes({ ...input.release, sequence: 2 ** 55 }), /Invalid release sequence/);
  assert.throws(() => canonicalReleaseBytes({ ...input.release, protocol: "ALIX_GE04_V0" }), /release protocol/);
  assert.throws(() => canonicalReleaseBytes({ ...input.release, artifactSha256: "0".repeat(63) }), /digest/);
});

test("artifact size limit denies even a correctly signed oversized payload", () => {
  const input = fixture();
  const oversized = Buffer.alloc(32 * 1024 * 1024 + 1);
  assert.throws(() => verifyReleasePayload({
    ...input,
    artifactBytes: oversized,
  }), /exceeds allowed size/);
});

test("trust paths are absolute constants and CLI refuses caller trust overrides", async () => {
  assert.equal(GE04_TRUST_PATH, "/etc/alix/ge04/trust.json");
  assert.equal(GE04_RELEASE_PATH, "/usr/local/lib/alix/ge04/release.json");
  assert.equal(GE04_ARTIFACT_PATH, "/usr/local/lib/alix/ge04/supervisor.bin");
  const cmd = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "ge04-release-verify.mjs"), "--trust", "/tmp/attacker"], {
    encoding: "utf8", timeout: 5_000,
  });
  assert.equal(cmd.status, 78, cmd.stderr);
  assert.match(cmd.stderr, /Command-line trust or release overrides are prohibited/);
});


test("mutating signed release fields after signature creation fails verification", () => {
  const input = fixture();
  assert.throws(() => verifyReleasePayload({
    ...input, release: { ...input.release, sequence: input.release.sequence + 1 },
  }), /signature verification failed/);
});


test("symlink executable alias also refuses startup rather than silently returning zero", () => {
  if (process.platform === "win32") return;
  const folder = mkdtempSync(join(tmpdir(), "alix-ge04-release-alias-"));
  try {
    const alias = join(folder, "verifier-alias.mjs");
    symlinkSync(join(dirname(fileURLToPath(import.meta.url)), "ge04-release-verify.mjs"), alias);
    const proc = spawnSync(process.execPath, [alias], {
      encoding: "utf8", timeout: 5_000,
    });
    assert.equal(proc.status, 78, proc.stderr);
    assert.match(proc.stderr, /GE-04 release verification denied|SECURITY HOLD/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
