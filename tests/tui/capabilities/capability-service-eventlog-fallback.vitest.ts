import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityService } from "../../../src/tui/capabilities/capability-service.js";
import { EventLog } from "../../../src/events/event-log.js";

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("CapabilityService EventLog fallback", () => {
  it("never writes events.jsonl into the caller's cwd when no eventLog is supplied", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cap-fallback-cwd-"));
    const svc = new CapabilityService(undefined, { cwd });
    await svc.ready();
    await settle();
    expect(existsSync(join(cwd, "events.jsonl"))).toBe(false);
  });

  it("control: a supplied EventLog receives capability events within the same window", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "cap-fallback-log-"));
    const log = new EventLog(logDir);
    await log.init();
    const cwd = mkdtempSync(join(tmpdir(), "cap-fallback-cwd2-"));

    const svc = new CapabilityService(undefined, { eventLog: log, cwd });
    await svc.ready();
    await settle();

    const events = await log.readAll();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "capability.CapabilityRegistered")).toBe(true);
    expect(existsSync(join(cwd, "events.jsonl"))).toBe(false);
  });
});
