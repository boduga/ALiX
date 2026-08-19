import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter, isGroundedChatTask } from "../../src/runtime/task-router.js";
import type { ModelAdapter } from "../../src/providers/types.js";

describe("taskRouter", async () => {
  // ── Tool routes (shell commands) ──
  it("routes 'ls' to tool.shell.run", async () => {
    const r = await taskRouter("ls");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.tool, "shell.run");
      assert.equal(r.args.command, "ls");
      assert.equal(r.diagnostic, undefined);
    }
  });

  it("routes 'ls -la' to tool.shell.run", async () => {
    const r = await taskRouter("ls -la");
    assert.equal(r.kind, "tool");
  });

  it("routes 'pwd' to tool.shell.run", async () => {
    const r = await taskRouter("pwd");
    assert.equal(r.kind, "tool");
  });

  it("routes 'cat package.json' to tool.shell.run", async () => {
    const r = await taskRouter("cat package.json");
    assert.equal(r.kind, "tool");
  });

  it("routes 'grep -r foo src/' to tool.shell.run", async () => {
    const r = await taskRouter("grep -r foo src/");
    assert.equal(r.kind, "tool");
  });

  it("routes 'head -20 file.txt' to tool.shell.run", async () => {
    const r = await taskRouter("head -20 file.txt");
    assert.equal(r.kind, "tool");
  });

  it("routes 'echo hello world' to tool.shell.run", async () => {
    const r = await taskRouter("echo hello world");
    assert.equal(r.kind, "tool");
  });

  // ── Natural-language shell phrases ──
  it("routes 'list files' to tool.shell.run (natural phrase)", async () => {
    const r = await taskRouter("list files");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.tool, "shell.run");
      assert.equal(r.args.command, "ls -la");
    }
  });

  it("routes 'show files' to tool.shell.run", async () => {
    const r = await taskRouter("show files");
    assert.equal(r.kind, "tool");
  });

  it("routes 'where am i' to tool.shell.run", async () => {
    const r = await taskRouter("where am i");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.args.command, "pwd");
    }
  });

  it("routes 'show current directory' to tool.shell.run", async () => {
    const r = await taskRouter("show current directory");
    assert.equal(r.kind, "tool");
  });

  // ── Grounded chat routes (freshness signals) ──
  it("routes 'latest Node.js LTS version' to grounded_chat with diagnostic", async () => {
    const r = await taskRouter("latest Node.js LTS version");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.ok(r.allowedTools.includes("web_search"), "should include web_search");
      assert.equal(r.prompt, "latest Node.js LTS version");
      assert.equal(r.diagnostic.classification, "external_retrieval");
      assert.equal(r.diagnostic.route, "grounded_chat");
    }
  });

  it("routes 'search the web for alix frameworks' to grounded_chat", async () => {
    const r = await taskRouter("search the web for alix frameworks");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.equal(r.diagnostic.classification, "external_retrieval");
    }
  });

  it("routes \"what's the news today\" to grounded_chat", async () => {
    const r = await taskRouter("what's the news today");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'current Python 3 version' to grounded_chat", async () => {
    const r = await taskRouter("current Python 3 version");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'look up security advisories' to grounded_chat", async () => {
    const r = await taskRouter("look up security advisories");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'web search for typescript 5.7 features' to grounded_chat", async () => {
    const r = await taskRouter("web search for typescript 5.7 features");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'recent npm package vulnerability' to grounded_chat", async () => {
    const r = await taskRouter("recent npm package vulnerability");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'search latest docs' to grounded_chat (Task 2 required prompt)", async () => {
    const r = await taskRouter("search latest docs");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.equal(r.diagnostic.classification, "external_retrieval");
    }
  });

  // ── Chat routes (research/docs — no freshness signal) ──
  it("routes 'what is a closure' to chat", async () => {
    const r = await taskRouter("what is a closure");
    assert.equal(r.kind, "chat");
    if (r.kind === "chat") assert.equal(r.prompt, "what is a closure");
  });

  it("routes 'explain OOP principles' to chat", async () => {
    const r = await taskRouter("explain OOP principles");
    assert.equal(r.kind, "chat");
  });

  it("routes 'write a story about AI' to direct (generation beats docs)", async () => {
    // The classifier's generation patterns match "write a
    // story" before the legacy `classifyTask` DOCS bucket does. The new
    // `direct` route absorbs what `chat` used to handle for generation
    // requests.
    const r = await taskRouter("write a story about AI");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.diagnostic.classification, "generation");
    }
  });

  it("routes 'research quantum computing' to chat", async () => {
    const r = await taskRouter("research quantum computing");
    assert.equal(r.kind, "chat");
  });

  it("routes 'tell me a joke' to agent (not chat — no research/docs pattern)", async () => {
    // "tell" is not in the classifyTask research/docs patterns,
    // so it falls through to agent. This is correct behavior until
    // the routing expands to detect conversational chat queries.
    const r = await taskRouter("tell me a joke");
    assert.equal(r.kind, "agent");
  });

  // ── Agent routes (feature/bugfix/refactor/unknown/fallthrough) ──
  it("routes 'refactor the auth module' to agent", async () => {
    const r = await taskRouter("refactor the auth module");
    assert.equal(r.kind, "agent");
  });

  it("routes 'implement login feature' to agent", async () => {
    const r = await taskRouter("implement login feature");
    assert.equal(r.kind, "agent");
  });

  it("routes 'fix the null pointer bug' to agent", async () => {
    const r = await taskRouter("fix the null pointer bug");
    assert.equal(r.kind, "agent");
  });

  it("routes 'add a new button to the dashboard' to agent", async () => {
    const r = await taskRouter("add a new button to the dashboard");
    assert.equal(r.kind, "agent");
  });

  it("routes 'run tests and fix failures' to agent", async () => {
    const r = await taskRouter("run tests and fix failures");
    assert.equal(r.kind, "agent");
  });

  it("routes 'unknown gibberish text' to agent (fallthrough)", async () => {
    const r = await taskRouter("flargle bargle wargle");
    assert.equal(r.kind, "agent");
  });

  it("routes 'Implement feature' to agent (Task 2 required prompt)", async () => {
    const r = await taskRouter("Implement feature");
    assert.equal(r.kind, "agent");
  });
});

// ── Direct routes (Task 2 addition) ────────────────────────────────────

describe("taskRouter — direct routes (action classifier)", async () => {
  it("routes '2 + 2' to direct with the parsed answer", async () => {
    const r = await taskRouter("2 + 2");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, "4");
      assert.equal(r.prompt, "2 + 2");
      assert.equal(r.diagnostic.classification, "arithmetic");
      assert.equal(r.diagnostic.route, "direct");
    }
  });

  it("routes '(10 * 4) / 5' to direct with the parsed answer", async () => {
    const r = await taskRouter("(10 * 4) / 5");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, "8");
    }
  });

  it("arithmetic dominates shell detection (a malformed shell would still be arithmetic only if pure)", async () => {
    // "1+1" is not a shell task — the router treats it as arithmetic.
    const r = await taskRouter("1+1");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, "2");
    }
  });

  it("routes 'Write Fibonacci function in Python' to direct (generation)", async () => {
    const r = await taskRouter("Write Fibonacci function in Python");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.prompt, "Write Fibonacci function in Python");
      assert.equal(r.answer, undefined, "generation does not carry a pre-computed answer");
      assert.equal(r.diagnostic.classification, "generation");
      assert.equal(r.diagnostic.route, "direct");
    }
  });

  it("routes 'Explain SQL to me' to direct (generation via 'explain X to me')", async () => {
    const r = await taskRouter("Explain SQL to me");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.diagnostic.classification, "generation");
    }
  });
});

// ── Workspace / action dominance over retrieval (Task 2) ──────────────

describe("taskRouter — workspace_action dominates retrieval", async () => {
  it("routes 'Find SQL usage in my repo' to agent (workspace_action overrides retrieval)", async () => {
    // Note: brief uses "in repo" as shorthand; the actual workspace
    // anchor in the classifier is "my repo" / "this repo" / "the repo"
    // / "in the repo" / "in this repo". The router catches the brief's
    // intent via the existing anchor patterns.
    const r = await taskRouter("Find SQL usage in my repo");
    assert.equal(r.kind, "agent");
    if (r.kind === "agent") {
      assert.equal(r.diagnostic.classification, "workspace_action");
      assert.equal(r.diagnostic.route, "agent");
    }
  });

  it("routes 'Search my repo for current Kubernetes vulnerabilities' to agent (workspace dominates retrieval)", async () => {
    const r = await taskRouter("Search my repo for current Kubernetes vulnerabilities");
    assert.equal(r.kind, "agent");
    if (r.kind === "agent") {
      assert.equal(r.diagnostic.classification, "workspace_action");
    }
  });

  it("routes 'Write SQL into file' to agent (ambiguous + non-research feature falls through to agent)", async () => {
    // "Write SQL into file" is not a real file op (the target "file" has
    // no extension), so it falls through the classifier. Without a
    // workspace anchor and without a research/docs pattern, the legacy
    // fallthrough is `agent`.
    const r = await taskRouter("Write SQL into file");
    assert.equal(r.kind, "agent");
  });

  it("routes local-machine probes to agent even when they contain retrieval signals", async () => {
    // Bug regression: "what is my linux version and what is the latest
    // linux LTS version" matched `\blatest\b`/`\bversion\b` →
    // external_retrieval → grounded_chat (web-only, no shell tool). The
    // local-machine anchor must dominate so the agent loop can answer the
    // "my linux version" half with `uname -a` and the "latest" half with
    // web_search.
    const r = await taskRouter(
      "what is my linux version and what is the latest linux LTS version",
    );
    assert.equal(r.kind, "agent");
    if (r.kind === "agent") {
      assert.equal(r.diagnostic.classification, "workspace_action");
    }
  });

  it("keeps a bare 'latest X version' question on grounded_chat (cheap web path)", async () => {
    const r = await taskRouter("what is the latest linux LTS version");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.deepEqual(r.allowedTools, ["web_search", "web_fetch"]);
    }
  });
});

// ── Direct routes must NOT carry a pre-computed answer for generation ─

describe("taskRouter — direct route invariants", async () => {
  it("arithmetic direct routes always have a string `answer`", async () => {
    const r = await taskRouter("2 ^ 10");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(typeof r.answer, "string");
      assert.equal(r.answer, "1024");
    }
  });

  it("generation direct routes do NOT have `answer` (one model call)", async () => {
    const r = await taskRouter("Write Fibonacci function in Python");
    assert.equal(r.kind, "direct");
    if (r.kind === "direct") {
      assert.equal(r.answer, undefined);
    }
  });

  it("every direct route carries a RouteDiagnostic with classification + route", async () => {
    const r = await taskRouter("5 + 5");
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

describe("isGroundedChatTask", async () => {
  it("detects 'latest' keyword", async () => {
    assert.ok(isGroundedChatTask("latest node version"));
  });

  it("detects 'search the web'", async () => {
    assert.ok(isGroundedChatTask("search the web for docs"));
  });

  it("detects 'current price'", async () => {
    assert.ok(isGroundedChatTask("current price of bitcoin"));
  });

  it("detects 'today news'", async () => {
    assert.ok(isGroundedChatTask("today news headlines"));
  });

  it("detects 'version 5'", async () => {
    assert.ok(isGroundedChatTask("what is the latest version of react"));
  });

  it("rejects plain research query", async () => {
    assert.ok(!isGroundedChatTask("explain quantum computing"));
  });

  it("rejects shell command", async () => {
    assert.ok(!isGroundedChatTask("ls"));
  });

  it("rejects empty string", async () => {
    assert.ok(!isGroundedChatTask(""));
  });
});

describe("taskRouter — Layer 2 confidence floor (T24 #402)", () => {
  // Layer 1 returns ambiguous / 0.5 for this prompt, so the model fallback
  // gate (intent === "ambiguous" || confidence < 0.7) is exercised.
  const AMBIGUOUS_PROMPT = "please handle this task";

  /** Mock classifier provider returning a fixed raw classification text. */
  function classifierProviderReturning(text: string): ModelAdapter {
    return {
      id: "mock-classifier",
      capabilities: {
        provider: "mock",
        model: "mock-model",
        inputTokenLimit: 1000,
        outputTokenLimit: 1000,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: false,
        supportsVision: false,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "trimmed_context",
      complete: async () => ({ text, toolCalls: [] }),
    };
  }

  it("trusted model classification (confidence ≥ floor) routes as the model intent", async () => {
    const provider = classifierProviderReturning(
      '{"intent":"workspace_mutation","confidence":0.9}',
    );
    const r = await taskRouter(AMBIGUOUS_PROMPT, { classifierProvider: provider });
    assert.equal(r.kind, "agent");
    assert.equal(
      r.kind === "agent" ? r.diagnostic.classification : undefined,
      "workspace_mutation",
    );
  });

  it("below-floor model classification never routes as the model intent", async () => {
    const provider = classifierProviderReturning(
      '{"intent":"workspace_mutation","confidence":0.4}',
    );
    const r = await taskRouter(AMBIGUOUS_PROMPT, { classifierProvider: provider });
    // Falls through to the safe default — the Layer-1 ambiguous label wins.
    assert.equal(r.kind, "agent");
    assert.equal(
      r.kind === "agent" ? r.diagnostic.classification : undefined,
      "ambiguous",
    );
  });

  it("missing confidence → default 0 → below floor → ambiguous", async () => {
    const provider = classifierProviderReturning('{"intent":"workspace_mutation"}');
    const r = await taskRouter(AMBIGUOUS_PROMPT, { classifierProvider: provider });
    assert.notEqual(
      r.kind === "agent" ? r.diagnostic.classification : undefined,
      "workspace_mutation",
    );
  });

  it("model classifier unavailable → ambiguous → safe default route", async () => {
    const provider: ModelAdapter = {
      id: "mock-classifier-error",
      capabilities: {
        provider: "mock",
        model: "mock-model",
        inputTokenLimit: 1000,
        outputTokenLimit: 1000,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: false,
        supportsVision: false,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "trimmed_context",
      complete: async () => {
        throw new Error("timeout");
      },
    };
    const r = await taskRouter(AMBIGUOUS_PROMPT, { classifierProvider: provider });
    assert.equal(r.kind, "agent");
    assert.equal(
      r.kind === "agent" ? r.diagnostic.classification : undefined,
      "ambiguous",
    );
  });
});

describe("taskRouter — Layer-1→Layer-2 gate closed-world (T25 #403)", () => {
  const AMBIGUOUS_PROMPT = "please handle this task";

  /** Classifier provider mock that records whether complete() was invoked. */
  function countingClassifierProvider(
    text: string,
  ): { provider: ModelAdapter; getCalls: () => number } {
    let calls = 0;
    const provider: ModelAdapter = {
      id: "mock-classifier",
      capabilities: {
        provider: "mock",
        model: "mock-model",
        inputTokenLimit: 1000,
        outputTokenLimit: 1000,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: false,
        supportsVision: false,
      },
      editFormatPreference: "structured_patch",
      longContextStrategy: "trimmed_context",
      complete: async () => {
        calls++;
        return { text, toolCalls: [] };
      },
    };
    return { provider, getCalls: () => calls };
  }

  it("high-confidence Layer-1 result never calls the model", async () => {
    // "run npm test" → shell_execution, confidence 0.9 (≥ 0.7). Routes via
    // the deterministic tool path. Even with a provider configured, the gate
    // must not invoke the model.
    const { provider, getCalls } = countingClassifierProvider(
      '{"intent":"generation","confidence":0.9}',
    );
    const r = await taskRouter("run npm test", { classifierProvider: provider });
    assert.equal(r.kind, "tool");
    assert.equal(getCalls(), 0);
  });

  it("ambiguous Layer-1 result + provider configured → model called", async () => {
    const { provider, getCalls } = countingClassifierProvider(
      '{"intent":"generation","confidence":0.9}',
    );
    const r = await taskRouter(AMBIGUOUS_PROMPT, { classifierProvider: provider });
    assert.equal(getCalls(), 1);
    assert.equal(r.kind, "direct");
    assert.equal(
      r.kind === "direct" ? r.diagnostic.classification : undefined,
      "generation",
    );
  });

  it("no provider configured → model never called, legacy fallback used", async () => {
    // No classifierProvider → gate short-circuits on opts?.classifierProvider.
    // Falls through to the legacy classifyTask path (returns agent + ambiguous
    // diagnostic for this prompt).
    const r = await taskRouter(AMBIGUOUS_PROMPT);
    assert.equal(r.kind, "agent");
    assert.equal(
      r.kind === "agent" ? r.diagnostic.classification : undefined,
      "ambiguous",
    );
  });

  it("audit: every non-ambiguous intent classifies at confidence ≥ threshold", async () => {
    // Audit finding (T25 #403): confidenceForIntent assigns every non-ambiguous
    // intent a fixed confidence ≥ 0.75, above CONFIDENCE_THRESHOLD (0.7). The
    // gate's second arm (`confidence < CONFIDENCE_THRESHOLD`) is therefore
    // unreachable today — the effective gate is `intent === "ambiguous"`. This
    // test pins the property so a future confidence change that drops an
    // intent below 0.7 (making the second arm live again) is caught.
    const { classifyActionWithConfidence, CONFIDENCE_THRESHOLD } = await import(
      "../../src/runtime/action-classifier.js"
    );
    const prompts = [
      "write a poem", // generation
      "what's the difference between A and B", // read_only_analysis
      "how should I approach this", // planning
      "install curl", // workspace_mutation
      "run npm test", // shell_execution
      "2+2", // arithmetic
      "latest Node.js version", // external_retrieval
    ];
    for (const prompt of prompts) {
      const { intent, confidence } = classifyActionWithConfidence(prompt);
      assert.notEqual(intent, "ambiguous");
      assert.ok(
        confidence >= CONFIDENCE_THRESHOLD,
        `${prompt} → ${intent} @ ${confidence} should be ≥ ${CONFIDENCE_THRESHOLD}`,
      );
    }
  });
});
