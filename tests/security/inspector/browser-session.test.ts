/**
 * browser-session.test.ts — P4.3-Sb3: Browser session store tests.
 *
 * Validates:
 *  1. Session creation and retrieval
 *  2. Opaque session IDs
 *  3. Session expiry (absolute and idle)
 *  4. Session count bounding and LRU eviction
 *  5. removeSession idempotency
 *  6. invalidateAll clears all sessions
 *  7. invalidatePrincipal removes sessions for a token
 *  8. Auto-cleanup of expired sessions
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSessionStore,
} from "../../../src/security/inspector/browser-session-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrincipal(overrides?: Record<string, unknown>) {
  return {
    id: "tok-test-001",
    name: "Test Token",
    role: "operator",
    workspaceIds: ["ws-1"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BrowserSessionStore", () => {
  describe("createSession", () => {
    it("creates a session with an opaque ID", () => {
      const store = new BrowserSessionStore();
      const session = store.createSession(makePrincipal());

      assert.ok(session.id, "session id must exist");
      assert.ok(session.id.length >= 32, "session id should be long enough");
      // The ID must not contain the token ID
      assert.ok(!session.id.includes("tok-test-001"), "session id must be opaque");
    });

    it("binds session to the given principal", () => {
      const store = new BrowserSessionStore();
      const session = store.createSession(makePrincipal());

      assert.equal(session.principal.id, "tok-test-001");
      assert.equal(session.principal.name, "Test Token");
      assert.equal(session.principal.role, "operator");
      assert.deepEqual(session.principal.workspaceIds, ["ws-1"]);
    });

    it("preserves principal struct isolation (shallow copy)", () => {
      const store = new BrowserSessionStore();
      const principal = makePrincipal();
      const session = store.createSession(principal);

      // Mutate the original — session should be unaffected
      principal.role = "admin";
      assert.equal(session.principal.role, "operator");
    });

    it("sets creation and expiry timestamps", () => {
      const store = new BrowserSessionStore();
      const session = store.createSession(makePrincipal());

      assert.ok(session.createdAt, "createdAt must exist");
      assert.ok(session.expiresAt, "expiresAt must exist");
      assert.ok(session.lastAccessedAt, "lastAccessedAt must exist");

      const created = new Date(session.createdAt).getTime();
      const expires = new Date(session.expiresAt).getTime();
      const accessed = new Date(session.lastAccessedAt).getTime();

      assert.ok(created <= accessed, "createdAt should be before or equal to lastAccessedAt");
      assert.ok(expires > created, "expiresAt should be after createdAt");
    });
  });

  describe("getSession", () => {
    it("returns a session by ID", () => {
      const store = new BrowserSessionStore();
      const created = store.createSession(makePrincipal());

      const retrieved = store.getSession(created.id);
      assert.ok(retrieved, "session should be found");
      assert.equal(retrieved!.id, created.id);
    });

    it("returns null for nonexistent session", () => {
      const store = new BrowserSessionStore();
      assert.equal(store.getSession("nonexistent"), null);
    });

    it("returns null for expired session (absolute expiry)", () => {
      const store = new BrowserSessionStore({ sessionTtlMs: 1 });
      const created = store.createSession(makePrincipal());

      // Small delay to let it expire
      const until = Date.now() + 5;
      while (Date.now() < until) {
        // busy-wait
      }

      const retrieved = store.getSession(created.id);
      assert.equal(retrieved, null, "expired session should return null");
    });

    it("updates lastAccessedAt on successful retrieval", () => {
      const store = new BrowserSessionStore();
      const created = store.createSession(makePrincipal());

      const originalAccess = created.lastAccessedAt;

      // Small delay
      const until = Date.now() + 3;
      while (Date.now() < until) {
        // busy-wait
      }

      const retrieved = store.getSession(created.id);
      assert.ok(retrieved, "session should be found");
      assert.ok(
        retrieved!.lastAccessedAt > originalAccess,
        "lastAccessedAt should be updated",
      );
    });
  });

  describe("removeSession", () => {
    it("removes an existing session and returns true", () => {
      const store = new BrowserSessionStore();
      const created = store.createSession(makePrincipal());

      assert.equal(store.size, 1);
      assert.equal(store.removeSession(created.id), true);
      assert.equal(store.size, 0);
      assert.equal(store.getSession(created.id), null);
    });

    it("is idempotent (returns false for nonexistent)", () => {
      const store = new BrowserSessionStore();
      assert.equal(store.removeSession("nonexistent"), false);
      // Second call should also return false
      assert.equal(store.removeSession("nonexistent"), false);
    });
  });

  describe("invalidateAll", () => {
    it("clears all sessions", () => {
      const store = new BrowserSessionStore();
      store.createSession(makePrincipal({ id: "tok-1" }));
      store.createSession(makePrincipal({ id: "tok-2" }));
      store.createSession(makePrincipal({ id: "tok-3" }));

      assert.equal(store.size, 3);
      store.invalidateAll();
      assert.equal(store.size, 0);
    });
  });

  describe("invalidatePrincipal", () => {
    it("removes sessions for a given token ID", () => {
      const store = new BrowserSessionStore();
      store.createSession(makePrincipal({ id: "tok-a" }));
      store.createSession(makePrincipal({ id: "tok-b" }));
      store.createSession(makePrincipal({ id: "tok-a" })); // second session for same token

      const count = store.invalidatePrincipal("tok-a");
      assert.equal(count, 2, "should remove 2 sessions for tok-a");
      assert.equal(store.size, 1, "only tok-b session should remain");
    });

    it("returns 0 when no sessions match", () => {
      const store = new BrowserSessionStore();
      store.createSession(makePrincipal({ id: "tok-a" }));

      const count = store.invalidatePrincipal("tok-nonexistent");
      assert.equal(count, 0);
      assert.equal(store.size, 1);
    });
  });

  describe("session count bounding", () => {
    it("evicts LRU session when max capacity is reached", async () => {
      const store = new BrowserSessionStore({ maxSessions: 2 });

      const first = store.createSession(makePrincipal({ id: "tok-1", name: "First" }));

      // Small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 2));

      const second = store.createSession(makePrincipal({ id: "tok-2", name: "Second" }));

      // Small delay so timestamps differ
      await new Promise((r) => setTimeout(r, 2));

      // Access the first to make second the LRU
      store.getSession(first.id);

      // Third should evict the LRU (second)
      const third = store.createSession(makePrincipal({ id: "tok-3", name: "Third" }));

      assert.equal(store.size, 2);
      assert.ok(store.getSession(first.id), "first should still exist (not LRU)");
      assert.equal(store.getSession(second.id), null, "second should be evicted");
      assert.ok(store.getSession(third.id), "third should exist");
    });

    it("respects configured maxSessions", () => {
      const store = new BrowserSessionStore({ maxSessions: 5 });
      for (let i = 0; i < 5; i++) {
        store.createSession(makePrincipal({ id: `tok-${i}` }));
      }
      assert.equal(store.size, 5);

      // Next one should evict oldest
      store.createSession(makePrincipal({ id: "tok-extra" }));
      assert.equal(store.size, 5, "should not exceed max sessions");
    });

    it("entitylDefaults to 256 max sessions", () => {
      const store = new BrowserSessionStore();
      assert.equal(store.capacity, 256);
    });
  });

  describe("expiry cleanup", () => {
    it("getSession triggers cleanup of expired sessions", () => {
      const store = new BrowserSessionStore({ sessionTtlMs: 1 });
      const expired = store.createSession(makePrincipal({ id: "tok-expired" }));

      // Let it expire
      const until = Date.now() + 5;
      while (Date.now() < until) {
        // busy-wait
      }

      // Create a fresh session
      const fresh = store.createSession(makePrincipal({ id: "tok-fresh" }));

      // Getting the fresh session should trigger cleanup
      const retrieved = store.getSession(fresh.id);
      assert.ok(retrieved, "fresh session should exist");
      assert.equal(store.getSession(expired.id), null, "expired should be cleaned up");
      assert.equal(store.size, 1);
    });
  });
});
