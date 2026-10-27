/**
 * subagent-result-events.vitest.ts — pins that a subagent reports its own durable
 * diagnostics instead of a hardcoded empty array.
 *
 * WHY THIS EXISTS
 *
 * An independent denominator review declined a benchmark collection because
 * `inadmissible: false` could not be independently established: the delegate child
 * always returned `events: []`. That was not a dropped field — it was never
 * populated. Without the worker's own diagnostics, "no recorded infrastructure
 * error" is not evidence that none occurred.
 *
 * The bound matters too: the result travels to the parent as one JSON line on
 * stdout, so an unbounded dump risks the worker's machine contract. Truncation is
 * recorded explicitly, because a bounded record that looks complete is worse than
 * no record.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_RESULT_EVENTS,
  MAX_RESULT_EVENT_CHARS,
  serializeResultEvents,
  buildResult,
} from "../../src/agents/subagent-cli.js";
import type { WriteProgress } from "../../src/agents/subagent-cli.js";

const here = dirname(fileURLToPath(import.meta.url));

function emptyProgress(): WriteProgress {
  return { successfulPaths: new Set<string>(), fatalWriteFailures: [] } as unknown as WriteProgress;
}

describe("serializeResultEvents", () => {
  it("serializes events as JSON lines", () => {
    const out = serializeResultEvents([
      { type: "tool.completed", payload: { toolName: "file.read" }, timestamp: "2026-10-24T00:00:00Z" },
      { type: "model.usage", payload: { inputTokens: 10 } },
    ]);
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0]!).type).toBe("tool.completed");
    expect(JSON.parse(out[1]!).payload.inputTokens).toBe(10);
  });

  it("returns an empty array for no events — not a fabricated record", () => {
    expect(serializeResultEvents([])).toEqual([]);
  });

  it("bounds the event count and records the truncation", () => {
    const many = Array.from({ length: MAX_RESULT_EVENTS + 25 }, (_, i) => ({
      type: "tool.completed",
      payload: { i },
    }));
    const out = serializeResultEvents(many);
    // One extra line carries the truncation marker.
    expect(out).toHaveLength(MAX_RESULT_EVENTS + 1);
    const marker = JSON.parse(out[out.length - 1]!);
    expect(marker.type).toBe("subagent.events.truncated");
    expect(marker.payload.dropped).toBe(25);
  });

  it("bounds total characters and records the truncation", () => {
    const big = Array.from({ length: 10 }, () => ({
      type: "tool.output",
      payload: { text: "x".repeat(16 * 1024) },
    }));
    const out = serializeResultEvents(big);
    const total = out.reduce((n, line) => n + line.length, 0);
    // The bound plus at most one marker line.
    expect(total).toBeLessThanOrEqual(MAX_RESULT_EVENT_CHARS + 200);
    const marker = JSON.parse(out[out.length - 1]!);
    expect(marker.type).toBe("subagent.events.truncated");
    expect(marker.payload.dropped).toBeGreaterThan(0);
  });

  it("skips an unserializable event rather than throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = serializeResultEvents([
      { type: "bad", payload: circular },
      { type: "tool.completed", payload: {} },
    ]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!).type).toBe("tool.completed");
  });
});

describe("buildResult emits the worker's diagnostics", () => {
  it("carries through the events it was given", () => {
    const events = [
      { type: "session.started", payload: {} },
      { type: "tool.completed", payload: { toolName: "file.read" } },
    ];
    const r = buildResult(
      "t1", "worker" as never, "write",
      "done", [], emptyProgress(), [],
      new Map(),
      { events },
    );
    expect(r.events).toHaveLength(2);
    expect(JSON.parse(r.events[0]!).type).toBe("session.started");
  });

  it("stays empty when the worker genuinely produced no events", () => {
    const r = buildResult("t1", "worker" as never, "write", "done", [], emptyProgress(), [], new Map());
    expect(r.events).toEqual([]);
  });

  it("is populated from the durable log at the call site, not hardcoded", () => {
    // Source contract: `events: []` in the built result was the defect. The call
    // site must read the worker's own log and pass it in.
    const src = readFileSync(join(here, "..", "..", "src", "agents", "subagent-cli.ts"), "utf-8");
    expect(src).toMatch(/readDurableEvents\(eventLog\)/);
    expect(src).toMatch(/events: durableEvents/);
    // No remaining unconditional empty emission in buildResult's return.
    expect(src).not.toMatch(/findings,\s*\n\s*events: \[\],\s*\n\s*error,/);
  });
});
