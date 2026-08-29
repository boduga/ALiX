/**
 * scripted-mock-provider.vitest.ts — Phase 3 self-tests for the scripted
 * ModelAdapter (§25 scripted-provider matrix).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ScriptedMockProvider } from "../../src/evals/providers/scripted-mock-provider.js";
import { setScriptedScenario, clearScriptedScenario } from "../../src/evals/providers/scripted-mock-carrier.js";
import type { NormalizedRequest } from "../../src/providers/types.js";

const req: NormalizedRequest = { systemPrompt: "", messages: [] };

describe("scripted-mock-provider — carrier mode (registry path)", () => {
  beforeEach(() => clearScriptedScenario());
  afterEach(() => clearScriptedScenario());

  it("constructed with only apiKey/model reads steps from the carrier", async () => {
    setScriptedScenario({ steps: [{ kind: "tool", tool: "file.create", args: { path: "r.md", content: "x" } }] });
    const p = new ScriptedMockProvider({ apiKey: "", model: "mock" });
    const r = await p.complete(req);
    expect(r.toolCalls[0].name).toBe("alix_file_create");
    expect(r.toolCalls[0].args.path).toBe("r.md");
  });

  it("no active scenario → no tool calls", async () => {
    const p = new ScriptedMockProvider({ apiKey: "", model: "mock" });
    const r = await p.complete(req);
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toBe("Done.");
  });
});

describe("scripted-mock-provider — steps", () => {
  it("text step → text response, no tool calls", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "text", text: "hello" }] });
    const r = await p.complete(req);
    expect(r.text).toBe("hello");
    expect(r.toolCalls).toEqual([]);
  });

  it("file.create tool step → emits wire tool call", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "tool", tool: "file.create", args: { path: "report.md", content: "# Q3\nrevenue: 42\n" } }] });
    const r = await p.complete(req);
    expect(r.text).toBe("");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].name).toBe("alix_file_create");
    expect(r.toolCalls[0].args.path).toBe("report.md");
  });

  it("file.delete tool step → emits wire tool call", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "tool", tool: "file.delete", args: { path: "x.txt" } }] });
    const r = await p.complete(req);
    expect(r.toolCalls[0].name).toBe("alix_file_delete");
    expect(r.toolCalls[0].args.path).toBe("x.txt");
  });

  it("patch.apply tool step → emits wire tool call", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "tool", tool: "patch.apply", args: { format: "unified_diff", patchText: "--- a\n+++ b\n" } }] });
    const r = await p.complete(req);
    expect(r.toolCalls[0].name).toBe("alix_patch_apply");
  });

  it("multiple steps replay in order across complete() calls", async () => {
    const p = new ScriptedMockProvider({
      steps: [
        { kind: "tool", tool: "file.create", args: { path: "a.txt", content: "one" } },
        { kind: "tool", tool: "file.create", args: { path: "b.txt", content: "two" } },
        { kind: "text", text: "done" },
      ],
    });
    const r1 = await p.complete(req);
    expect(r1.toolCalls[0].args.path).toBe("a.txt");
    const r2 = await p.complete(req);
    expect(r2.toolCalls[0].args.path).toBe("b.txt");
    const r3 = await p.complete(req);
    expect(r3.text).toBe("done");
  });

  it("error step → throws", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "error", error: "boom" }] });
    await expect(p.complete(req)).rejects.toThrow("boom");
  });

  it("exhausted steps → empty final response", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "text", text: "x" }] });
    await p.complete(req);
    const r = await p.complete(req);
    expect(r.text).toBe("Done.");
    expect(r.toolCalls).toEqual([]);
  });
});

describe("scripted-mock-provider — capabilities", () => {
  it("supportsTools = true", () => {
    const p = new ScriptedMockProvider({ steps: [] });
    expect(p.capabilities.supportsTools).toBe(true);
  });

  it("negotiate returns tool-enabled capabilities", async () => {
    const p = new ScriptedMockProvider({ steps: [] });
    const n = await p.negotiate(req);
    expect(n.toolsEnabled).toBe(true);
    expect(n.editFormat).toBe("structured_patch");
  });

  it("stream emits a tool delta then done for a tool step", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "tool", tool: "file.create", args: { path: "p.txt", content: "c" } }] });
    const chunks: string[] = [];
    for await (const c of p.stream(req)) {
      chunks.push(c.type);
      if (c.type === "tool_call") {
        expect(c.toolCall.name).toBe("alix_file_create");
      }
    }
    expect(chunks).toContain("tool_call");
    expect(chunks).toContain("done");
  });

  it("stream emits a text delta then done for a text step (one model turn)", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "text", text: "hi" }] });
    const chunks: string[] = [];
    for await (const c of p.stream(req)) {
      chunks.push(c.type);
    }
    expect(chunks).toEqual(["text_delta", "done"]);
  });
});

describe("scripted-mock-provider — reset", () => {
  it("reset restarts the cursor", async () => {
    const p = new ScriptedMockProvider({ steps: [{ kind: "text", text: "only" }] });
    await p.complete(req);
    p.reset();
    const r = await p.complete(req);
    expect(r.text).toBe("only");
  });
});
