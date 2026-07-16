import { describe, it, expect } from "vitest";
import {
  buildSessionStreamHandler,
  emitSessionEvents,
  extractToolResultsFromMessages,
  type AgentSessionEvents,
  type ToolResult,
  type Message,
} from "../../src/agent/session.js";
import type { ToolCall } from "../../src/providers/types.js";

function makeEvents(): AgentSessionEvents & {
  tokens: string[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
} {
  const tokens: string[] = [];
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  return {
    tokens,
    toolCalls,
    toolResults,
    onToken(token: string): void {
      tokens.push(token);
    },
    onToolCall(call: ToolCall): void {
      toolCalls.push(call);
    },
    onToolResult(result: ToolResult): void {
      toolResults.push(result);
    },
  };
}

describe("buildSessionStreamHandler", () => {
  it("returns original handler when events are undefined", () => {
    const original = (chunk: { type: "text" | "tool_call"; text?: string }): void => {};
    const wrapped = buildSessionStreamHandler(original, undefined);
    expect(wrapped).toBe(original);
  });

  it("fires onToken for each text chunk", () => {
    const events = makeEvents();
    const wrapped = buildSessionStreamHandler(undefined, events)!;
    wrapped({ type: "text", text: "hello " });
    wrapped({ type: "text", text: "world" });
    expect(events.tokens).toEqual(["hello ", "world"]);
  });

  it("calls original handler and fires onToken for text chunks", () => {
    const seen: string[] = [];
    const original = (chunk: { type: "text" | "tool_call"; text?: string }): void => {
      if (chunk.text) seen.push(chunk.text);
    };
    const events = makeEvents();
    const wrapped = buildSessionStreamHandler(original, events)!;
    wrapped({ type: "text", text: "abc" });
    expect(seen).toEqual(["abc"]);
    expect(events.tokens).toEqual(["abc"]);
  });

  it("ignores non-text chunks for onToken", () => {
    const events = makeEvents();
    const wrapped = buildSessionStreamHandler(undefined, events)!;
    wrapped({ type: "tool_call", toolCall: { id: "x", name: "noop", args: {} } });
    expect(events.tokens).toEqual([]);
  });
});

describe("extractToolResultsFromMessages", () => {
  it("returns empty array when no tool result messages", () => {
    const msgs: Message[] = [{ role: "user", content: "hello" }];
    expect(extractToolResultsFromMessages(msgs)).toEqual([]);
  });

  it("extracts single tool result with id and content", () => {
    const msgs: Message[] = [
      { role: "user", content: '<tool_result id="abc">42</tool_result>' },
    ];
    const results = extractToolResultsFromMessages(msgs);
    expect(results).toHaveLength(1);
    expect(results[0].toolCallId).toBe("abc");
    expect(results[0].content).toBe("42");
    expect(results[0].isError).toBeFalsy();
  });

  it("extracts multiple tool results in order", () => {
    const msgs: Message[] = [
      {
        role: "user",
        content:
          '<tool_result id="a">first</tool_result>\n<tool_result id="b">second</tool_result>',
      },
    ];
    const results = extractToolResultsFromMessages(msgs);
    expect(results.map((r) => r.toolCallId)).toEqual(["a", "b"]);
  });

  it("marks error tool results with isError=true", () => {
    const msgs: Message[] = [
      { role: "user", content: '<tool_result id="x">Error: boom</tool_result>' },
    ];
    const results = extractToolResultsFromMessages(msgs);
    expect(results[0].isError).toBe(true);
  });

  it("skips assistant-role messages", () => {
    const msgs: Message[] = [
      { role: "assistant", content: '<tool_result id="x">ignored</tool_result>' },
    ];
    expect(extractToolResultsFromMessages(msgs)).toEqual([]);
  });
});

describe("emitSessionEvents", () => {
  it("is a no-op when events are undefined", () => {
    expect(() =>
      emitSessionEvents(
        undefined,
        [{ id: "t1", name: "x", args: {} }],
        [],
        [],
      ),
    ).not.toThrow();
  });

  it("fires onToolCall once per tool call", () => {
    const events = makeEvents();
    const calls: ToolCall[] = [
      { id: "t1", name: "file.read", args: { path: "/a" } },
      { id: "t2", name: "shell.run", args: { command: "ls" } },
    ];
    emitSessionEvents(events, calls, [], []);
    expect(events.toolCalls).toEqual(calls);
  });

  it("fires onToolResult for each extracted tool result", () => {
    const events = makeEvents();
    const messages: Message[] = [
      { role: "user", content: '<tool_result id="a">first output</tool_result>' },
      { role: "user", content: '<tool_result id="b">Error: failed</tool_result>' },
    ];
    emitSessionEvents(events, [], messages, []);
    expect(events.toolResults).toHaveLength(2);
    expect(events.toolResults[0].toolCallId).toBe("a");
    expect(events.toolResults[0].isError).toBeFalsy();
    expect(events.toolResults[1].toolCallId).toBe("b");
    expect(events.toolResults[1].isError).toBe(true);
  });

  it("fires onToolCall and onToolResult independently", () => {
    const events = makeEvents();
    const calls: ToolCall[] = [{ id: "t1", name: "noop", args: {} }];
    const messages: Message[] = [
      { role: "user", content: '<tool_result id="t1">done</tool_result>' },
    ];
    emitSessionEvents(events, calls, messages, []);
    expect(events.toolCalls).toHaveLength(1);
    expect(events.toolResults).toHaveLength(1);
  });
});