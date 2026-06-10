import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter, isGroundedChatTask } from "../../src/runtime/task-router.js";

describe("taskRouter", () => {
  // ── Tool routes (shell commands) ──
  it("routes 'ls' to tool.shell.run", () => {
    const r = taskRouter("ls");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.tool, "shell.run");
      assert.equal(r.args.command, "ls");
    }
  });

  it("routes 'ls -la' to tool.shell.run", () => {
    const r = taskRouter("ls -la");
    assert.equal(r.kind, "tool");
  });

  it("routes 'pwd' to tool.shell.run", () => {
    const r = taskRouter("pwd");
    assert.equal(r.kind, "tool");
  });

  it("routes 'cat package.json' to tool.shell.run", () => {
    const r = taskRouter("cat package.json");
    assert.equal(r.kind, "tool");
  });

  it("routes 'grep -r foo src/' to tool.shell.run", () => {
    const r = taskRouter("grep -r foo src/");
    assert.equal(r.kind, "tool");
  });

  it("routes 'head -20 file.txt' to tool.shell.run", () => {
    const r = taskRouter("head -20 file.txt");
    assert.equal(r.kind, "tool");
  });

  it("routes 'echo hello world' to tool.shell.run", () => {
    const r = taskRouter("echo hello world");
    assert.equal(r.kind, "tool");
  });

  // ── Grounded chat routes (freshness signals) ──
  it("routes 'latest Node.js LTS version' to grounded_chat", () => {
    const r = taskRouter("latest Node.js LTS version");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.ok(r.allowedTools.includes("web.search"), "should include web.search");
      assert.equal(r.prompt, "latest Node.js LTS version");
    }
  });

  it("routes 'search the web for alix frameworks' to grounded_chat", () => {
    const r = taskRouter("search the web for alix frameworks");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes \"what's the news today\" to grounded_chat", () => {
    const r = taskRouter("what's the news today");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'current Python 3 version' to grounded_chat", () => {
    const r = taskRouter("current Python 3 version");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'look up security advisories' to grounded_chat", () => {
    const r = taskRouter("look up security advisories");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'web search for typescript 5.7 features' to grounded_chat", () => {
    const r = taskRouter("web search for typescript 5.7 features");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'recent npm package vulnerability' to grounded_chat", () => {
    const r = taskRouter("recent npm package vulnerability");
    assert.equal(r.kind, "grounded_chat");
  });

  // ── Chat routes (research/docs — no freshness signal) ──
  it("routes 'what is a closure' to chat", () => {
    const r = taskRouter("what is a closure");
    assert.equal(r.kind, "chat");
    if (r.kind === "chat") assert.equal(r.prompt, "what is a closure");
  });

  it("routes 'explain OOP principles' to chat", () => {
    const r = taskRouter("explain OOP principles");
    assert.equal(r.kind, "chat");
  });

  it("routes 'write a story about AI' to chat", () => {
    const r = taskRouter("write a story about AI");
    assert.equal(r.kind, "chat");
  });

  it("routes 'research quantum computing' to chat", () => {
    const r = taskRouter("research quantum computing");
    assert.equal(r.kind, "chat");
  });

  it("routes 'tell me a joke' to agent (not chat — no research/docs pattern)", () => {
    // "tell" is not in the classifyTask research/docs patterns,
    // so it falls through to agent. This is correct behavior until
    // the routing expands to detect conversational chat queries.
    const r = taskRouter("tell me a joke");
    assert.equal(r.kind, "agent");
  });

  // ── Agent routes (feature/bugfix/refactor/unknown/fallthrough) ──
  it("routes 'refactor the auth module' to agent", () => {
    const r = taskRouter("refactor the auth module");
    assert.equal(r.kind, "agent");
  });

  it("routes 'implement login feature' to agent", () => {
    const r = taskRouter("implement login feature");
    assert.equal(r.kind, "agent");
  });

  it("routes 'fix the null pointer bug' to agent", () => {
    const r = taskRouter("fix the null pointer bug");
    assert.equal(r.kind, "agent");
  });

  it("routes 'add a new button to the dashboard' to agent", () => {
    const r = taskRouter("add a new button to the dashboard");
    assert.equal(r.kind, "agent");
  });

  it("routes 'run tests and fix failures' to agent", () => {
    const r = taskRouter("run tests and fix failures");
    assert.equal(r.kind, "agent");
  });

  it("routes 'unknown gibberish text' to agent (fallthrough)", () => {
    const r = taskRouter("flargle bargle wargle");
    assert.equal(r.kind, "agent");
  });
});

describe("isGroundedChatTask", () => {
  it("detects 'latest' keyword", () => {
    assert.ok(isGroundedChatTask("latest node version"));
  });

  it("detects 'search the web'", () => {
    assert.ok(isGroundedChatTask("search the web for docs"));
  });

  it("detects 'current price'", () => {
    assert.ok(isGroundedChatTask("current price of bitcoin"));
  });

  it("detects 'today news'", () => {
    assert.ok(isGroundedChatTask("today news headlines"));
  });

  it("detects 'version 5'", () => {
    assert.ok(isGroundedChatTask("what is the latest version of react"));
  });

  it("rejects plain research query", () => {
    assert.ok(!isGroundedChatTask("explain quantum computing"));
  });

  it("rejects shell command", () => {
    assert.ok(!isGroundedChatTask("ls"));
  });

  it("rejects empty string", () => {
    assert.ok(!isGroundedChatTask(""));
  });
});
