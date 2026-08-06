// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Tests for src/runtime/action-classifier.ts.
 *
 * The action classifier is a deterministic, side-effect-free helper that
 * decides whether an incoming prompt should be answered directly
 * (arithmetic or standalone generation), routed to a workspace agent,
 * routed to external retrieval, or flagged as ambiguous.
 *
 * These tests are written against the public contract defined in the
 * Task 1 brief and assert both the routing decisions and the precedence
 * rules described there.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyAction,
  classifyActionWithConfidence,
  CONFIDENCE_THRESHOLD,
  evaluateArithmetic,
  type ActionClassification,
} from "../../src/runtime/action-classifier.js";
import { taskRouter } from "../../src/runtime/task-router.js";

// ── Pure arithmetic parsing ─────────────────────────────────────────

describe("evaluateArithmetic", () => {
  it("returns the integer sum for '2 + 2'", () => {
    assert.equal(evaluateArithmetic("2 + 2"), 4);
  });

  it("respects parentheses and operator precedence: '(10 * 4) / 5' = 8", () => {
    assert.equal(evaluateArithmetic("(10 * 4) / 5"), 8);
  });

  it("handles exponentiation with '^'", () => {
    assert.equal(evaluateArithmetic("2 ^ 10"), 1024);
  });

  it("handles unary minus", () => {
    assert.equal(evaluateArithmetic("-3 + 5"), 2);
  });

  it("handles modulo '%'", () => {
    assert.equal(evaluateArithmetic("10 % 3"), 1);
  });

  it("rejects divide-by-zero by returning null", () => {
    assert.equal(evaluateArithmetic("5 / 0"), null);
  });

  it("rejects variables and identifiers", () => {
    assert.equal(evaluateArithmetic("x + 2"), null);
    assert.equal(evaluateArithmetic("foo"), null);
    assert.equal(evaluateArithmetic("2 + apples"), null);
  });

  it("rejects malformed syntax", () => {
    assert.equal(evaluateArithmetic("2 +"), null);
    assert.equal(evaluateArithmetic("((2 + 3)"), null);
    assert.equal(evaluateArithmetic(""), null);
  });

  it("rejects non-finite results", () => {
    assert.equal(evaluateArithmetic("1 / 0"), null);
    // Large but finite inputs should still produce a finite result.
    assert.equal(evaluateArithmetic("10 ^ 5"), 100000);
  });
});

// ── Classification: arithmetic ───────────────────────────────────────

describe("classifyAction — arithmetic precedence", () => {
  it("routes a pure arithmetic expression to arithmetic with a stringified answer", () => {
    const result = classifyAction("2 + 2");
    assert.equal(result.intent, "arithmetic");
    assert.equal(result.arithmeticAnswer, "4");
    assert.match(result.reason, /arithmetic/i);
  });

  it("routes a parenthesized arithmetic expression to arithmetic", () => {
    const result = classifyAction("(10 * 4) / 5");
    assert.equal(result.intent, "arithmetic");
    assert.equal(result.arithmeticAnswer, "8");
  });

  it("treats malformed arithmetic as not-arithmetic (ambiguous or other)", () => {
    const result = classifyAction("2 + apples");
    assert.notEqual(result.intent, "arithmetic");
    assert.equal(result.arithmeticAnswer, undefined);
  });
});

// ── Classification: workspace dominates retrieval ────────────────────

describe("classifyAction — workspace/action dominance", () => {
  it("routes a repo-scoped search to workspace_action (not external_retrieval)", () => {
    const result = classifyAction("Search my repo for Kubernetes vulnerabilities");
    assert.equal(result.intent, "workspace_action");
    assert.match(result.reason, /workspace|repo/i);
  });

  it("routes 'Add Fibonacci implementation to my repo' to workspace_action", () => {
    const result = classifyAction("Add Fibonacci implementation to my repo");
    assert.equal(result.intent, "workspace_action");
  });

  it("routes a function-usage search inside the repo to workspace_action", () => {
    const result = classifyAction("Find all usages of this function");
    assert.equal(result.intent, "workspace_action");
  });

  it("does not classify a clearly workspace-anchored prompt as external_retrieval", () => {
    const result = classifyAction("Search my repo for current Kubernetes vulnerabilities");
    assert.equal(result.intent, "workspace_action");
  });
});

// ── Classification: external retrieval ───────────────────────────────

describe("classifyAction — external retrieval", () => {
  it("routes a web/news-style search to external_retrieval when there is no workspace anchor", () => {
    const result = classifyAction("Search latest Kubernetes vulnerabilities");
    assert.equal(result.intent, "external_retrieval");
  });

  it("routes 'Search the web for current Kubernetes vulnerabilities' to external_retrieval", () => {
    const result = classifyAction("Search the web for current Kubernetes vulnerabilities");
    assert.equal(result.intent, "external_retrieval");
  });
});

// ── Classification: standalone generation ────────────────────────────

describe("classifyAction — standalone generation", () => {
  it("routes a 'write code in language X' prompt (no workspace anchor) to standalone_generation", () => {
    const result = classifyAction("Write Fibonacci function in Python");
    assert.equal(result.intent, "standalone_generation");
  });

  it("does NOT route 'Add ... to my repo' to standalone_generation", () => {
    const result = classifyAction("Add Fibonacci implementation to my repo");
    assert.notEqual(result.intent, "standalone_generation");
  });
});

// ── Classification: shell-state probes (bug-fix regression + contract) ──
//
// Bug history: "is llama.cpp installed" was returning `ambiguous` so the
// model fallback could label it `standalone_generation`, routing the prompt
// through the `direct` executor — a one-line system prompt with no tool
// manifest. The model then answered "I don't have direct access to your
// system" instead of running `alix_shell_run`. Shell-state probes must
// always classify as `workspace_action` so the route always reaches the
// full agent loop with tool access.
//
// This block is also the **workspace-state recognition contract** for
// the runtime/action-classifier (positive + negative + ambiguous + no-overlap
// corpora). The full contract lives at docs/intent-contracts/workspace-state.md.

describe("classifyAction — workspace-state recognition contract", () => {
  describe("positive corpus (must classify workspace_action)", () => {
    it("routes 'is X installed' to workspace_action (not ambiguous)", () => {
      const result = classifyAction("is llama.cpp installed");
      assert.equal(result.intent, "workspace_action");
    });

    it("routes 'is curl installed' to workspace_action", () => {
      const result = classifyAction("is curl installed");
      assert.equal(result.intent, "workspace_action");
    });

    it("routes 'is git installed on this machine' to workspace_action", () => {
      const result = classifyAction("is git installed on this machine");
      assert.equal(result.intent, "workspace_action");
    });

    it("routes 'do I have docker' to workspace_action", () => {
      const result = classifyAction("do I have docker");
      assert.equal(result.intent, "workspace_action");
    });

    it("routes 'what is running on port 3000' to workspace_action", () => {
      const result = classifyAction("what is running on port 3000");
      assert.equal(result.intent, "workspace_action");
    });

    it("routes 'check if postgres is running' to workspace_action", () => {
      const result = classifyAction("check if postgres is running");
      assert.equal(result.intent, "workspace_action");
    });

    it("confidence ≥ 0.7 (gates the model fallback from being called)", () => {
      const result = classifyActionWithConfidence("is curl installed");
      assert.ok(
        (result.confidence ?? 0) >= 0.7,
        `confidence ${result.confidence} below Layer-1 floor`,
      );
    });
  });

  describe("negative corpus (must NOT classify workspace_action)", () => {
    it("rejects 'write installation instructions' (generation)", () => {
      const result = classifyAction("write installation instructions");
      assert.notEqual(result.intent, "workspace_action");
    });

    it("rejects 'document how to install curl' (generation/docs)", () => {
      const result = classifyAction("document how to install curl");
      assert.notEqual(result.intent, "workspace_action");
    });

    it("rejects 'compare installers' (read-only comparison)", () => {
      const result = classifyAction("compare installers");
      assert.notEqual(result.intent, "workspace_action");
    });

    it("rejects 'explain the install process' (read-only-analysis)", () => {
      const result = classifyAction("explain the install process");
      assert.notEqual(result.intent, "workspace_action");
    });

    it("rejects 'should I install curl' (planning/decision)", () => {
      const result = classifyAction("should I install curl");
      assert.notEqual(result.intent, "workspace_action");
    });
  });

  describe("ambiguous corpus (mixed intent; documented policy)", () => {
    it(
      "compound 'if curl isn't installed, install it' falls to ambiguous " +
      "rather than workspace_state — the mutation half stays for layered dispatch",
      () => {
        const result = classifyAction("if curl isn't installed, install it");
        // Policy: when state AND mutation appear together, defer to Layer 2
        // (model fallback) so the chain CanonicalIntent → ExecutionRoute can
        // see both halves. workspace_state alone would lose the mutation.
        assert.notEqual(result.intent, "workspace_action");
      },
    );

    it(
      "probe-with-decision 'is curl installed or do I need to install it' " +
      "classifies workspace_action (primary signal is the probe; the decision " +
      "half is conditional and does not override)",
      () => {
        const result = classifyAction(
          "is curl installed or do I need to install it",
        );
        assert.equal(result.intent, "workspace_action");
      },
    );
  });

  describe("no-overlap with adjacent intent families", () => {
    it("does not steal shell-execution ('ls', 'cat package.json', 'npm test')", () => {
      assert.notEqual(classifyAction("ls").intent, "workspace_action");
      assert.notEqual(classifyAction("cat package.json").intent, "workspace_action");
      assert.notEqual(classifyAction("npm test").intent, "workspace_action");
    });

    it("does not steal workspace-mutation ('install curl', 'create a file')", () => {
      assert.notEqual(classifyAction("install curl").intent, "workspace_action");
      assert.notEqual(
        classifyAction("create a file called notes.md").intent,
        "workspace_action",
      );
      assert.notEqual(
        classifyAction("rename foo.ts to bar.ts").intent,
        "workspace_action",
      );
    });

    it("does not steal generation ('write a script that checks if curl is installed')", () => {
      assert.notEqual(
        classifyAction("write a script that checks if curl is installed")
          .intent,
        "workspace_action",
      );
    });
  });
});

// ── Classification: workspace-mutation recognition contract (T8 #388) ─────────
//
// T8 — workspace_mutation recognition contract.
// A user prompt belongs to the `workspace_mutation` family when it asks the
// runtime to change the local filesystem (create, edit, delete, rename,
// install, etc.) — distinct from `workspace_action` (state, read-only probes)
// and `shell_execution` (run a command, observe output).
//
// Trigger precedence: `workspace_action` fires BEFORE `workspace_mutation`
// so that probes with conditional mutation ("is curl installed or do I need
// to install it") classify as state — preserves T1's documented
// ambiguous-corpus policy.
//
// Reconcile: the legacy `hasWorkspaceWriteIntent` carve-out at
// task-router.ts:475-477 is now deleted. MUTATION_ANCHORS in
// src/runtime/action-classifier.ts is a strict superset of that carve-out
// and surfaces the intent at Layer 1.
//
// The full contract lives at docs/intent-contracts/workspace-mutation.md.

describe("classifyAction — workspace-mutation recognition contract", () => {
  describe("positive corpus (must classify workspace_mutation)", () => {
    it("routes 'create foo.ts' to workspace_mutation", () => {
      const result = classifyAction("create foo.ts");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'create a file called notes.md' to workspace_mutation", () => {
      const result = classifyAction("create a file called notes.md");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'rename foo.ts to bar.ts' to workspace_mutation", () => {
      const result = classifyAction("rename foo.ts to bar.ts");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'delete foo.txt' to workspace_mutation", () => {
      const result = classifyAction("delete foo.txt");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'remove the cache from npm' to workspace_mutation", () => {
      const result = classifyAction("remove the cache from npm");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'install curl' to workspace_mutation", () => {
      const result = classifyAction("install curl");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'edit config.ts' to workspace_mutation", () => {
      const result = classifyAction("edit config.ts");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'update README.md' to workspace_mutation", () => {
      const result = classifyAction("update README.md");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'save changes' to workspace_mutation", () => {
      const result = classifyAction("save changes");
      assert.equal(result.intent, "workspace_mutation");
    });
    it("routes 'mkdir foo' to workspace_mutation", () => {
      const result = classifyAction("mkdir foo");
      assert.equal(result.intent, "workspace_mutation");
    });
  });

  describe("negative corpus (must NOT classify workspace_mutation)", () => {
    it("rejects 'is curl installed' (workspace-state)", () => {
      const result = classifyAction("is curl installed");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("rejects 'do I have docker' (workspace-state)", () => {
      const result = classifyAction("do I have docker");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("rejects 'what is running on port 3000' (workspace-state)", () => {
      const result = classifyAction("what is running on port 3000");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("rejects 'write a poem about X' (generation)", () => {
      const result = classifyAction("write a poem about X");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("rejects 'should I use X or Y' (planning)", () => {
      const result = classifyAction("should I use X or Y");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("rejects 'explain the install process' (read-only-analysis)", () => {
      const result = classifyAction("explain the install process");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("rejects 'ls' (shell-execution)", () => {
      const result = classifyAction("ls");
      assert.notEqual(result.intent, "workspace_mutation");
    });
  });

  describe("ambiguous corpus (mixed-intent routing policy)", () => {
    it("routes 'is curl installed or do I need to install it' to workspace_action (state wins)", () => {
      // T1 contract: state wins when both state and mutation patterns
      // match. The state probe is the primary action; the mutation
      // clause is conditional. Mutation does NOT override.
      const result = classifyAction("is curl installed or do I need to install it");
      assert.equal(result.intent, "workspace_action");
    });
    it("routes 'if curl isn't installed, install it' to ambiguous (mixed state+mutation)", () => {
      // The state pattern requires "is X installed" exact form;
      // "isn't installed" doesn't match. MUTATION_ANCHORS requires
      // the verb at the START of the prompt; mid-prompt "install it"
      // does not match. Result: ambiguous (Layer 2 fallback).
      // Per T1's documented policy, mixed prompts defer to Layer 2
      // so the chain can see both halves.
      const result = classifyAction("if curl isn't installed, install it");
      assert.equal(result.intent, "ambiguous");
    });
  });

  describe("no-overlap with adjacent intent families", () => {
    it("workspace-state: 'is curl installed' classifies as workspace_action, not workspace_mutation", () => {
      const result = classifyAction("is curl installed");
      assert.equal(result.intent, "workspace_action");
    });
    it("shell-execution: 'ls' classifies as ambiguous, not workspace_mutation", () => {
      const result = classifyAction("ls");
      assert.notEqual(result.intent, "workspace_mutation");
    });
    it("generation: 'write a poem' classifies as standalone_generation, not workspace_mutation", () => {
      const result = classifyAction("write a poem about X");
      assert.equal(result.intent, "standalone_generation");
    });
  });
});

// ── Classification: shell-execution (T9 #385) ────────────────────────
//
// T9 graduates shell_execution to Layer 1 (src/runtime/action-classifier.ts)
// via a SHELL_EXECUTION_ANCHORS regex family. The recognizer surfaces the
// intent deterministically so the closed-world invariant test can pin the
// (shell_execution, tool) chain at Layer 1 → Layer 3 without relying on
// isShellTask at task-classifier.ts:142.
//
// Layer 2 isShellTask stays alive as the agent loop's planning lens — it
// includes mutation commands (rm, mv, cp) that the canonical taxonomy maps
// to workspace_mutation, not shell_execution. T9 is intentionally narrower:
// read/observe shell commands where the command itself is the request.

describe("classifyAction — shell-execution recognition contract (T9 #385)", () => {
  // ── Positive corpus: must classify shell_execution ──────────────────

  const POSITIVE_CORPUS: ReadonlyArray<{ prompt: string; note: string }> = [
    // Bare commands (read/observe).
    { prompt: "ls", note: "bare ls (no args)" },
    { prompt: "pwd", note: "bare pwd" },
    { prompt: "cat package.json", note: "bare cat with arg" },
    { prompt: "cat README.md", note: "bare cat file path" },
    { prompt: "head -n 5 README.md", note: "bare head with flag arg" },
    { prompt: "tail -f logs/server.log", note: "bare tail with flag arg" },
    { prompt: "grep foo src/", note: "bare grep with arg" },
    { prompt: "find . -name '*.ts'", note: "bare find with paths/predicates" },
    { prompt: "wc -l src/foo.ts", note: "bare wc with flag arg" },
    { prompt: "sort -u file.txt", note: "bare sort with flag arg" },
    { prompt: "du -sh .", note: "bare du with flag arg" },
    { prompt: "df -h", note: "bare df with flag arg" },
    { prompt: "whoami", note: "bare whoami" },
    { prompt: "env", note: "bare env" },
    { prompt: "echo hello", note: "bare echo with arg" },
    { prompt: "curl https://example.com/api", note: "bare curl with url arg" },
    { prompt: "ping -c 1 localhost", note: "bare ping with flag arg" },
    // Dev tool subcommands that observe/check.
    { prompt: "npm test", note: "npm test" },
    { prompt: "npm run build", note: "npm run-script" },
    { prompt: "npm ls", note: "npm list subcommand" },
    { prompt: "git status", note: "git status" },
    { prompt: "git log", note: "git log" },
    { prompt: "git diff", note: "git diff" },
    { prompt: "git branch", note: "git branch" },
    // Prefixed-command forms — natural-language wrappers around a command.
    { prompt: "run npm test", note: "run + command" },
    { prompt: "execute the build", note: "execute + noun-phrase" },
    { prompt: "exec ls -la", note: "exec + command" },
    { prompt: "use bash to check disk space", note: "use bash to + verb" },
  ];

  for (const { prompt, note } of POSITIVE_CORPUS) {
    it(`classifies shell_execution: ${note} (${JSON.stringify(prompt)})`, () => {
      const result = classifyActionWithConfidence(prompt);
      assert.equal(result.intent, "shell_execution");
      assert.ok(
        result.confidence >= CONFIDENCE_THRESHOLD,
        `confidence ${result.confidence} below Layer-1 floor ${CONFIDENCE_THRESHOLD}`,
      );
    });
  }

  // ── Negative corpus: must NOT classify shell_execution ──────────────

  describe("negative corpus", () => {
    const NEGATIVE_CASES: ReadonlyArray<{ prompt: string; because: string }> = [
      { prompt: "is curl installed", because: "workspace_state probe (shell-state)" },
      { prompt: "what's running on port 3000", because: "workspace_state probe (T7)" },
      { prompt: "create foo.ts", because: "workspace_mutation (T8)" },
      { prompt: "remove cache npm", because: "workspace_mutation legacy carve-out" },
      { prompt: "rename foo.ts to bar.ts", because: "workspace_mutation file target" },
      { prompt: "install curl", because: "workspace_mutation (download/extract, not shell)" },
      { prompt: "compare installers", because: "read_only_analysis (T10)" },
      { prompt: "explain install process", because: "read_only_analysis (T10)" },
      { prompt: "should I install curl", because: "planning decision question (T11)" },
      { prompt: "write installation instructions", because: "generation (T12)" },
      { prompt: "2 + 2", because: "pure arithmetic dominates" },
      { prompt: "what's in package.json", because: "natural-language state, not bare command" },
      { prompt: "list of bugs in the repo", because: "natural-language phrasing, not a shell command" },
    ];

    for (const { prompt, because } of NEGATIVE_CASES) {
      it(`does not classify shell_execution: ${JSON.stringify(prompt)} (${because})`, () => {
        const result = classifyAction(prompt);
        assert.notEqual(
          result.intent,
          "shell_execution",
          `prompt should not be shell_execution because: ${because}`,
        );
      });
    }
  });

  // ── Trigger precedence: shell_execution sits between workspace and retrieval ──

  describe("trigger precedence", () => {
    it("workspace anchors win over shell command form ('run ls on my repo')", () => {
      // Even though 'ls' is in the prompt, 'my repo' anchors it to a
      // workspace action. workspace_action dominates shell_execution:
      // the routing is the agent loop, which then dispatches shells
      // internally; surfacing shell_execution would lose the workspace
      // anchor.
      const result = classifyAction("run ls on my repo");
      assert.equal(result.intent, "workspace_action");
    });

    it("arithmetic dominates shell_execution for numeric expressions ('2 + 2')", () => {
      const result = classifyAction("2 + 2");
      assert.equal(result.intent, "arithmetic");
    });
  });

  // ── No-overlap verification with adjacent intent families ───────────

  describe("no-overlap with adjacent intent families", () => {
    it("does not steal workspace_state ('is X installed', 'what's running')", () => {
      assert.notEqual(classifyAction("is curl installed").intent, "shell_execution");
      assert.notEqual(classifyAction("what's running on port 3000").intent, "shell_execution");
    });

    it("does not steal workspace_mutation ('create foo.ts', 'install curl')", () => {
      assert.notEqual(classifyAction("create foo.ts").intent, "shell_execution");
      assert.notEqual(classifyAction("install curl").intent, "shell_execution");
      assert.notEqual(classifyAction("rm foo.txt").intent, "shell_execution");
    });

    it("does not steal read_only_analysis ('compare installers', 'explain X')", () => {
      assert.notEqual(classifyAction("compare installers").intent, "shell_execution");
      assert.notEqual(classifyAction("explain install process").intent, "shell_execution");
    });

    it("does not steal planning ('should I install curl')", () => {
      assert.notEqual(classifyAction("should I install curl").intent, "shell_execution");
    });

    it("does not steal generation ('write installation instructions')", () => {
      assert.notEqual(
        classifyAction("write installation instructions").intent,
        "shell_execution",
      );
    });

    it("does not steal arithmetic ('2 + 2')", () => {
      assert.notEqual(classifyAction("2 + 2").intent, "shell_execution");
    });
  });

  // ── Closed-world: shell_execution routes to tool.shell.run via taskRouter ──

  describe("routing — shell_execution resolves to kind:'tool' at taskRouter", () => {
    const ROUTING_CASES: ReadonlyArray<{ prompt: string }> = [
      { prompt: "ls" },
      { prompt: "cat package.json" },
      { prompt: "npm test" },
      { prompt: "git status" },
    ];

    for (const { prompt } of ROUTING_CASES) {
      it(`taskRouter(${JSON.stringify(prompt)}) resolves to kind:'tool' (Layer-3 isShellTask carve-out)`, async () => {
        const route = await taskRouter(prompt);
        assert.equal(route.kind, "tool");
        if (route.kind === "tool") {
          assert.equal(route.tool, "shell.run");
        }
      });
    }
  });
});

// ── Classification: ambiguous ────────────────────────────────────────

describe("classifyAction — ambiguous / defaults", () => {
  it("returns ambiguous for an empty prompt", () => {
    const result = classifyAction("");
    assert.equal(result.intent, "ambiguous");
  });

  it("returns ambiguous for whitespace-only input", () => {
    const result = classifyAction("   \n\t  ");
    assert.equal(result.intent, "ambiguous");
  });

  it("returns ambiguous for plain prose with no signals", () => {
    const result = classifyAction("tell me something nice");
    assert.equal(result.intent, "ambiguous");
  });
});

// ── Canonical-intent chain — closed-world invariant ──────────────────

// These tests pin the canonical-intent chain invariant documented in
// docs/intent-contracts/canonical-taxonomy.md. Each test asserts:
//   - Layer 1 emits the expected ActionIntent (no model fallback)
//   - Layer 3 taskRouter returns the expected TaskRoute.kind
//   - The (intent, kind) pair matches the ownership matrix in that doc
//
// No model provider is supplied to taskRouter, so the chain stays
// deterministic. This is the mechanical pin for the no-reclassification
// rule: any site that re-derives intent from raw prompt text would break
// one of these tests if the route diverged from the canonical intent.

const CANONICAL_CASES: ReadonlyArray<{
  intent: "arithmetic" | "standalone_generation" | "workspace_action" |
          "workspace_mutation" | "external_retrieval" | "shell_execution" |
          "ambiguous";
  kind: "direct" | "tool" | "chat" | "grounded_chat" | "agent";
  prompt: string;
  note: string;
}> = [
  // arithmetic → direct with numeric answer
  {
    intent: "arithmetic",
    kind: "direct",
    prompt: "2 + 2",
    note: "canonical: arithmetic",
  },
  // generation → direct (single model call)
  {
    intent: "standalone_generation",
    kind: "direct",
    prompt: "Write a Fibonacci function in Python that returns the sequence",
    note: "canonical: generation (GENERATION_SIGNALS 'in Python' hit)",
  },
  // external_retrieval → grounded_chat
  {
    intent: "external_retrieval",
    kind: "grounded_chat",
    prompt: "latest Kubernetes release version",
    note: "canonical: external_retrieval (latest keyword)",
  },
  // workspace_state (workspace_action) → agent
  {
    intent: "workspace_action",
    kind: "agent",
    prompt: "is curl installed on this machine",
    note: "canonical: workspace_state (WORKSPACE_ANCHORS hit)",
  },
  // workspace_mutation → agent (T8 graduated from ambiguous via the
  // legacy hasWorkspaceWriteIntent carve-out; the carve-out is now
  // deleted and MUTATION_ANCHORS in action-classifier.ts surfaces
  // this at Layer 1).
  {
    intent: "workspace_mutation",
    kind: "agent",
    prompt: "remove the cache from npm",
    note: "canonical: workspace_mutation (MUTATION_ANCHORS hit — T8)",
  },
  // shell_execution → tool via SHELL_EXECUTION_ANCHORS (T9 graduated
  // from ambiguous → shell_execution at Layer 1; the Layer-3 dispatch
  // at task-router.ts:378 still routes to kind: "tool" via the
  // isShellTask carve-out).
  {
    intent: "shell_execution",
    kind: "tool",
    prompt: "ls",
    note: "canonical: shell_execution (SHELL_EXECUTION_ANCHORS hit — T9)",
  },
  // shell_execution via natural-language phrase — Layer 1 emits
  // `ambiguous` (no SHELL_EXECUTION_ANCHORS match); Layer 3 routes
  // to kind: "tool" via NATURAL_SHELL_MAP. This is the documented
  // gap between Layer 1 (deterministic regex) and Layer 3 (heuristic
  // dispatch) — the natural-language shell idiom is captured at
  // Layer 3, not Layer 1, because the bare regex family is `^`-anchored.
  {
    intent: "ambiguous",
    kind: "tool",
    prompt: "list files",
    note: "canonical: shell_execution (NATURAL_SHELL_MAP at Layer 3 — T9)",
  },
  // read_only_analysis → chat via legacy fallback classifyTask research
  // (line 485 — Layer 2 read in routing fallback; documented in
  // canonical-taxonomy.md Finding 3)
  {
    intent: "ambiguous",
    kind: "chat",
    prompt: "what is dependency injection",
    note: "canonical: read_only_analysis (legacy fallback → chat)",
  },
];

describe("canonical-intent chain — closed-world invariant", () => {
  for (const c of CANONICAL_CASES) {
    it(`${c.note}: classifyAction(${JSON.stringify(c.prompt)}) → ${c.intent}`, () => {
      const result = classifyActionWithConfidence(c.prompt);
      assert.equal(result.intent, c.intent);
    });

    it(`${c.note}: taskRouter(${JSON.stringify(c.prompt)}) → kind:"${c.kind}"`, async () => {
      const route = await taskRouter(c.prompt);
      assert.equal(route.kind, c.kind);
    });
  }

  // No-reclassification invariant: two prompts with different
  // canonical intents produce structurally different routes. This is
  // the mechanical pin for the chain — any site that re-derives
  // intent from raw prompt text would break this.
  it("two prompts with different canonical intents route differently", async () => {
    const arithmeticRoute = await taskRouter("2 + 2");
    const retrievalRoute = await taskRouter("latest Kubernetes release version");
    assert.equal(arithmeticRoute.kind, "direct");
    assert.equal(retrievalRoute.kind, "grounded_chat");
    assert.notEqual(arithmeticRoute.kind, retrievalRoute.kind);
  });

  // Determinism invariant: taskRouter is deterministic when no provider
  // is supplied. Same input → same route, repeatedly.
  it("taskRouter is deterministic without a classifierProvider", async () => {
    const a = await taskRouter("is curl installed on this machine");
    const b = await taskRouter("is curl installed on this machine");
    assert.deepEqual(a, b);
  });

  // Chain integrity: workspace_state positive corpus routes to agent,
  // not to direct (the bug pattern from T1 — direct + one-line prompt
  // caused the "I don't have direct access to your system" refusal).
  it("workspace_state probe routes to agent, not direct", async () => {
    const route = await taskRouter("is curl installed");
    assert.equal(route.kind, "agent");
    if (route.kind === "agent") {
      // The agent route carries the prompt; direct would carry a
      // hardcoded "Answer concisely." prompt at session.ts:973.
      assert.ok("task" in route, "agent route must carry the raw task");
    }
  });
});

// ── Determinism / safety properties ──────────────────────────────────

describe("classifyAction — determinism and purity", () => {
  it("is deterministic — same input yields equal classifications", () => {
    const a = classifyAction("Add Fibonacci implementation to my repo");
    const b = classifyAction("Add Fibonacci implementation to my repo");
    assert.deepEqual(a, b);
  });

  it("never includes 'arithmeticAnswer' for non-arithmetic intents", () => {
    const inputs = [
      "Write Fibonacci function in Python",
      "Add Fibonacci implementation to my repo",
      "Search latest Kubernetes vulnerabilities",
      "tell me something nice",
      "",
    ];
    for (const input of inputs) {
      const result: ActionClassification = classifyAction(input);
      if (result.intent !== "arithmetic") {
        assert.equal(
          result.arithmeticAnswer,
          undefined,
          `unexpected arithmeticAnswer for input ${JSON.stringify(input)}`,
        );
      }
    }
  });

  it("returns a non-empty reason for every input", () => {
    const inputs = [
      "2 + 2",
      "(10 * 4) / 5",
      "Write Fibonacci function in Python",
      "Add Fibonacci implementation to my repo",
      "Find all usages of this function",
      "Search latest Kubernetes vulnerabilities",
      "Search my repo for Kubernetes vulnerabilities",
      "2 + apples",
      "",
    ];
    for (const input of inputs) {
      const result = classifyAction(input);
      assert.equal(typeof result.reason, "string");
      assert.ok(result.reason.length > 0, `empty reason for ${JSON.stringify(input)}`);
    }
  });
});
