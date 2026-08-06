/**
 * T13 (#384) — agent_loop_mode recognition contract
 *
 * Mirrors the structure of `tests/runtime/action-classifier.test.ts` but
 * covers the orthogonal Layer-4 sub-recognizers that compose
 * `IntentClassifier.classify` (research / mutation / validation).
 *
 * This test file is the canonical recognition contract for
 * `agent_loop_mode` (see `docs/intent-contracts/agent-loop-mode.md`).
 * Pinning these tests here lets the agent loop at `task-loop.ts:315`
 * graduate to a deterministic finite-state recognizer without breaking
 * the routing chain.
 *
 * NOTE: agent_loop_mode is NOT part of the routing chain. It is the
 * sticky `AgentIntent` emitted inside the agent loop based on observed
 * tool calls. See `docs/intent-contracts/canonical-taxonomy.md` for the
 * ownership matrix.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IntentClassifier,
  type AgentIntent,
} from "../../src/run/intent-classifier.js";

// Minimal tool-call shape used by the recognizer.
const tc = (name: string, args: Record<string, unknown> = {}) =>
  ({ name, args }) as { name: string; args: Record<string, unknown> };

// ─────────────────────────────────────────────────────────────────────────
// Positive corpus: research
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — research sub-recognizer (positive corpus)", () => {
  const classifier = new IntentClassifier();

  it("classifies a single file.read as research", () => {
    assert.equal(classifier.classify([tc("file.read")]), "research");
  });

  it("classifies a pure web_search-only sequence as research", () => {
    assert.equal(
      classifier.classify([tc("web_search"), tc("web_search")]),
      "research",
    );
  });

  it("classifies a mixed read-only sequence (file.read + grep + glob) as research", () => {
    assert.equal(
      classifier.classify([
        tc("file.read"),
        tc("grep"),
        tc("glob"),
        tc("list_files"),
      ]),
      "research",
    );
  });

  it("classifies an unknown tool as research (default exploration)", () => {
    assert.equal(classifier.classify([tc("some_new_tool_we_dont_know")]), "research");
  });

  it("classifies empty tool sequence as research (carry-over default)", () => {
    assert.equal(classifier.classify([]), "research");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Positive corpus: mutation
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — mutation sub-recognizer (positive corpus)", () => {
  const classifier = new IntentClassifier();

  it("classifies a single file.edit as mutation", () => {
    assert.equal(classifier.classify([tc("file.edit")]), "mutation");
  });

  it("classifies a file.write + file.create sequence as mutation", () => {
    assert.equal(
      classifier.classify([tc("file.write"), tc("file.create")]),
      "mutation",
    );
  });

  it("classifies shell.run with build/install/compile verbs as mutation", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "npm install" })]),
      "mutation",
    );
    assert.equal(
      classifier.classify([tc("shell.run", { command: "npm run build" })]),
      "mutation",
    );
    assert.equal(
      classifier.classify([tc("shell.run", { command: "go build ./..." })]),
      "mutation",
    );
  });

  it("classifies shell.run with unknown command as mutation (safe default)", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "ls -la" })]),
      "mutation",
    );
  });

  it("classifies file.delete + file.rename as mutation", () => {
    assert.equal(
      classifier.classify([tc("file.delete"), tc("file.rename")]),
      "mutation",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Positive corpus: validation
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — validation sub-recognizer (positive corpus)", () => {
  const classifier = new IntentClassifier();

  it("classifies shell.run with `test` verb as validation", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "pnpm test" })]),
      "validation",
    );
  });

  it("classifies shell.run with `lint` verb as validation", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "pnpm lint" })]),
      "validation",
    );
  });

  it("classifies shell.run with `typecheck` verb as validation", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "tsc --noEmit" })]),
      "validation",
    );
  });

  it("classifies shell.run with `vitest` / `jest` / `pytest` as validation", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "vitest run" })]),
      "validation",
    );
    assert.equal(
      classifier.classify([tc("shell.run", { command: "jest --ci" })]),
      "validation",
    );
    assert.equal(
      classifier.classify([tc("shell.run", { command: "pytest -q" })]),
      "validation",
    );
  });

  it("classifies shell.run with `verify` / `check` verb as validation", () => {
    assert.equal(
      classifier.classify([tc("shell.run", { command: "alix verify" })]),
      "validation",
    );
    assert.equal(
      classifier.classify([tc("shell.run", { command: "check ./dist" })]),
      "validation",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Negative corpus: sequence whose tools do not match any sub-recognizer
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — negative corpus (default to research)", () => {
  const classifier = new IntentClassifier();

  it("classifies a wholly unknown tool list as research", () => {
    assert.equal(
      classifier.classify([tc("mystery_tool"), tc("another_unknown")]),
      "research",
    );
  });

  it("classifies an empty sequence (no observed tools) as research", () => {
    assert.equal(classifier.classify([]), "research");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ambiguous corpus: mixed research + mutation → mutation wins
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — ambiguous corpus (tie-breaking policy)", () => {
  const classifier = new IntentClassifier();

  it("research + mutation in the same iteration → mutation wins (actionable)", () => {
    assert.equal(
      classifier.classify([tc("file.read"), tc("file.edit")]),
      "mutation",
    );
  });

  it("research + multiple mutations → mutation wins", () => {
    assert.equal(
      classifier.classify([
        tc("web_search"),
        tc("file.read"),
        tc("file.edit"),
        tc("file.write"),
      ]),
      "mutation",
    );
  });

  it("validation beats research when both appear in the same iteration", () => {
    assert.equal(
      classifier.classify([
        tc("file.read"),
        tc("shell.run", { command: "pnpm test" }),
      ]),
      "validation",
    );
  });

  it("validation beats mutation when both appear in the same iteration", () => {
    assert.equal(
      classifier.classify([
        tc("file.edit"),
        tc("shell.run", { command: "pnpm test" }),
      ]),
      "validation",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky semantic: once emitted, the AgentIntent does not flip-flop.
// Implementation uses an explicit streak counter (see `update`).
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — sticky semantic (update method)", () => {
  const classifier = new IntentClassifier();

  it("keeps current intent when observed equals current (streak resets)", () => {
    const r1 = classifier.update("research", "research", 5);
    assert.deepEqual(r1, { next: "research", streak: 0 });
  });

  it("holds current intent for the first contradictory iteration (streak = 1)", () => {
    const r = classifier.update("research", "mutation", 0);
    assert.deepEqual(r, { next: "research", streak: 1 });
  });

  it("flips to observed intent after ≥2 consecutive contradictions", () => {
    const r1 = classifier.update("research", "mutation", 0);
    assert.deepEqual(r1, { next: "research", streak: 1 });
    const r2 = classifier.update("research", "mutation", r1.streak);
    assert.deepEqual(r2, { next: "mutation", streak: 0 });
  });

  it("resets streak if the contradiction pattern breaks", () => {
    const r1 = classifier.update("research", "mutation", 0);
    assert.equal(r1.streak, 1);
    // Model goes back to research — streak resets, no flip
    const r2 = classifier.update("research", "research", r1.streak);
    assert.deepEqual(r2, { next: "research", streak: 0 });
  });

  it("streak of 1 carries across iterations even if observed is the same in a later call", () => {
    // First iteration: observed mutation, holds at research with streak 1
    const r1 = classifier.update("research", "mutation", 0);
    assert.deepEqual(r1, { next: "research", streak: 1 });
    // Second iteration: observed mutation again → flips
    const r2 = classifier.update("research", "mutation", r1.streak);
    assert.deepEqual(r2, { next: "mutation", streak: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky classification flow: the canonical end-to-end pattern used by
// `task-loop.ts:315`. The runtime classifies observed tool calls each
// iteration, then applies `update` to merge observed → current sticky.
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — sticky classification flow (end-to-end)", () => {
  const classifier = new IntentClassifier();

  it("emits research, then remains research across subsequent research-only iterations", () => {
    let current: AgentIntent = "research";
    let streak = 0;

    const researchTools = [
      tc("file.read"),
      tc("grep"),
      tc("web_search"),
    ];

    for (let i = 0; i < 3; i++) {
      const observed = classifier.classify(researchTools, current);
      const { next, streak: newStreak } = classifier.update(current, observed, streak);
      current = next;
      streak = newStreak;
    }

    assert.equal(current, "research");
  });

  it("flips from research to mutation only after two consecutive mutation-heavy iterations", () => {
    let current: AgentIntent = "research";
    let streak = 0;

    const mutationTools = [tc("file.edit"), tc("file.write")];

    // Iteration 1: first mutation observed — still research, streak = 1
    let observed = classifier.classify(mutationTools, current);
    let r = classifier.update(current, observed, streak);
    current = r.next;
    streak = r.streak;
    assert.equal(current, "research");
    assert.equal(streak, 1);

    // Iteration 2: second mutation observed — flips to mutation
    observed = classifier.classify(mutationTools, current);
    r = classifier.update(current, observed, streak);
    current = r.next;
    streak = r.streak;
    assert.equal(current, "mutation");
    assert.equal(streak, 0);
  });

  it("does not flip when a single mutation iteration is followed by a research iteration", () => {
    let current: AgentIntent = "research";
    let streak = 0;

    // Iteration 1: mutation observed
    let observed = classifier.classify([tc("file.edit")], current);
    let r = classifier.update(current, observed, streak);
    current = r.next;
    streak = r.streak;
    assert.equal(current, "research");

    // Iteration 2: research observed — streak resets, no flip
    observed = classifier.classify([tc("file.read")], current);
    r = classifier.update(current, observed, streak);
    current = r.next;
    streak = r.streak;
    assert.equal(current, "research");
    assert.equal(streak, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Determinism: same input → same output, every time.
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — determinism", () => {
  const classifier = new IntentClassifier();

  it("classify is a pure function of its inputs", () => {
    const tools = [tc("file.read"), tc("file.edit"), tc("file.read")];
    const a = classifier.classify(tools);
    const b = classifier.classify(tools);
    const c = classifier.classify(tools);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("update is a pure function of its inputs", () => {
    const a = classifier.update("research", "mutation", 0);
    const b = classifier.update("research", "mutation", 0);
    assert.deepEqual(a, b);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Orthogonality: classify must NOT consult the user prompt. It only sees
// observed tool calls. This confirms the contract: agent_loop_mode is a
// post-tool-observation mechanism, not a routing-chain consumer of
// CanonicalIntent. (See `docs/intent-contracts/canonical-taxonomy.md`.)
// ─────────────────────────────────────────────────────────────────────────
describe("IntentClassifier — orthogonality (no prompt dependency)", () => {
  const classifier = new IntentClassifier();

  it("does not accept a prompt parameter", () => {
    // The classify signature accepts only toolCalls + optional currentIntent.
    // Asserting that the function exists with the documented shape is the
    // closest mechanical pin we can write in TypeScript.
    assert.equal(typeof classifier.classify, "function");
    assert.equal(classifier.classify.length, 2);
  });

  it("returns the same intent for the same tool sequence regardless of any other ambient state", () => {
    const tools = [tc("file.read"), tc("grep")];
    const a = classifier.classify(tools, "research");
    const b = classifier.classify(tools, "mutation");
    const c = classifier.classify(tools);
    assert.equal(a, "research");
    // `currentIntent` does not influence the observed classification
    // (it is only consumed by `update` to drive the sticky FSM).
    assert.equal(b, "research");
    assert.equal(c, "research");
  });
});
