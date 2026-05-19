import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { ApprovalManager } from "../../src/policy/approvals.js";

describe("Approval Events", () => {
  const testDir = join(process.cwd(), ".test-approval-events");
  let eventLog: EventLog;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits approval.requested event", async () => {
    const approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
      promptFn: async () => "yes",
    });

    await approvalManager.requestApproval({
      toolCallId: "call-123",
      prompt: "Allow file write?",
    });

    const events = await eventLog.readAll();
    const requestedEvent = events.find((e) => e.type === "approval.requested");
    assert.ok(requestedEvent);
    const payload = requestedEvent.payload as any;
    assert.ok(payload.approvalId.startsWith("approval_"));
    assert.equal(payload.toolCallId, "call-123");
    assert.ok(payload.choices.includes("approve"));
  });

  it("emits approval.resolved with decision", async () => {
    const approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
      promptFn: async () => "yes",
    });

    await approvalManager.requestApproval({
      toolCallId: "call-123",
      prompt: "Allow file write?",
    });

    const events = await eventLog.readAll();
    const resolvedEvent = events.find((e) => e.type === "approval.resolved");
    assert.ok(resolvedEvent);
    assert.equal((resolvedEvent.payload as any).decision, "approved");
  });

  it("emits denial decision", async () => {
    const approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
      promptFn: async () => "no",
    });

    await approvalManager.requestApproval({
      toolCallId: "call-456",
      prompt: "Delete file?",
    });

    const events = await eventLog.readAll();
    const resolvedEvent = events.find((e) => e.type === "approval.resolved");
    assert.ok(resolvedEvent);
    assert.equal((resolvedEvent.payload as any).decision, "denied");
  });

  it("emits edited decision", async () => {
    const approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
      promptFn: async () => "e",
    });

    await approvalManager.requestApproval({
      toolCallId: "call-789",
      prompt: "Edit configuration?",
    });

    const events = await eventLog.readAll();
    const resolvedEvent = events.find((e) => e.type === "approval.resolved");
    assert.ok(resolvedEvent);
    assert.equal((resolvedEvent.payload as any).decision, "edited");
  });

  it("getPendingCount returns correct count", () => {
    const approvalManager = new ApprovalManager({
      eventLog,
      sessionId: "test-session",
    });
    assert.equal(approvalManager.getPendingCount(), 0);
  });
});