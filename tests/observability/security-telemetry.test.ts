import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MetricsStore } from "../../src/observability/metrics-store.js";
import { createMetricRegistry, type MetricRegistry } from "../../src/observability/metric-registry.js";
import { SecurityTelemetry, FakeSecurityTelemetry } from "../../src/observability/security-telemetry.js";

describe("SecurityTelemetry", () => {
  let tmpDir: string;
  let store: MetricsStore;
  let registry: MetricRegistry;
  let telemetry: SecurityTelemetry;
  let redactCallCount: number;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "security-telemetry-test-"));
    mkdirSync(join(tmpDir, ".alix", "observability", "metrics"), { recursive: true });
    store = new MetricsStore(tmpDir);
    registry = createMetricRegistry();
    redactCallCount = 0;
    telemetry = new SecurityTelemetry({
      registry,
      metricsStore: store,
      redactPayload: (v) => {
        redactCallCount++;
        return v;
      },
    });
  });

  after(async () => {
    await telemetry.flush();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function readStored(): Promise<Array<{ name: string; labels?: Record<string, string>; value: number }>> {
    const results: Array<{ name: string; labels?: Record<string, string>; value: number }> = [];
    for await (const row of store.readAll({ order: "asc" })) {
      results.push({ name: row.name, labels: row.labels, value: row.value });
    }
    return results;
  }

  it("authAttempt emits correct metric", async () => {
    telemetry.authAttempt("success", "bearer");
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_auth_attempt");
    assert.ok(found, "should have security_auth_attempt in store");
    assert.equal(found?.labels?.result, "success");
    assert.equal(found?.labels?.method, "bearer");
    assert.equal(found?.value, 1);
  });

  it("authorizationDenied emits correct metric", async () => {
    telemetry.authorizationDenied("read:config", "config");
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_auth_denied");
    assert.ok(found, "should have security_auth_denied in store");
    assert.equal(found?.labels?.permission, "read:config");
    assert.equal(found?.labels?.routeClass, "config");
  });

  it("rateLimitRejected emits correct metric", async () => {
    telemetry.rateLimitRejected("api", "pre_auth");
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_rate_limited");
    assert.ok(found, "should have security_rate_limited in store");
    assert.equal(found?.labels?.routeClass, "api");
    assert.equal(found?.labels?.scope, "pre_auth");
  });

  it("redaction emits correct metric", async () => {
    telemetry.redaction("api_key", "response");
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_redaction");
    assert.ok(found, "should have security_redaction in store");
    assert.equal(found?.labels?.classification, "api_key");
    assert.equal(found?.labels?.sink, "response");
  });

  it("sseActive emits correct gauge", async () => {
    telemetry.sseActive("observability", 3);
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_sse_active");
    assert.ok(found, "should have security_sse_active in store");
    assert.equal(found?.labels?.stream, "observability");
    assert.equal(found?.value, 3);
  });

  it("auditAppend emits correct metric", async () => {
    telemetry.auditAppend("success");
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_audit_append");
    assert.ok(found, "should have security_audit_append in store");
    assert.equal(found?.labels?.result, "success");
  });

  it("configVerification emits correct metric", async () => {
    telemetry.configVerification("valid");
    await telemetry.flush();
    const stored = await readStored();
    const found = stored.find(s => s.name === "security_config_verified");
    assert.ok(found, "should have security_config_verified in store");
    assert.equal(found?.labels?.state, "valid");
  });

  it("securityGate emits both result and duration metrics", async () => {
    telemetry.securityGate("pass", 42);
    await telemetry.flush();
    const stored = await readStored();
    const resultHit = stored.find(s => s.name === "security_gate_result");
    const durationHit = stored.find(s => s.name === "security_gate_duration");
    assert.ok(resultHit, "should have security_gate_result");
    assert.ok(durationHit, "should have security_gate_duration");
    assert.equal(resultHit?.labels?.result, "pass");
    assert.equal(durationHit?.labels?.result, "pass");
    assert.equal(durationHit?.value, 42);
  });

  it("calls redactPayload on each emission", async () => {
    const beforeCount = redactCallCount;
    telemetry.authAttempt("failure", "none");
    assert.ok(redactCallCount > beforeCount, "redactPayload should be called");
  });

  it("emission failure is non-fatal (does not throw)", () => {
    // Create a broken store that throws on append
    const brokenStore = {
      append: () => { throw new Error("store broken"); },
    } as unknown as MetricsStore;

    const safeTelemetry = new SecurityTelemetry({
      registry,
      metricsStore: brokenStore,
    });

    // Should not throw
    safeTelemetry.authAttempt("success", "bearer");
    safeTelemetry.securityGate("fail", 100);
    safeTelemetry.configVerification("expired");
    // If we get here without throwing, the test passes
    assert.ok(true);
  });
});

describe("FakeSecurityTelemetry", () => {
  let tmpDir: string;
  let store: MetricsStore;
  let registry: MetricRegistry;
  let fake: FakeSecurityTelemetry;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fake-security-telemetry-test-"));
    mkdirSync(join(tmpDir, ".alix", "observability", "metrics"), { recursive: true });
    store = new MetricsStore(tmpDir);
    registry = createMetricRegistry();
    fake = new FakeSecurityTelemetry({ registry, metricsStore: store });
  });

  after(async () => {
    await fake.flush();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records events for all methods", () => {
    fake.authAttempt("success", "bearer");
    fake.authorizationDenied("read:grants", "grants");
    fake.rateLimitRejected("api", "post_auth");
    fake.redaction("jwt", "audit");
    fake.sseActive("session", 5);
    fake.auditAppend("failure");
    fake.configVerification("invalid");
    fake.securityGate("warn", 200);

    assert.equal(fake.events.length, 8);
    assert.equal(fake.events[0].method, "authAttempt");
    assert.deepEqual(fake.events[0].args, ["success", "bearer"]);
    assert.equal(fake.events[1].method, "authorizationDenied");
    assert.deepEqual(fake.events[1].args, ["read:grants", "grants"]);
    assert.equal(fake.events[2].method, "rateLimitRejected");
    assert.equal(fake.events[3].method, "redaction");
    assert.equal(fake.events[4].method, "sseActive");
    assert.equal(fake.events[5].method, "auditAppend");
    assert.equal(fake.events[6].method, "configVerification");
    assert.equal(fake.events[7].method, "securityGate");
  });

  it("also writes real metrics to store (super called)", async () => {
    await fake.flush();
    const stored: Array<{ name: string }> = [];
    for await (const row of store.readAll()) {
      stored.push({ name: row.name });
    }
    // Should have metrics from this test
    const names = [...new Set(stored.map(s => s.name))].sort();
    assert.ok(names.includes("security_auth_attempt"));
    assert.ok(names.includes("security_auth_denied"));
  });
});
