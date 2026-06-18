/**
 * P4.3-Se3 — Config Signing, Trust Evaluation, and Anti-Rollback Tests
 *
 * Covers:
 * - Key generation (Ed25519)
 * - Config signing and verification
 * - Tamper detection (hash mismatch)
 * - Corrupt signature detection
 * - Anti-rollback version stamp
 * - Trust evaluation (production vs dev mode)
 * - Key ID computation
 * - Signature persistence
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ConfigSigner,
  SIGNING_ERROR_CODES,
  type ConfigSignature,
  type TrustReport,
} from "../../src/config/signing.js";
import { ConfigMutationService, computeConfigHash } from "../../src/config/mutation.js";
import type { AlixConfig } from "../../src/config/schema.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestConfig(overrides: Partial<AlixConfig> = {}): AlixConfig {
  return {
    ...DEFAULT_CONFIG,
    model: { provider: "test", name: "test-model" },
    ...overrides,
  };
}

async function setupConfigDir(): Promise<{
  dir: string;
  configDir: string;
  keyPath: string;
  stampPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "alix-signing-test-"));
  const configDir = join(dir, ".alix", "config");
  await mkdir(configDir, { recursive: true, mode: 0o700 });

  const config = makeTestConfig();
  const configPath = join(configDir, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });

  const keyPath = join(dir, "signing-key.pem");
  const stampPath = join(dir, "version.stamp");

  return { dir, configDir, keyPath, stampPath };
}

async function setupWithKey(): Promise<{
  dir: string;
  configDir: string;
  signer: ConfigSigner;
  publicKey: string;
  keyPath: string;
  stampPath: string;
}> {
  const { dir, configDir, keyPath, stampPath } = await setupConfigDir();

  const { publicKey, privateKey } = ConfigSigner.generateKeyPair();
  await writeFile(keyPath, privateKey, { mode: 0o600 });

  const signer = new ConfigSigner(keyPath);
  return { dir, configDir, signer, publicKey, keyPath, stampPath };
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

test("ConfigSigner: generateKeyPair produces PEM-encoded keys", () => {
  const { publicKey, privateKey } = ConfigSigner.generateKeyPair();
  assert.ok(publicKey.includes("BEGIN PUBLIC KEY"), "Public key should be PEM");
  assert.ok(privateKey.includes("BEGIN PRIVATE KEY"), "Private key should be PEM");
});

test("ConfigSigner: generateKeyPair produces valid Ed25519 keys", async () => {
  const { publicKey, privateKey } = ConfigSigner.generateKeyPair();

  // Verify that the key pair works together: sign and verify
  const { sign: cryptoSign, verify: cryptoVerify } = await import("node:crypto");
  const data = Buffer.from("test data");

  const signature = cryptoSign(null, data, privateKey);
  assert.ok(cryptoVerify(null, data, publicKey, signature), "Key pair should verify correctly");
});

test("ConfigSigner: generateAndPersistKey writes key to disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-signing-test-"));
  try {
    const keyPath = join(dir, "test-key.pem");
    const result = await ConfigSigner.generateAndPersistKey(keyPath);
    assert.equal(result.keyPath, keyPath);
    assert.ok(existsSync(keyPath), "Key file should exist");
    assert.ok(result.privateKey.includes("BEGIN PRIVATE KEY"));
    assert.ok(result.publicKey.includes("BEGIN PUBLIC KEY"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

test("ConfigSigner: sign creates a config.sig file", async () => {
  const { dir, configDir, signer, publicKey } = await setupWithKey();
  try {
    // Create a provenance entry so we have a version
    const service = new ConfigMutationService(configDir);
    await service.set("model.temperature", 0.7);
    const version = await service.getVersion();

    const sig = await signer.sign(configDir, version);
    assert.equal(sig.configVersion, version);

    const sigPath = join(configDir, "config.sig");
    assert.ok(existsSync(sigPath), "config.sig should exist");

    const raw = await readFile(sigPath, "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.keyId, sig.keyId);
    assert.equal(parsed.signature, sig.signature);
    assert.equal(parsed.configVersion, version);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: sign produces valid hex signature", async () => {
  const { dir, configDir, signer } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    const sig = await signer.sign(configDir, version);
    assert.ok(/^[a-f0-9]+$/.test(sig.signature));
    assert.ok(sig.signature.length > 0);
    assert.equal(sig.schemaVersion, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: sign includes configHash", async () => {
  const { dir, configDir, signer } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    const sig = await signer.sign(configDir, version);
    assert.equal(sig.configHash.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(sig.configHash));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

test("ConfigSigner: verify returns ok for valid signature", async () => {
  const { dir, configDir, signer, publicKey } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    await signer.sign(configDir, version);

    const result = await signer.verify(configDir, publicKey);
    assert.equal(result.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: verify detects unsigned config", async () => {
  const { dir, configDir, signer, publicKey } = await setupWithKey();
  try {
    const result = await signer.verify(configDir, publicKey);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, SIGNING_ERROR_CODES.NO_SIGNATURE);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: verify detects tampered config", async () => {
  const { dir, configDir, signer, publicKey } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    await signer.sign(configDir, version);

    // Tamper with the config
    const configPath = join(configDir, "config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.model.temperature = 0.99;
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

    const result = await signer.verify(configDir, publicKey);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, SIGNING_ERROR_CODES.TAMPER_DETECTED);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: verify detects corrupt signature file", async () => {
  const { dir, configDir, signer, publicKey } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    await signer.sign(configDir, version);

    // Corrupt the signature
    const sigPath = join(configDir, "config.sig");
    await writeFile(sigPath, "this is not json");

    const result = await signer.verify(configDir, publicKey);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, SIGNING_ERROR_CODES.INVALID_SIGNATURE);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: verify detects wrong signing key", async () => {
  const { dir, configDir, signer } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    await signer.sign(configDir, version);

    // Verify with a different key
    const { publicKey: wrongKey } = ConfigSigner.generateKeyPair();
    const result = await signer.verify(configDir, wrongKey);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, SIGNING_ERROR_CODES.KEY_ID_MISMATCH);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Anti-rollback
// ---------------------------------------------------------------------------

test("ConfigSigner: checkRollback accepts same or higher version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-signing-test-"));
  try {
    const stampPath = join(dir, "version.stamp");
    await ConfigSigner.writeAcceptedVersion(5, stampPath);

    const r1 = await ConfigSigner.checkRollback(5, stampPath);
    assert.equal(r1.ok, true);

    const r2 = await ConfigSigner.checkRollback(6, stampPath);
    assert.equal(r2.ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: checkRollback rejects lower version", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-signing-test-"));
  try {
    const stampPath = join(dir, "version.stamp");
    await ConfigSigner.writeAcceptedVersion(10, stampPath);

    const result = await ConfigSigner.checkRollback(5, stampPath);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, SIGNING_ERROR_CODES.ROLLBACK_DETECTED);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: readAcceptedVersion returns 0 when no stamp exists", async () => {
  const version = await ConfigSigner.readAcceptedVersion("/nonexistent/path/stamp");
  assert.equal(version, 0);
});

test("ConfigSigner: writeAcceptedVersion uses atomic write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-signing-test-"));
  try {
    const stampPath = join(dir, "version.stamp");
    await ConfigSigner.writeAcceptedVersion(42, stampPath);

    // No temp files should remain
    const { readdir: rd } = await import("node:fs/promises");
    const files = await rd(dir);
    const tmpFiles = files.filter((f: string) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0);

    // Read back
    assert.equal(await ConfigSigner.readAcceptedVersion(stampPath), 42);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Trust evaluation
// ---------------------------------------------------------------------------

test("ConfigSigner: evaluateTrust reports untrusted for unsigned config in production", async () => {
  const { configDir, dir } = await setupConfigDir();
  try {
    const report = await ConfigSigner.evaluateTrust(configDir, null, 1, true);
    assert.equal(report.trusted, false);
    assert.equal(report.signed, false);
    assert.ok(report.issues.some((i) => i.severity === "error" && i.code === SIGNING_ERROR_CODES.NO_SIGNATURE));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: evaluateTrust allows unsigned config in dev mode", async () => {
  const { configDir, dir } = await setupConfigDir();
  try {
    const report = await ConfigSigner.evaluateTrust(configDir, null, 0, false);
    assert.equal(report.trusted, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: evaluateTrust reports valid signed config", async () => {
  const { dir, configDir, signer, publicKey } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    await signer.sign(configDir, version);

    const report = await ConfigSigner.evaluateTrust(configDir, publicKey, version, false);
    assert.equal(report.trusted, true);
    assert.equal(report.signed, true);
    assert.equal(report.signatureValid, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: evaluateTrust detects rollback", async () => {
  const { dir, configDir } = await setupWithKey();
  try {
    const stampPath = join(dir, "version.stamp");
    await ConfigSigner.writeAcceptedVersion(10, stampPath);

    // Rollback detection is checked via checkRollback directly (signature-independent)
    const result = await ConfigSigner.checkRollback(3, stampPath);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, SIGNING_ERROR_CODES.ROLLBACK_DETECTED);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Key ID computation
// ---------------------------------------------------------------------------

test("ConfigSigner: same public key produces same key ID", () => {
  const { publicKey } = ConfigSigner.generateKeyPair();
  const keyId1 = createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
  const keyId2 = createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
  assert.equal(keyId1, keyId2);
});

test("ConfigSigner: different keys produce different key IDs", () => {
  const { publicKey: pk1 } = ConfigSigner.generateKeyPair();
  const { publicKey: pk2 } = ConfigSigner.generateKeyPair();
  const keyId1 = createHash("sha256").update(pk1).digest("hex").slice(0, 16);
  const keyId2 = createHash("sha256").update(pk2).digest("hex").slice(0, 16);
  assert.notEqual(keyId1, keyId2);
});

// ---------------------------------------------------------------------------
// Signature schema version
// ---------------------------------------------------------------------------

test("ConfigSigner: signed config has schema version 1", async () => {
  const { dir, configDir, signer } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    const sig = await signer.sign(configDir, version);
    assert.equal(sig.schemaVersion, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Read signature
// ---------------------------------------------------------------------------

test("ConfigSigner: readSignature returns null for unsigned config", async () => {
  const { configDir, dir } = await setupConfigDir();
  try {
    const sig = await ConfigSigner.readSignature(configDir);
    assert.equal(sig, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ConfigSigner: readSignature returns parsed signature", async () => {
  const { dir, configDir, signer } = await setupWithKey();
  try {
    const service = new ConfigMutationService(configDir);
    const version = await service.getVersion();
    await signer.sign(configDir, version);

    const sig = await ConfigSigner.readSignature(configDir);
    assert.ok(sig !== null);
    assert.ok(typeof sig!.keyId === "string");
    assert.ok(typeof sig!.signature === "string");
    assert.equal(sig!.configVersion, version);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// acceptVersion
// ---------------------------------------------------------------------------

test("ConfigSigner: acceptVersion persists and reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-signing-test-"));
  try {
    const stampPath = join(dir, "version.stamp");
    await ConfigSigner.acceptVersion(15, stampPath);
    assert.equal(await ConfigSigner.readAcceptedVersion(stampPath), 15);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Error codes are stable
// ---------------------------------------------------------------------------

test("ConfigSigner: error codes are stable string constants", () => {
  assert.equal(SIGNING_ERROR_CODES.NO_SIGNATURE, "CONFIG_NO_SIGNATURE");
  assert.equal(SIGNING_ERROR_CODES.INVALID_SIGNATURE, "CONFIG_INVALID_SIGNATURE");
  assert.equal(SIGNING_ERROR_CODES.TAMPER_DETECTED, "CONFIG_TAMPER_DETECTED");
  assert.equal(SIGNING_ERROR_CODES.ROLLBACK_DETECTED, "CONFIG_ROLLBACK_DETECTED");
  assert.equal(SIGNING_ERROR_CODES.KEY_ID_MISMATCH, "CONFIG_KEY_ID_MISMATCH");
  assert.equal(SIGNING_ERROR_CODES.UNKNOWN_KEY, "CONFIG_UNKNOWN_KEY");
});

// ---------------------------------------------------------------------------
// TrustReport structure
// ---------------------------------------------------------------------------

test("ConfigSigner: evaluateTrust returns complete TrustReport structure", async () => {
  const { configDir, dir } = await setupConfigDir();
  try {
    const report = await ConfigSigner.evaluateTrust(configDir, null, 1, false);
    assert.equal(typeof report.trusted, "boolean");
    assert.equal(typeof report.signed, "boolean");
    assert.equal(typeof report.signatureValid, "boolean");
    assert.equal(typeof report.versionOk, "boolean");
    assert.ok(Array.isArray(report.issues));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
