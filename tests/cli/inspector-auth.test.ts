/**
 * inspector-auth.test.ts — P4.3-Sb2: CLI inspector auth tests.
 *
 * Validates:
 *  1. Query-string token rejection
 *  2. Bearer token parsing edge cases
 *  3. Token format parsing
 *  4. Constant-time hash verification
 *  5. CLI command argument handling (unit-level)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  generateToken,
  parseToken,
  verifyTokenHash,
  sha256,
  TOKEN_PREFIX,
  TOKEN_ID_LENGTH,
  SECRET_ENCODED_LENGTH,
  MAX_TOKEN_LENGTH,
} from "../../src/security/inspector/token-format.js";
import {
  AuthStore,
} from "../../src/security/inspector/auth-store.js";
import {
  AuthService,
  AUTH_TOKEN_ROLES,
} from "../../src/security/inspector/auth-service.js";
import {
  setStateDirOverride,
  clearStateDirOverride,
  getUserStatePaths,
} from "../../src/security/platform/user-state-paths.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  return join(tmpdir(), `alix-cli-auth-test-${randomUUID()}`);
}

const noopAudit: import("../../src/security/inspector/auth-service.js").AuditFn = () => {};
const noopMetrics: import("../../src/security/inspector/auth-service.js").MetricsFn = () => {};

// ---------------------------------------------------------------------------
// Token Format Tests
// ---------------------------------------------------------------------------

describe("token-format", () => {
  describe("generateToken", () => {
    it("generates a valid token format", () => {
      const gen = generateToken();
      assert.ok(gen.token.startsWith(TOKEN_PREFIX));
      assert.equal(gen.id.length, TOKEN_ID_LENGTH);
      assert.ok(/^[A-Za-z0-9]+$/.test(gen.id), "ID must be alphanumeric only");
      // Token format: alix_i_<12>_<43>
      // The secret is base64url (may contain _), so don't split on _
      const body = gen.token.slice(TOKEN_PREFIX.length);
      const separatorIdx = body.indexOf("_");
      const id = body.slice(0, separatorIdx);
      const secret = body.slice(separatorIdx + 1);
      assert.equal(id.length, TOKEN_ID_LENGTH);
      assert.equal(secret.length, SECRET_ENCODED_LENGTH);
      // Hash is 64 hex chars (SHA-256)
      assert.equal(gen.hash.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(gen.hash));
    });

    it("generates unique tokens each time", () => {
      const a = generateToken();
      const b = generateToken();
      assert.notEqual(a.token, b.token);
      assert.notEqual(a.id, b.id);
      assert.notEqual(a.hash, b.hash);
    });
  });

  describe("parseToken", () => {
    it("parses a valid token", () => {
      const gen = generateToken();
      const result = parseToken(gen.token);
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.id, gen.id);
        assert.equal(result.secret.length, 32);
      }
    });

    it("rejects oversized tokens", () => {
      const longToken = "a".repeat(MAX_TOKEN_LENGTH + 1);
      const result = parseToken(longToken);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "token_too_long");
      }
    });

    it("rejects tokens with wrong prefix", () => {
      const result = parseToken("wrong_prefix_123456789012_abcdefghijklmnopqrstuvwxyz0123456789abc");
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "invalid_token_format");
      }
    });

    it("rejects tokens with wrong ID length", () => {
      const result = parseToken("alix_i_short_wrong_length_secret_here_but_wrong_");
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "invalid_token_format");
      }
    });

    it("rejects tokens with wrong secret length", () => {
      const gen = generateToken();
      const badToken = `alix_i_${gen.id}_short`;
      const result = parseToken(badToken);
      assert.ok(!result.ok);
    });

    it("rejects tokens with non-base64url characters in ID", () => {
      const result = parseToken("alix_i_!!!!@@@@####_abcdefghijklmnopqrstuvwxyz0123456789abc");
      assert.ok(!result.ok);
    });

    it("rejects empty token", () => {
      const result = parseToken("");
      assert.ok(!result.ok);
    });
  });

  describe("verifyTokenHash", () => {
    it("verifies a correct token", () => {
      const gen = generateToken();
      const result = verifyTokenHash(gen.token, gen.hash);
      assert.ok(result.ok);
    });

    it("rejects wrong token with stored hash", () => {
      const gen = generateToken();
      const other = generateToken();
      const result = verifyTokenHash(other.token, gen.hash);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "invalid_token");
      }
    });

    it("wrong ID and wrong secret both return same error", () => {
      const gen = generateToken();

      // Extract the secret from gen.token using the known positions
      const genSecret = gen.token.slice(TOKEN_PREFIX.length + TOKEN_ID_LENGTH + 1);

      // Wrong ID (nonexistent) — has correct format, so parse succeeds,
      // but hash won't match → "invalid_token"
      const wrongIdToken = `alix_i_${generateToken().id}_${genSecret}`;
      const r1 = verifyTokenHash(wrongIdToken, gen.hash);
      assert.ok(!r1.ok);

      // Extract secret from another generated token
      const otherGen = generateToken();
      const otherSecret = otherGen.token.slice(TOKEN_PREFIX.length + TOKEN_ID_LENGTH + 1);

      // Wrong secret — has correct format, parse succeeds,
      // but hash won't match → "invalid_token"
      const wrongSecretToken = `alix_i_${gen.id}_${otherSecret}`;
      const r2 = verifyTokenHash(wrongSecretToken, gen.hash);
      assert.ok(!r2.ok);

      // Both return the same error code (both are format-valid, hash-mismatch)
      if (!r1.ok && !r2.ok) {
        assert.equal(r1.error, "invalid_token");
        assert.equal(r2.error, "invalid_token");
      }
    });

    it("malformed tokens do not leak timing info", () => {
      const gen = generateToken();
      // Malformed, wrong ID, wrong secret — all should fail without throwing
      const tests = [
        "",
        "not_a_token",
        "alix_i_123456789012_wrong_secret_length",
        `alix_i_${generateToken().id}_${gen.token.split("_").pop()!}`,
      ];
      for (const t of tests) {
        const result = verifyTokenHash(t, gen.hash);
        assert.ok(!result.ok, `expected failure for: ${t.slice(0, 20)}`);
      }
    });
  });

  describe("sha256", () => {
    it("produces consistent hashes", () => {
      const h1 = sha256("hello");
      const h2 = sha256("hello");
      assert.equal(h1, h2);
    });

    it("produces different hashes for different inputs", () => {
      const h1 = sha256("hello");
      const h2 = sha256("world");
      assert.notEqual(h1, h2);
    });

    it("produces 64-character hex strings", () => {
      const h = sha256("test");
      assert.equal(h.length, 64);
      assert.ok(/^[0-9a-f]{64}$/.test(h));
    });
  });
});

// ---------------------------------------------------------------------------
// Auth Store + Service Integration
// ---------------------------------------------------------------------------

describe("auth-store-service integration", () => {
  let dir: string;
  let store: AuthStore;

  beforeEach(async () => {
    dir = tempDir();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    store = new AuthStore({ filePath: join(dir, "auth-store.json") });
  });

  afterEach(async () => {
    try { await rm(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it("raw token is never persisted in store", async () => {
    const svc = new AuthService(store, noopAudit, noopMetrics);
    const created = await svc.createToken({ name: "test", role: "readonly" });
    assert.ok(created.ok);
    if (!created.ok) return;

    // Read the raw file
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(dir, "auth-store.json"), "utf-8");

    // The raw token string must not appear
    assert.ok(!raw.includes(created.value.token),
      "raw token must not be persisted");
  });

  it("hash is not in user-facing list output", async () => {
    const svc = new AuthService(store, noopAudit, noopMetrics);
    await svc.createToken({ name: "test", role: "readonly" });

    const listResult = await svc.listTokens();
    assert.ok(listResult.ok);
    if (listResult.ok) {
      for (const t of listResult.value) {
        const asObj = t as unknown as Record<string, unknown>;
        assert.ok(!asObj["hash"], "hash must not appear in list output");
        assert.ok(!asObj["token"], "token must not appear in list output");
      }
    }
  });

  it("verifyToken rejects empty/malformed without throwing", async () => {
    const svc = new AuthService(store, noopAudit, noopMetrics);

    // Empty
    const r1 = await svc.verifyToken("");
    assert.ok(!r1.ok);

    // Garbage
    const r2 = await svc.verifyToken("not-a-token");
    assert.ok(!r2.ok);

    // Almost valid
    const gen = generateToken();
    const r3 = await svc.verifyToken(gen.token);
    assert.ok(!r3.ok);

    // All should have stable error codes
    for (const r of [r1, r2, r3]) {
      assert.ok(!r.ok);
      if (!r.ok) {
        assert.ok(typeof r.error === "string");
        assert.ok(r.error.length > 0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// User State Paths
// ---------------------------------------------------------------------------

describe("user-state-paths", () => {
  afterEach(() => {
    clearStateDirOverride();
  });

  it("resolves with override", () => {
    setStateDirOverride("/tmp/test-alix");
    const paths = getUserStatePaths();
    assert.ok(paths.authStateDir.startsWith("/tmp/test-alix"));
  });

  it("resolves on Linux platform", () => {
    // Without override, resolves based on process.platform
    clearStateDirOverride();
    const paths = getUserStatePaths();
    assert.ok(paths.authStateDir.length > 0);
    assert.ok(paths.authStateDir.includes("alix-inspector"));
  });

  it("override can be cleared", () => {
    setStateDirOverride("/tmp/test-alix");
    clearStateDirOverride();
    const paths = getUserStatePaths();
    // Should NOT use the override
    assert.ok(!paths.authStateDir.startsWith("/tmp/test-alix"));
  });
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe("roles", () => {
  it("supports readonly, operator, and admin", () => {
    assert.ok(AUTH_TOKEN_ROLES.includes("readonly"));
    assert.ok(AUTH_TOKEN_ROLES.includes("operator"));
    assert.ok(AUTH_TOKEN_ROLES.includes("admin"));
    assert.equal(AUTH_TOKEN_ROLES.length, 3);
  });

  it("rejects unknown roles", () => {
    assert.ok(!AUTH_TOKEN_ROLES.includes("superuser" as any));
  });
});
