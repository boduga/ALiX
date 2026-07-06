/**
 * Tests P14.5b — Governance Audit Trail: export and redaction.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, unlinkSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  redactEvent,
  exportEvents,
  type ExportOptions,
  type ExportFormat,
} from "../../src/governance/audit-export.js";

import type { GovernanceAuditEvent, GovernanceEventType } from "../../src/governance/audit-types.js";

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<GovernanceAuditEvent> = {}): GovernanceAuditEvent {
  return {
    eventId: "test-ev-001",
    timestamp: "2026-07-06T14:00:00.000Z",
    eventType: "policy_evaluated" as GovernanceEventType,
    actorType: "policy_engine",
    actorId: "engine-v1",
    subjectType: "policy",
    subjectId: "pol-auto-approve",
    action: "evaluate_run_risk",
    decision: "allowed",
    policyId: null,
    policyVersion: null,
    ruleId: null,
    reason: "Run risk below threshold",
    evidenceRefs: [],
    requestId: null,
    traceId: null,
    sessionId: null,
    parentEventId: null,
    riskLevel: "low",
    requiresHumanReview: false,
    metadata: {},
    previousHash: null,
    eventHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// redactEvent
// ---------------------------------------------------------------------------

describe("redactEvent", () => {
  it("preserves top-level fields", () => {
    const event = makeEvent({ reason: "Test reason" });
    const redacted = redactEvent(event);
    assert.equal(redacted.eventId, event.eventId);
    assert.equal(redacted.reason, event.reason);
    assert.equal(redacted.action, event.action);
    assert.equal(redacted.decision, event.decision);
  });

  it("does not mutate original event", () => {
    const event = makeEvent({
      metadata: { apiKey: "sk-1234567890", publicData: "visible" },
    });
    const originalMetadata = { ...event.metadata };
    const redacted = redactEvent(event);
    assert.deepEqual(event.metadata, originalMetadata);
    assert.notDeepEqual(redacted.metadata, event.metadata);
  });

  it("redacts sensitive top-level metadata keys", () => {
    const event = makeEvent({
      metadata: {
        apiKey: "sk-1234567890",
        token: "eyJhbGciOiJIUzI1NiJ9",
        secret: "my-secret-value",
        publicData: "this-is-visible",
      },
    });
    const redacted = redactEvent(event);
    assert.equal(redacted.metadata.apiKey, "[REDACTED]");
    assert.equal(redacted.metadata.token, "[REDACTED]");
    assert.equal(redacted.metadata.secret, "[REDACTED]");
    assert.equal(redacted.metadata.publicData, "this-is-visible");
  });

  it("redacts sensitive keys in nested metadata", () => {
    const event = makeEvent({
      metadata: {
        nested: {
          apiKey: "sk-inner",
          innerSecret: "keep-me",
        },
        outer: "visible",
      },
    });
    const redacted = redactEvent(event);
    assert.equal((redacted.metadata.nested as Record<string, unknown>).apiKey, "[REDACTED]");
    assert.equal((redacted.metadata.nested as Record<string, unknown>).innerSecret, "keep-me");
    assert.equal(redacted.metadata.outer, "visible");
  });

  it("handles empty metadata", () => {
    const event = makeEvent({ metadata: {} });
    const redacted = redactEvent(event);
    assert.deepEqual(redacted.metadata, {});
  });

  it("handles metadata with no sensitive keys", () => {
    const event = makeEvent({
      metadata: { foo: "bar", count: 42, tags: ["a", "b"] },
    });
    const redacted = redactEvent(event);
    assert.deepEqual(redacted.metadata, event.metadata);
  });

  it("redacts all known sensitive key variants", () => {
    const sensitiveKeys = [
      "token", "tokens",
      "secret", "secrets",
      "password", "passwords",
      "apiKey", "api_key", "apiKeys", "api_keys",
      "credential", "credentials",
      "authToken", "auth_token",
      "accessToken", "access_token",
      "refreshToken", "refresh_token",
      "privateKey", "private_key",
      "sessionKey", "session_key",
    ];
    const metadata: Record<string, unknown> = {};
    for (const key of sensitiveKeys) {
      metadata[key] = "sensitive-value";
    }
    const event = makeEvent({ metadata });
    const redacted = redactEvent(event);
    for (const key of sensitiveKeys) {
      assert.equal(redacted.metadata[key], "[REDACTED]",
        `Expected ${key} to be redacted`);
    }
  });
});

// ---------------------------------------------------------------------------
// exportEvents
// ---------------------------------------------------------------------------

describe("exportEvents", () => {
  const events = [
    makeEvent({ eventId: "ev-1", timestamp: "2026-07-06T12:00:00.000Z" }),
    makeEvent({ eventId: "ev-2", timestamp: "2026-07-06T13:00:00.000Z" }),
  ];

  it("exports JSON format as pretty-printed array", () => {
    const output = exportEvents(events, "json");
    const parsed = JSON.parse(output);
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].eventId, "ev-1");
    assert.equal(parsed[1].eventId, "ev-2");
  });

  it("exports JSONL format as line-delimited", () => {
    const output = exportEvents(events, "jsonl");
    const lines = output.trim().split("\n");
    assert.equal(lines.length, 2);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.equal(parsed[0].eventId, "ev-1");
    assert.equal(parsed[1].eventId, "ev-2");
  });

  it("exports JSONL without trailing empty line after trim", () => {
    const output = exportEvents(events, "jsonl");
    assert.equal(output.endsWith("\n"), true);
  });

  it("exports JSON with trailing newline", () => {
    const output = exportEvents(events, "json");
    assert.equal(output.endsWith("\n"), true);
  });

  it("exports redacted events when redact option is true", () => {
    const eventsWithSecrets = [
      makeEvent({
        eventId: "ev-secret",
        metadata: { apiKey: "sk-test", publicData: "visible" },
      }),
    ];
    const output = exportEvents(eventsWithSecrets, "json", { redact: true });
    const parsed = JSON.parse(output);
    assert.equal(parsed[0].metadata.apiKey, "[REDACTED]");
    assert.equal(parsed[0].metadata.publicData, "visible");
  });

  it("exports unredacted when redact option is false", () => {
    const eventsWithSecrets = [
      makeEvent({
        eventId: "ev-secret",
        metadata: { apiKey: "sk-test" },
      }),
    ];
    const output = exportEvents(eventsWithSecrets, "json", { redact: false });
    const parsed = JSON.parse(output);
    assert.equal(parsed[0].metadata.apiKey, "sk-test");
  });

  it("handles empty event array", () => {
    const output = exportEvents([], "json");
    assert.equal(JSON.parse(output).length, 0);
  });

  it("handles JSONL output with empty array", () => {
    const output = exportEvents([], "jsonl");
    assert.equal(output.trim(), "");
  });
});
