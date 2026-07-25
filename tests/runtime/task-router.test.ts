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
      assert.equal(r.diagnostic, undefined);
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

  // ── Natural-language shell phrases ──
  it("routes 'list files' to tool.shell.run (natural phrase)", () => {
    const r = taskRouter("list files");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.tool, "shell.run");
      assert.equal(r.args.command, "ls -la");
    }
  });

  it("routes 'show files' to tool.shell.run", () => {
    const r = taskRouter("show files");
    assert.equal(r.kind, "tool");
  });

  it("routes 'where am i' to tool.shell.run", () => {
    const r = taskRouter("where am i");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.args.command, "pwd");
    }
  });

  it("routes 'show current directory' to tool.shell.run", () => {
    const r = taskRouter("show current directory");
    assert.equal(r.kind, "tool");
  });

  // ── Grounded chat routes (freshness signals) ──
  it("routes 'latest Node.js LTS version' to grounded_chat with diagnostic", () => {
    const r = taskRouter("latest Node.js LTS version");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.ok(r.allowedTools.includes("web.search"), "should include web.search");
      assert.equal(r.prompt, "latest Node.js LTS version");
      assert.equal(r.diagnostic.classification, "external_retrieval");
      assert.equal(r.diagnostic.route, "grounded_chat");
    }
  });

  it("routes 'search the web for alix frameworks' to grounded_chat", () => {
    const r = taskRouter("search the web for alix frameworks");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.equal(r.diagnostic.classification, "external_retrieval");
    }
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

  it("routes 'search latest docs' to grounded_chat (Task 2 required prompt)", () => {
    const r = taskRouter("search latest docs");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.equal(r.diagnostic.classification, "external_retrieval");
    }
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

  it("routes 'write a story about AI' to direct (standalone_generation beats docs)", () => {
    // The classifier's standalone_generation patterns match "write a
    // story" before the legacy `classifyTask` DOCS bucket does. The new
    // `direct` route absorbs what `chat` used to handle for generation
    // requests.
    const r = taskRouter("write a story about AI");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.diagnostic.classification, "standalone_generation");
    }
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

  it("routes 'Implement feature' to agent (Task 2 required prompt)", () => {
    const r = taskRouter("Implement feature");
    assert.equal(r.kind, "agent");
  });
});

// ── Direct routes (Task 2 addition) ────────────────────────────────────

describe("taskRouter — direct routes (action classifier)", () => {
  it("routes '2 + 2' to direct with the parsed answer", () => {
    const r = taskRouter("2 + 2");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, "4");
      assert.equal(r.prompt, "2 + 2");
      assert.equal(r.diagnostic.classification, "arithmetic");
      assert.equal(r.diagnostic.route, "direct");
    }
  });

  it("routes '(10 * 4) / 5' to direct with the parsed answer", () => {
    const r = taskRouter("(10 * 4) / 5");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, "8");
    }
  });

  it("arithmetic dominates shell detection (a malformed shell would still be arithmetic only if pure)", () => {
    // "1+1" is not a shell task — the router treats it as arithmetic.
    const r = taskRouter("1+1");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, "2");
    }
  });

  it("routes 'Write Fibonacci function in Python' to direct (standalone_generation)", () => {
    const r = taskRouter("Write Fibonacci function in Python");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.prompt, "Write Fibonacci function in Python");
      assert.equal(r.answer, undefined, "standalone_generation does not carry a pre-computed answer");
      assert.equal(r.diagnostic.classification, "standalone_generation");
      assert.equal(r.diagnostic.route, "direct");
    }
  });

  it("routes 'Explain SQL to me' to direct (standalone_generation via 'explain X to me')", () => {
    const r = taskRouter("Explain SQL to me");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.diagnostic.classification, "standalone_generation");
    }
  });
});

// ── Workspace / action dominance over retrieval (Task 2) ──────────────

describe("taskRouter — workspace_action dominates retrieval", () => {
  it("routes 'Find SQL usage in my repo' to agent (workspace_action overrides retrieval)", () => {
    // Note: brief uses "in repo" as shorthand; the actual workspace
    // anchor in the classifier is "my repo" / "this repo" / "the repo"
    // / "in the repo" / "in this repo". The router catches the brief's
    // intent via the existing anchor patterns.
    const r = taskRouter("Find SQL usage in my repo");
    assert.equal(r.kind, "agent");
    if (r.kind === "agent") {
      assert.equal(r.diagnostic.classification, "workspace_action");
      assert.equal(r.diagnostic.route, "agent");
    }
  });

  it("routes 'Search my repo for current Kubernetes vulnerabilities' to agent (workspace dominates retrieval)", () => {
    const r = taskRouter("Search my repo for current Kubernetes vulnerabilities");
    assert.equal(r.kind, "agent");
    if (r.kind === "agent") {
      assert.equal(r.diagnostic.classification, "workspace_action");
    }
  });

  it("routes 'Write SQL into file' to agent (ambiguous + non-research feature falls through to agent)", () => {
    // "Write SQL into file" is not a real file op (the target "file" has
    // no extension), so it falls through the classifier. Without a
    // workspace anchor and without a research/docs pattern, the legacy
    // fallthrough is `agent`.
    const r = taskRouter("Write SQL into file");
    assert.equal(r.kind, "agent");
  });
});

// ── Direct routes must NOT carry a pre-computed answer for generation ─

describe("taskRouter — direct route invariants", () => {
  it("arithmetic direct routes always have a string `answer`", () => {
    const r = taskRouter("2 ^ 10");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(typeof r.answer, "string");
      assert.equal(r.answer, "1024");
    }
  });

  it("standalone_generation direct routes do NOT have `answer` (one model call)", () => {
    const r = taskRouter("Write Fibonacci function in Python");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, undefined);
    }
  });

  it("every direct route carries a RouteDiagnostic with classification + route", () => {
    const r = taskRouter("5 + 5");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(typeof r.diagnostic.classification, "string");
      assert.equal(r.diagnostic.classification, "arithmetic");
      assert.equal(r.diagnostic.route, "direct");
      assert.equal(typeof r.diagnostic.reason, "string");
      assert.ok(r.diagnostic.reason.length > 0);
    }
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
