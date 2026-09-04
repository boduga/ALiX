// tests/runtime/tool-scheduler.vitest.ts — T4 tracer bullet
import { describe, it, expect } from "vitest";
import {
  getToolConcurrency,
  canParallelize,
  effectiveParallel,
  scheduleToolCalls,
  scheduleToolCallsTimed,
  DEFAULT_TOOL_EXECUTION_POLICY,
  createToolExecutionPolicy,
  type ToolExecutionPolicy,
} from "../../src/runtime/tool-scheduler.js";
import type { ToolCall } from "../../src/providers/types.js";

function tc(name: string, id: string): ToolCall {
  return { id, name, args: {}, summary: name };
}

describe("ToolConcurrency authoritative metadata", () => {
  it("safe: file.read, dir.search, web_search, file.exists", () => {
    expect(getToolConcurrency("file.read")).toBe("safe");
    expect(getToolConcurrency("alix_file_read")).toBe("safe");
    expect(getToolConcurrency("dir.search")).toBe("safe");
    expect(getToolConcurrency("file.exists")).toBe("safe");
    expect(getToolConcurrency("web_search")).toBe("safe");
    expect(getToolConcurrency("web_fetch")).toBe("safe");
  });

  it("exclusive: file.create, file.delete, shell.run, patch.apply, delegate, mcp.*", () => {
    expect(getToolConcurrency("file.create")).toBe("exclusive");
    expect(getToolConcurrency("file.delete")).toBe("exclusive");
    expect(getToolConcurrency("shell.run")).toBe("exclusive");
    expect(getToolConcurrency("patch.apply")).toBe("exclusive");
    expect(getToolConcurrency("delegate")).toBe("exclusive");
    expect(getToolConcurrency("mcp.github.repos.list")).toBe("exclusive");
    expect(getToolConcurrency("mcp.any.tool")).toBe("exclusive");
  });

  it("fail-closed unknown -> undefined (treated as exclusive/serial)", () => {
    expect(getToolConcurrency("unknown_tool")).toBeUndefined();
    expect(getToolConcurrency("write_file")).toBeUndefined();
    expect(getToolConcurrency("")).toBeUndefined();
  });

  it("never infers from names alone — write_file(A)+read_file(A) not parallel even if same file name in args", () => {
    // write_file is unknown → serial; read_file alias
    const a = tc("file.read", "a");
    const b = tc("file.create", "b"); // exclusive
    expect(canParallelize([a, b], DEFAULT_TOOL_EXECUTION_POLICY, true)).toBe(false);
  });
});

describe("ToolExecutionPolicy {allowParallel, maxParallel:4}", () => {
  it("default is allowParallel:true maxParallel:4", () => {
    expect(DEFAULT_TOOL_EXECUTION_POLICY.allowParallel).toBe(true);
    expect(DEFAULT_TOOL_EXECUTION_POLICY.maxParallel).toBe(4);
  });

  it("createToolExecutionPolicy clamps", () => {
    expect(createToolExecutionPolicy({ maxParallel: 0 }).maxParallel).toBe(1);
    expect(createToolExecutionPolicy({ maxParallel: 99 }).maxParallel).toBe(4);
  });

  it("harness allowParallel false forces serial", () => {
    const policy: ToolExecutionPolicy = { allowParallel: false, maxParallel: 4 };
    expect(canParallelize([tc("file.read", "a"), tc("file.read", "b")], policy, true)).toBe(false);
  });
});

describe("effectiveParallel = model && harness && safe", () => {
  it("both must be true — model false => serial even if safe", () => {
    const policy = DEFAULT_TOOL_EXECUTION_POLICY;
    const safe = [tc("file.read", "a"), tc("file.read", "b")];
    expect(effectiveParallel(safe, policy, false)).toBe(false);
    expect(effectiveParallel(safe, policy, true)).toBe(true);
  });

  it("harness false => serial even if model true", () => {
    const safe = [tc("file.read", "a"), tc("file.read", "b")];
    expect(effectiveParallel(safe, { allowParallel: false, maxParallel: 4 }, true)).toBe(false);
  });

  it("unknown concurrency => serial (fail-closed)", () => {
    expect(effectiveParallel([tc("file.read", "a"), tc("unknown_tool", "b")], DEFAULT_TOOL_EXECUTION_POLICY, true)).toBe(false);
  });

  it("exclusive => serial", () => {
    expect(effectiveParallel([tc("file.read", "a"), tc("file.create", "b")], DEFAULT_TOOL_EXECUTION_POLICY, true)).toBe(false);
    expect(effectiveParallel([tc("file.create", "a"), tc("file.create", "b")], DEFAULT_TOOL_EXECUTION_POLICY, true)).toBe(false);
  });

  it("single tool => serial (no benefit)", () => {
    expect(effectiveParallel([tc("file.read", "a")], DEFAULT_TOOL_EXECUTION_POLICY, true)).toBe(false);
  });
});

describe("scheduler dispatch", () => {
  it("independent safe calls (read_file A + read_file B) → parallel Promise.all overlapping", async () => {
    const calls = [tc("file.read", "A"), tc("file.read", "B")];
    // each exec 60ms
    const exec = async (c: ToolCall) => {
      await new Promise(r => setTimeout(r, 60));
      return c.id;
    };
    const timed = await scheduleToolCallsTimed(calls, DEFAULT_TOOL_EXECUTION_POLICY, true, exec);
    expect(timed.length).toBe(2);
    const a = timed[0]!;
    const b = timed[1]!;
    // hard invariant: A.start < B.end && B.start < A.end
    expect(a.start < b.end).toBe(true);
    expect(b.start < a.end).toBe(true);
    // wall time should be ~60 not ~120
    const wall = Math.max(a.end, b.end) - Math.min(a.start, b.start);
    expect(wall).toBeLessThan(110); // serial would be ~120
  });

  it("exclusive or unknown → serial (no overlap)", async () => {
    const calls = [tc("file.read", "A"), tc("file.create", "B")];
    const exec = async (c: ToolCall) => {
      await new Promise(r => setTimeout(r, 40));
      return c.id;
    };
    const timed = await scheduleToolCallsTimed(calls, DEFAULT_TOOL_EXECUTION_POLICY, true, exec);
    const a = timed[0]!;
    const b = timed[1]!;
    // serial: A.end <= B.start (allow 5ms jitter)
    expect(a.end <= b.start + 5).toBe(true);
    expect(a.start < b.end && b.start < a.end).toBe(false);
  });

  it("unsupported model → serial fallback even if model emitted 2", async () => {
    const calls = [tc("file.read", "A"), tc("file.read", "B")];
    const exec = async (c: ToolCall) => {
      await new Promise(r => setTimeout(r, 40));
      return c.id;
    };
    const timed = await scheduleToolCallsTimed(calls, DEFAULT_TOOL_EXECUTION_POLICY, false, exec);
    const a = timed[0]!;
    const b = timed[1]!;
    expect(a.end <= b.start + 5).toBe(true);
    expect(a.start < b.end && b.start < a.end).toBe(false);
  });

  it("maxParallel enforced (6 safe calls with policy 4 → max 4 concurrent)", async () => {
    const calls = Array.from({ length: 6 }, (_, i) => tc("file.read", `id${i}`));
    let concurrent = 0;
    let maxConcurrent = 0;
    const exec = async (c: ToolCall) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 25));
      concurrent--;
      return c.id;
    };
    const results = await scheduleToolCalls(calls, DEFAULT_TOOL_EXECUTION_POLICY, true, exec);
    expect(results).toHaveLength(6);
    expect(maxConcurrent).toBe(4);
    // order preserved
    expect(results).toEqual(calls.map(c => c.id));
  });

  it("each call independently governed before StepExecutor (deny one, allow other → distinct results)", async () => {
    const calls = [tc("file.read", "ok"), tc("file.read", "denied")];
    // simulate per-call governance: second call denied
    const exec = async (c: ToolCall) => {
      await new Promise(r => setTimeout(r, 20));
      if (c.id === "denied") throw new Error("Governance denied: policy forbids file.read for denied");
      return `content:${c.id}`;
    };
    // For this test we want independent results — use Promise.allSettled style via scheduleToolCalls that propagates throw?
    // Our scheduler propagates throw: Promise.all will reject on first throw, which would not give distinct results.
    // For T4 we handle independent governance at handleToolCall level which catches denial and returns message, not throw.
    // So simulate governance that returns result object instead of throw.
    const execGoverned = async (c: ToolCall) => {
      await new Promise(r => setTimeout(r, 10));
      if (c.id === "denied") return { id: c.id, governance: "denied", content: "Blocked by policy" };
      return { id: c.id, governance: "allowed", content: "file content" };
    };
    const results = await scheduleToolCalls(calls, DEFAULT_TOOL_EXECUTION_POLICY, true, execGoverned);
    expect(results[0]).toMatchObject({ governance: "allowed" });
    expect(results[1]).toMatchObject({ governance: "denied" });
  });

  it("preserves input order even when parallel (chunked)", async () => {
    const calls = [tc("file.read", "x"), tc("dir.search", "y"), tc("file.exists", "z")];
    const exec = async (c: ToolCall) => {
      // varying delays but order should be preserved
      const delays: Record<string, number> = { x: 30, y: 5, z: 15 };
      await new Promise(r => setTimeout(r, delays[c.id] ?? 10));
      return c.id;
    };
    const results = await scheduleToolCalls(calls, DEFAULT_TOOL_EXECUTION_POLICY, true, exec);
    expect(results).toEqual(["x", "y", "z"]);
  });

  it("unknown tool -> serial (fail-closed)", async () => {
    const calls = [tc("file.read", "a"), tc("unknown_tool", "b")];
    expect(canParallelize(calls, DEFAULT_TOOL_EXECUTION_POLICY, true)).toBe(false);
  });
});
