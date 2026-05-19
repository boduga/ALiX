import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { PolicyEngine } from "../../src/policy/policy-engine.js";
import type { AlixConfig } from "../../src/config/schema.js";

describe("Policy Engine Events", () => {
  const testDir = join(process.cwd(), ".test-policy-events");
  let eventLog: EventLog;
  let policyEngine: PolicyEngine;
  const testConfig: AlixConfig = {
    model: { provider: "openai", name: "gpt-4" },
    permissions: {
      default: "ask",
      tools: { "file.read": "allow", "file.write": "ask" },
      protectedPaths: [".env", ".git"],
    },
  } as AlixConfig;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
    policyEngine = new PolicyEngine(testConfig, {
      eventLog,
      sessionId: "test-session",
    });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits policy.decision on every decision", async () => {
    policyEngine.decide({
      toolCallId: "call-123",
      capability: "file.read",
    });
    await new Promise(resolve => setTimeout(resolve, 10)); // wait for async append
    const events = await eventLog.readAll();
    const decisionEvent = events.find((e) => e.type === "policy.decision");
    assert.ok(decisionEvent);
    const payload = decisionEvent.payload as any;
    assert.equal(payload.decision, "allow");
    assert.equal(payload.capability, "file.read");
  });

  it("emits deny decision for protected paths", async () => {
    policyEngine.decide({
      toolCallId: "call-456",
      capability: "file.read",
      path: ".env",
    });
    await new Promise(resolve => setTimeout(resolve, 10)); // wait for async append
    const events = await eventLog.readAll();
    const decisionEvent = events.find((e) => e.type === "policy.decision");
    assert.equal((decisionEvent.payload as any).decision, "deny");
    assert.ok((decisionEvent.payload as any).reason.includes("protected"));
  });

  it("includes matched rule id in event", async () => {
    policyEngine.decide({
      toolCallId: "call-789",
      capability: "file.write",
    });
    await new Promise(resolve => setTimeout(resolve, 10)); // wait for async append
    const events = await eventLog.readAll();
    const decisionEvent = events.find((e) => e.type === "policy.decision");
    assert.ok((decisionEvent.payload as any).matchedRuleId);
  });
});