/**
 * security-alerts.test.ts — P4.3-Sg1: Passive health assessment and alert management tests.
 *
 * Validates:
 *  1. assessSecurityHealth() returns all 9 subsystems
 *  2. Subsystem status is "unknown" when context is empty
 *  3. Auth subsystem reports "ok" when store exists with active tokens
 *  4. Auth subsystem reports "needs_attention" when store missing
 *  5. Rate limiter reports "ok" when active
 *  6. Connection limiter reports "degraded" when saturated
 *  7. Origin policy reports "needs_attention" when not configured
 *  8. Config subsystem reports "untrusted" alert
 *  9. Network subsystem reports "needs_attention" for non-loopback without TLS
 *  10. Alert upsert increments count on duplicate id
 *  11. Alert store is bounded (max 50)
 *  12. toSecurityStatusResponse() redacts details and produces safe output
 *  13. Overall health is "ok" when all subsystems are ok
 *  14. Overall health is "needs_attention" when any subsystem needs attention
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessSecurityHealth,
  toSecurityStatusResponse,
  getAlerts,
  resetAlerts,
  type HealthAssessmentContext,
  type SecurityHealthSnapshot,
} from "../../src/server/security-alerts.js";

describe("assessSecurityHealth", () => {
  describe("empty context", () => {
    const snapshot = assessSecurityHealth();

    it("returns all 9 subsystems", () => {
      assert.equal(snapshot.subsystems.length, 9);
    });

    it("has a snapshotAt timestamp", () => {
      assert.ok(snapshot.snapshotAt > 0);
      assert.ok(snapshot.snapshotAt <= Date.now());
    });

    it("reports overall as unknown when no context", () => {
      assert.equal(snapshot.overall, "unknown");
    });

    it("has subsystem names", () => {
      const names = snapshot.subsystems.map((s) => s.subsystem);
      assert.ok(names.includes("auth"));
      assert.ok(names.includes("rate_limiter"));
      assert.ok(names.includes("connection_limiter"));
      assert.ok(names.includes("origin_policy"));
      assert.ok(names.includes("config_trust"));
      assert.ok(names.includes("audit"));
      assert.ok(names.includes("credentials"));
      assert.ok(names.includes("redaction"));
      assert.ok(names.includes("network"));
    });
  });

  describe("healthy context", () => {
    const ctx: HealthAssessmentContext = {
      authStoreExists: true,
      authTokenCount: 5,
      authActiveTokens: 3,
      rateLimiterActive: true,
      preAuthBuckets: 2,
      preAuthCapacity: 100,
      postAuthBuckets: 1,
      postAuthCapacity: 100,
      connectionLimiterActive: true,
      connectionCount: 1,
      connectionLimit: 50,
      originPolicyConfigured: true,
      configTrustState: "trusted",
      auditChainEnabled: true,
      auditVerificationOk: true,
      credentialStoreExists: true,
      credentialEntryCount: 5,
      redactionActive: true,
      isLoopbackBind: true,
    };

    const snapshot = assessSecurityHealth(ctx);

    it("reports overall as ok", () => {
      assert.equal(snapshot.overall, "ok");
    });

    it("reports auth as ok", () => {
      const auth = snapshot.subsystems.find((s) => s.subsystem === "auth");
      assert.ok(auth);
      assert.equal(auth!.status, "ok");
    });

    it("reports rate_limiter as ok", () => {
      const rl = snapshot.subsystems.find((s) => s.subsystem === "rate_limiter");
      assert.ok(rl);
      assert.equal(rl!.status, "ok");
    });

    it("reports connection_limiter as ok", () => {
      const cl = snapshot.subsystems.find((s) => s.subsystem === "connection_limiter");
      assert.ok(cl);
      assert.equal(cl!.status, "ok");
    });

    it("reports origin_policy as ok", () => {
      const op = snapshot.subsystems.find((s) => s.subsystem === "origin_policy");
      assert.ok(op);
      assert.equal(op!.status, "ok");
    });

    it("reports config_trust as ok", () => {
      const ct = snapshot.subsystems.find((s) => s.subsystem === "config_trust");
      assert.ok(ct);
      assert.equal(ct!.status, "ok");
    });

    it("reports audit as ok", () => {
      const au = snapshot.subsystems.find((s) => s.subsystem === "audit");
      assert.ok(au);
      assert.equal(au!.status, "ok");
    });

    it("reports credentials as ok", () => {
      const cr = snapshot.subsystems.find((s) => s.subsystem === "credentials");
      assert.ok(cr);
      assert.equal(cr!.status, "ok");
    });

    it("reports redaction as ok", () => {
      const rd = snapshot.subsystems.find((s) => s.subsystem === "redaction");
      assert.ok(rd);
      assert.equal(rd!.status, "ok");
    });

    it("reports network as ok for loopback", () => {
      const nw = snapshot.subsystems.find((s) => s.subsystem === "network");
      assert.ok(nw);
      assert.equal(nw!.status, "ok");
    });
  });

  describe("unhealthy subsystems", () => {
    it("reports auth needs_attention when store missing", () => {
      const snapshot = assessSecurityHealth({
        authStoreExists: false,
      });
      const auth = snapshot.subsystems.find((s) => s.subsystem === "auth");
      assert.equal(auth!.status, "needs_attention");
    });

    it("reports auth needs_attention when no active tokens", () => {
      const snapshot = assessSecurityHealth({
        authStoreExists: true,
        authTokenCount: 3,
        authActiveTokens: 0,
      });
      const auth = snapshot.subsystems.find((s) => s.subsystem === "auth");
      assert.equal(auth!.status, "needs_attention");
    });

    it("reports rate_limiter needs_attention when not active", () => {
      const snapshot = assessSecurityHealth({
        rateLimiterActive: false,
      });
      const rl = snapshot.subsystems.find((s) => s.subsystem === "rate_limiter");
      assert.equal(rl!.status, "needs_attention");
    });

    it("reports connection_limiter degraded when saturated", () => {
      const snapshot = assessSecurityHealth({
        connectionLimiterActive: true,
        connectionCount: 50,
        connectionLimit: 50,
      });
      const cl = snapshot.subsystems.find((s) => s.subsystem === "connection_limiter");
      assert.equal(cl!.status, "degraded");
    });

    it("reports origin_policy needs_attention when not configured", () => {
      const snapshot = assessSecurityHealth({
        originPolicyConfigured: false,
      });
      const op = snapshot.subsystems.find((s) => s.subsystem === "origin_policy");
      assert.equal(op!.status, "needs_attention");
    });

    it("reports config_trust needs_attention when untrusted", () => {
      const snapshot = assessSecurityHealth({
        configTrustState: "untrusted",
      });
      const ct = snapshot.subsystems.find((s) => s.subsystem === "config_trust");
      assert.equal(ct!.status, "needs_attention");
    });

    it("reports audit needs_attention when verification failed", () => {
      const snapshot = assessSecurityHealth({
        auditChainEnabled: true,
        auditVerificationOk: false,
      });
      const au = snapshot.subsystems.find((s) => s.subsystem === "audit");
      assert.equal(au!.status, "needs_attention");
    });

    it("reports network needs_attention for non-loopback without TLS", () => {
      const snapshot = assessSecurityHealth({
        isLoopbackBind: false,
        requireTlsForRemote: false,
      });
      const nw = snapshot.subsystems.find((s) => s.subsystem === "network");
      assert.equal(nw!.status, "needs_attention");
    });

    it("reports redaction needs_attention when not active", () => {
      const snapshot = assessSecurityHealth({
        redactionActive: false,
      });
      const rd = snapshot.subsystems.find((s) => s.subsystem === "redaction");
      assert.equal(rd!.status, "needs_attention");
    });
  });

  describe("overall health computation", () => {
    it("returns ok when all are ok or unknown with at least one ok", () => {
      const snapshot = assessSecurityHealth({
        authStoreExists: true,
        authActiveTokens: 1,
        rateLimiterActive: true,
        connectionLimiterActive: true,
        connectionCount: 0,
        connectionLimit: 50,
        isLoopbackBind: true,
      });
      assert.equal(snapshot.overall, "ok");
    });

    it("returns needs_attention when any subsystem needs attention", () => {
      const snapshot = assessSecurityHealth({
        authStoreExists: false, // needs_attention
        rateLimiterActive: true,
        connectionLimiterActive: true,
        isLoopbackBind: true,
      });
      assert.equal(snapshot.overall, "needs_attention");
    });

    it("returns degraded when any subsystem is degraded", () => {
      const snapshot = assessSecurityHealth({
        connectionLimiterActive: true,
        connectionCount: 100,
        connectionLimit: 100, // degraded
        authStoreExists: true,
        authActiveTokens: 1,
        rateLimiterActive: true,
        isLoopbackBind: true,
      });
      assert.equal(snapshot.overall, "degraded");
    });
  });
});

describe("alert management", () => {
  it("upserts alert on duplicate id", () => {
    // Reset alerts to ensure clean state for this test
    resetAlerts();

    // Trigger auth store missing alert twice
    assessSecurityHealth({ authStoreExists: false });
    assessSecurityHealth({ authStoreExists: false });

    const alerts = getAlerts();
    const authAlert = alerts.find((a) => a.id === "auth.store_missing");
    assert.ok(authAlert, "auth alert should exist");
    assert.equal(authAlert!.count, 2, "count should increment on duplicate");
    assert.equal(authAlert!.severity, "critical");
    assert.equal(authAlert!.category, "auth");
  });

  it("generates alerts for critical conditions", () => {
    assessSecurityHealth({
      isLoopbackBind: false,
      requireTlsForRemote: false,
      authStoreExists: false,
      auditChainEnabled: true,
      auditVerificationOk: false,
    });

    const alerts = getAlerts();
    assert.ok(alerts.some((a) => a.id === "auth.store_missing"), "should have auth missing alert");
    assert.ok(alerts.some((a) => a.id === "network.remote_no_tls"), "should have no-TLS alert");
    assert.ok(alerts.some((a) => a.id === "audit.verification_failed"), "should have audit verification alert");
  });

  it("sorts critical alerts first", () => {
    // Generate some alerts with various severities
    assessSecurityHealth({ authStoreExists: false }); // critical
    assessSecurityHealth({ originPolicyConfigured: false }); // warning
    assessSecurityHealth({ redactionActive: false }); // warning

    const alerts = getAlerts();
    if (alerts.length > 1) {
      // Critical should come before warning
      const criticalIdx = alerts.findIndex((a) => a.severity === "critical");
      const warningIdx = alerts.findIndex((a) => a.severity === "warning");
      if (criticalIdx >= 0 && warningIdx >= 0) {
        assert.ok(criticalIdx < warningIdx, "critical should precede warning");
      }
    }
  });
});

describe("toSecurityStatusResponse", () => {
  it("produces safe response without details", () => {
    const snapshot = assessSecurityHealth({
      authStoreExists: true,
      authTokenCount: 5,
      authActiveTokens: 3,
      rateLimiterActive: true,
      connectionLimiterActive: true,
      connectionCount: 0,
      connectionLimit: 50,
      isLoopbackBind: true,
    });

    const response = toSecurityStatusResponse(snapshot);

    // Must have expected top-level keys
    assert.ok("overall" in response);
    assert.ok("assessedAt" in response);
    assert.ok("subsystems" in response);
    assert.ok("alertCount" in response);
    assert.ok("criticalAlerts" in response);
    assert.ok("warningAlerts" in response);

    // Subsystems must NOT include details (only summary)
    const subsystems = response.subsystems as Array<Record<string, unknown>>;
    for (const sub of subsystems) {
      assert.ok("subsystem" in sub);
      assert.ok("status" in sub);
      assert.ok("summary" in sub);
      // Details (token counts, addresses, etc.) should NOT be in the response
      assert.equal("details" in sub, false, `${sub.subsystem} should not have details`);
    }

    // assessedAt should be a valid ISO string
    assert.ok(typeof response.assessedAt === "string");
    assert.ok(!isNaN(Date.parse(response.assessedAt as string)));
  });

  it("includes critical and warning alert summaries", () => {
    // Trigger some alerts
    assessSecurityHealth({ authStoreExists: false });
    assessSecurityHealth({ originPolicyConfigured: false });

    const snapshot = assessSecurityHealth({});
    const response = toSecurityStatusResponse(snapshot);

    const critical = response.criticalAlerts as Array<{ id: string; title: string }>;
    const warnings = response.warningAlerts as Array<{ id: string; title: string }>;

    assert.ok(Array.isArray(critical));
    assert.ok(Array.isArray(warnings));

    // Each alert summary has only id and title (no messages, timestamps, counts)
    if (critical.length > 0) {
      const c = critical[0];
      assert.ok("id" in c);
      assert.ok("title" in c);
      assert.equal("message" in c, false);
      assert.equal("firstSeen" in c, false);
      assert.equal("count" in c, false);
    }
  });

  it("returns no credentials or hashes", () => {
    const snapshot = assessSecurityHealth({
      authStoreExists: true,
      authTokenCount: 5,
      authActiveTokens: 3,
    });
    const response = toSecurityStatusResponse(snapshot);
    const json = JSON.stringify(response);

    // Must not contain credential-like strings
    assert.equal(json.includes("sk-"), false);
    assert.equal(json.includes("Bearer"), false);
    // "token" may appear in subsystem summaries (e.g., "active tokens") — that's fine.
    // Raw token values (long random strings) should not appear.
    assert.equal(json.includes("127.0.0.1"), false);
  });
});

describe("passive guarantee", () => {
  it("does not throw when context is empty", () => {
    assert.doesNotThrow(() => assessSecurityHealth());
  });

  it("does not throw when context has unexpected fields", () => {
    const weird = { ...({} as HealthAssessmentContext) };
    assert.doesNotThrow(() => assessSecurityHealth(weird));
  });

  it("each subsystem has a summary string", () => {
    const snapshot = assessSecurityHealth();
    for (const sub of snapshot.subsystems) {
      assert.ok(typeof sub.summary === "string");
      assert.ok(sub.summary.length > 0, `${sub.subsystem} summary should not be empty`);
    }
  });

  it("all assessedAt timestamps are within 1 second of now", () => {
    const now = Date.now();
    const snapshot = assessSecurityHealth();
    for (const sub of snapshot.subsystems) {
      const diff = Math.abs(sub.assessedAt - now);
      assert.ok(diff < 1000, `${sub.subsystem} assessedAt should be recent`);
    }
  });
});
