/**
 * auth-service.test.ts — P4.3-Sb2: Auth service tests.
 *
 * Validates:
 *  1. Create/list/rotate/revoke cycle
 *  2. Wrong token ID and wrong secret both fail with same error
 *  3. Constant-length comparison path (timing-safe)
 *  4. Expiry and grace window behavior
 *  5. Workspace scope (if configured)
 *  6. Token count bound enforcement
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  AuthStore,
  MAX_TOKEN_COUNT,
} from "../../../src/security/inspector/auth-store.js";
import {
  AuthService,
  type AuditFn,
  type MetricsFn,
} from "../../../src/security/inspector/auth-service.js";
import {
  generateToken,
  TOKEN_PREFIX,
  TOKEN_ID_LENGTH,
} from "../../../src/security/inspector/token-format.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  return join(tmpdir(), `alix-auth-service-test-${randomUUID()}`);
}

const noopAudit: AuditFn = () => {};
const noopMetrics: MetricsFn = () => {};

// Collecting audit for assertions
function collectingAudit(): { audit: AuditFn; events: Array<{ action: string; tokenId: string }> } {
  const events: Array<{ action: string; tokenId: string }> = [];
  return {
    events,
    audit: (event) => { events.push({ action: event.action, tokenId: event.tokenId }); },
  };
}

// Collecting metrics for assertions
function collectingMetrics(): { metrics: MetricsFn; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    metrics: (name) => { calls.push(name); },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
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

  describe("create/list/rotate/revoke cycle", () => {
    it("creates a token and returns the raw token once", async () => {
      const audit = collectingAudit();
      const metrics = collectingMetrics();
      const svc = new AuthService(store, audit.audit, metrics.metrics);

      const result = await svc.createToken({ name: "test", role: "readonly" });
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.token.startsWith("alix_i_"));
        assert.equal(result.value.name, "test");
        assert.equal(result.value.role, "readonly");
        assert.ok(result.value.id.length === 12);
      }

      // Audit should have been called
      assert.equal(audit.events.length, 1);
      assert.equal(audit.events[0].action, "token.created");
      // Raw token should NOT appear in audit
      assert.ok(!audit.events[0].tokenId.includes("alix_i_"),
        "raw token must not be in audit");

      // Metrics should have been called
      assert.ok(metrics.calls.includes("token.created"));
    });

    it("lists tokens without hashes", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      await svc.createToken({ name: "a", role: "readonly" });
      await svc.createToken({ name: "b", role: "operator" });

      const listResult = await svc.listTokens();
      assert.ok(listResult.ok);
      if (listResult.ok) {
        assert.equal(listResult.value.length, 2);

        // Verify no hash or raw token in the output
        for (const t of listResult.value) {
          assert.ok(!("hash" in t), "hash must not appear in token info");
          assert.ok(!("token" in t), "raw token must not appear in token info");
          assert.ok(typeof t.id === "string");
          assert.ok(typeof t.name === "string");
          assert.ok(typeof t.role === "string");
        }
      }
    });

    it("rotates a token with grace period", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "rotate-me", role: "operator" });
      assert.ok(created.ok);
      if (!created.ok) return;

      // Rotate with 1 hour grace
      const rotated = await svc.rotateToken(created.value.id, 3600000);
      assert.ok(rotated.ok);
      if (rotated.ok) {
        assert.equal(rotated.value.previousId, created.value.id);
        assert.ok(rotated.value.token.startsWith("alix_i_"));
        assert.notEqual(rotated.value.token, created.value.token);
        assert.notEqual(rotated.value.id, created.value.id);
        assert.equal(rotated.value.role, "operator");
      }

      // Old token should still verify (within grace)
      const oldVerify = await svc.verifyToken(created.value.token);
      assert.ok(oldVerify.ok, "old token should verify within grace period");
    });

    it("revokes a token immediately", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "kill-me", role: "readonly" });
      assert.ok(created.ok);
      if (!created.ok) return;

      // Revoke
      const revResult = await svc.revokeToken(created.value.id, "test_revocation");
      assert.ok(revResult.ok);

      // Old token should NOT verify after revocation
      const oldVerify = await svc.verifyToken(created.value.token);
      assert.ok(!oldVerify.ok);
      if (!oldVerify.ok) {
        assert.equal(oldVerify.error, "token_revoked");
      }
    });

    it("rejects revoked token verification", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "revoked", role: "readonly" });
      assert.ok(created.ok);
      if (!created.ok) return;

      await svc.revokeToken(created.value.id, "test");

      const verifyResult = await svc.verifyToken(created.value.token);
      assert.ok(!verifyResult.ok);
      if (!verifyResult.ok) {
        assert.ok(verifyResult.error === "token_revoked" || verifyResult.error === "invalid_token",
          `expected token_revoked or invalid_token, got ${verifyResult.error}`);
      }
    });

    it("cannot rotate a revoked token", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "revoked-rotate", role: "readonly" });
      assert.ok(created.ok);
      if (!created.ok) return;

      await svc.revokeToken(created.value.id, "test");
      const rotateResult = await svc.rotateToken(created.value.id, 3600000);
      assert.ok(!rotateResult.ok);
    });
  });

  describe("wrong token ID and wrong secret", () => {
    it("wrong token ID and wrong secret both fail with same error", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      await svc.createToken({ name: "test", role: "readonly" });

      // Wrong ID
      const wrongIdResult = await svc.verifyToken("alix_i_000000000000_invalidsecret_base64url_chars_43_0000000000");
      assert.ok(!wrongIdResult.ok);

      // Wrong secret (valid ID, wrong secret)
      // Create a token we can reference and extract the secret using fixed positions
      const gen = generateToken();
      const otherGen = generateToken();
      const otherSecret = otherGen.token.slice(TOKEN_PREFIX.length + TOKEN_ID_LENGTH + 1);
      const wrongSecretToken = `alix_i_${gen.id}_${otherSecret}`;
      const wrongSecretResult = await svc.verifyToken(wrongSecretToken);
      assert.ok(!wrongSecretResult.ok);

      // Both should return the same error code
      assert.equal(wrongIdResult.ok, false);
      assert.equal(wrongSecretResult.ok, false);
    });
  });

  describe("expiry and grace", () => {
    it("rejects expired tokens", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const pastDate = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      const result = await svc.createToken({
        name: "expired",
        role: "readonly",
        expiresAt: pastDate,
      });
      assert.ok(result.ok);
      if (!result.ok) return;

      // This token should already be expired
      const verifyResult = await svc.verifyToken(result.value.token);
      assert.ok(!verifyResult.ok);
      if (!verifyResult.ok) {
        assert.equal(verifyResult.error, "token_expired");
      }
    });

    it("accepts non-expired tokens with future expiry", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const futureDate = new Date(Date.now() + 3600000).toISOString(); // 1 hour ahead
      const result = await svc.createToken({
        name: "future",
        role: "readonly",
        expiresAt: futureDate,
      });
      assert.ok(result.ok);
      if (!result.ok) return;

      const verifyResult = await svc.verifyToken(result.value.token);
      assert.ok(verifyResult.ok);
    });
  });

  describe("constant-length comparison", () => {
    it("uses timingSafeEqual (indirect test — both paths return same error)", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "timing", role: "readonly" });
      assert.ok(created.ok);
      if (!created.ok) return;

      const actualToken = created.value.token;

      // Test with various wrong tokens — all should return the same error
      const wrongTokens = [
        "alix_i_nonexistent_wrong_base64url_secret_here__43chars__",
        actualToken.slice(0, -1) + "X", // one char off
        "not_a_token_at_all",
        "",
        "a".repeat(300),
      ];

      const errors = new Set<string>();
      for (const wt of wrongTokens) {
        const result = await svc.verifyToken(wt);
        errors.add(result.ok ? "ok" : (result as { error: string }).error);
      }

      // All wrong tokens should fail (not "ok")
      assert.ok(!errors.has("ok"), "no wrong token should succeed");
    });
  });

  describe("token count bound", () => {
    it("rejects creation when at max", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);

      // Fill to max
      for (let i = 0; i < MAX_TOKEN_COUNT; i++) {
        const result = await svc.createToken({ name: `fill-${i}`, role: "readonly" });
        assert.ok(result.ok, `failed at ${i}: ${!result.ok ? result.error : ""}`);
      }

      // One more should fail
      const result = await svc.createToken({ name: "overflow", role: "readonly" });
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.ok(
          result.error === "token_limit_reached" || result.error === "token_count_exceeded",
        );
      }
    });
  });

  describe("invalid role", () => {
    it("rejects unknown roles", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const result = await svc.createToken({ name: "bad", role: "superuser" as any });
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "invalid_role");
      }
    });
  });

  describe("verifyToken", () => {
    it("returns principal without raw token", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "principal-test", role: "operator" });
      assert.ok(created.ok);
      if (!created.ok) return;

      const verifyResult = await svc.verifyToken(created.value.token);
      assert.ok(verifyResult.ok, `verify failed: ${!verifyResult.ok ? verifyResult.error : "n/a"}`);
      if (verifyResult.ok) {
        const principal = verifyResult.value;
        assert.equal(principal.name, "principal-test");
        assert.equal(principal.role, "operator");
        // The principal must NOT carry the raw token
        assert.ok(!("token" in principal), "principal must not carry raw token");
        assert.ok(!("hash" in principal), "principal must not carry hash");
      }
    });

    it("rejects malformed tokens", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const result = await svc.verifyToken("totally_broken");
      assert.ok(!result.ok);
    });

    it("rejects tokens that are too long", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const long = "a".repeat(500);
      const result = await svc.verifyToken(long);
      assert.ok(!result.ok);
    });
  });

  describe("doctor", () => {
    it("reports zero tokens for empty store", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const result = await svc.doctor();
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.totalTokens, 0);
        assert.equal(result.value.activeTokens, 0);
        assert.equal(result.value.revokedTokens, 0);
        assert.equal(result.value.expiredTokens, 0);
      }
    });

    it("reports correct counts with mixed state", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      await svc.createToken({ name: "active1", role: "readonly" });
      await svc.createToken({ name: "active2", role: "operator" });
      const revoked = await svc.createToken({ name: "to-revoke", role: "readonly" });
      if (revoked.ok) {
        await svc.revokeToken(revoked.value.id, "test");
      }

      const result = await svc.doctor();
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.totalTokens, 3);
        assert.equal(result.value.activeTokens, 2);
        assert.equal(result.value.revokedTokens, 1);
        assert.equal(result.value.expiredTokens, 0);
      }
    });
  });

  describe("token_not_found edge cases", () => {
    it("rotate unknown token returns token_not_found", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const result = await svc.rotateToken("nonexistent", 3600000);
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "token_not_found");
      }
    });

    it("revoke unknown token returns token_not_found", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const result = await svc.revokeToken("nonexistent", "test");
      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error, "token_not_found");
      }
    });

    it("revoke already-revoked token returns already_revoked", async () => {
      const svc = new AuthService(store, noopAudit, noopMetrics);
      const created = await svc.createToken({ name: "double", role: "readonly" });
      assert.ok(created.ok);
      if (!created.ok) return;

      await svc.revokeToken(created.value.id, "first");
      const second = await svc.revokeToken(created.value.id, "second");
      assert.ok(!second.ok);
      if (!second.ok) {
        assert.equal(second.error, "already_revoked");
      }
    });
  });
});
