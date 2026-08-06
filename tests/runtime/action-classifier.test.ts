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
  evaluateArithmetic,
  type ActionClassification,
} from "../../src/runtime/action-classifier.js";

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
