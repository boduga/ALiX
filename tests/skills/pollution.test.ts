import { describe, it } from "node:test";
import assert from "node:assert";
import type { SkillManifest } from "../../src/skills/types.js";
import type { SkillSnapshot } from "../../src/skills/pollution.js";
import {
  detectCatalogPollution,
  findCandidateCollisions,
  isDuplicateBody,
} from "../../src/skills/pollution.js";

function manifest(overrides: Partial<SkillManifest> & { name: string }): SkillManifest {
  return {
    description: "A skill",
    version: "1.0.0",
    is_core: false,
    ...overrides,
  };
}

function snap(
  name: string,
  desc: string,
  extra?: Partial<SkillManifest>,
  body?: string,
): SkillSnapshot {
  return { manifest: manifest({ name, description: desc, ...extra }), body };
}

describe("detectCatalogPollution", () => {
  it("flags a shared trigger as a consolidation candidate", () => {
    const skills = [
      snap("agent-loop-prevention", "Stop infinite execution loops", {
        trigger: "/prevent-loops",
        pattern: "(infinite loop|stuck in loop)",
      }),
      snap("prevent-agent-loops", "Detect and prevent agent timeouts", {
        trigger: "/prevent-loops",
        pattern: "(agent timeout|looping)",
      }),
    ];
    const findings = detectCatalogPollution(skills);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].consolidationCandidate, true);
    assert.strictEqual(findings[0].signals.sameTrigger, true);
    assert.strictEqual(findings[0].score, 1);
  });

  it("flags overlapping patterns with similar text", () => {
    const skills = [
      snap(
        "prevent-iteration-exhaustion",
        "Strategies to manage execution budgets and prevent agents from reaching maximum iteration limits",
        {
          trigger: "/prevent-loop",
          pattern: "(max(imum)? iterations|infinite loop|stuck in loop)",
        },
        "Three strikes rule. Maintain a step budget and pivot on loops.",
      ),
      snap(
        "prevent-max-iterations",
        "Strategies to prevent autonomous agents from getting stuck in loops and reaching maximum iteration limits",
        {
          trigger: "/prevent-max-iterations",
          pattern: "(max(imum)?\\s+iterations?|infinite\\s+loop|looping\\s+behavior)",
        },
        "Three strike pivot rule. Budget iterations and break out of loops.",
      ),
    ];
    const findings = detectCatalogPollution(skills);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].signals.patternOverlap, true);
    assert.strictEqual(findings[0].consolidationCandidate, true);
  });

  it("leaves distinct skills alone", () => {
    const skills = [
      snap("tdd-loop", "Red-green-refactor TDD loop", { trigger: "/tdd" }, "Follow red-green-refactor."),
      snap(
        "langfuse-traces",
        "Inspect Langfuse traces and observations from inside a session. Read-only.",
        {
          trigger: "/traces",
          pattern: "(langfuse (trace|session|observation)|look (at|up) .* trace)",
        },
        "Query the Langfuse gateway observations API.",
      ),
    ];
    assert.deepStrictEqual(detectCatalogPollution(skills), []);
  });

  it("skips same-name pairs (naming collisions are not pollution)", () => {
    const skills = [
      snap("tdd-loop", "Red-green-refactor TDD loop", { trigger: "/tdd" }),
      snap("tdd-loop", "A different TDD loop", { trigger: "/test" }),
    ];
    assert.deepStrictEqual(detectCatalogPollution(skills), []);
  });

  it("tolerates invalid regex without throwing", () => {
    const skills = [
      snap("broken", "Skill with invalid pattern", { pattern: "(unclosed" }),
      snap("other", "Unrelated skill body", { pattern: "(zzz-no-match)" }),
    ];
    assert.deepStrictEqual(detectCatalogPollution(skills), []);
  });

  it("returns [] for empty and singleton inputs", () => {
    assert.deepStrictEqual(detectCatalogPollution([]), []);
    assert.deepStrictEqual(
      detectCatalogPollution([snap("solo", "Alone", { trigger: "/solo" })]),
      [],
    );
  });

  it("sorts findings by score descending", () => {
    const skills = [
      snap("a-one", "Shared trigger skill alpha", { trigger: "/same" }),
      snap("a-two", "Shared trigger skill beta", { trigger: "/same" }),
      snap(
        "b-one",
        "Strategies to manage execution budgets and iteration limits",
        { pattern: "(iteration limit|stuck in loop)" },
        "Step budget and pivot rules for loops.",
      ),
      snap(
        "b-two",
        "Strategies to prevent agents from reaching maximum iteration limits",
        { pattern: "(maximum iteration|stuck in loop)" },
        "Step budget and break rules for loops.",
      ),
    ];
    const findings = detectCatalogPollution(skills);
    const pair = findings.find(
      (f) =>
        (f.a === "a-one" && f.b === "a-two") ||
        (f.a === "a-two" && f.b === "a-one"),
    );
    assert.ok(pair, "shared-trigger pair should be reported");
    assert.strictEqual(findings[0].a === "a-one" || findings[0].b === "a-one", true);
    assert.ok(findings[0].score >= findings[findings.length - 1].score);
  });
});

describe("isDuplicateBody", () => {
  it("flags byte-identical bodies", () => {
    assert.strictEqual(
      isDuplicateBody("Follow red-green-refactor.", "Follow red-green-refactor."),
      true,
    );
  });

  it("ignores whitespace/case/punctuation differences", () => {
    assert.strictEqual(
      isDuplicateBody("Follow  RED-green\nrefactor!", "follow red-green refactor."),
      true,
    );
  });

  it("passes genuinely revised bodies", () => {
    assert.strictEqual(
      isDuplicateBody(
        "Three strikes rule. Maintain a step budget and pivot on loops.",
        "Circuit breaker reset. Write a state summary and force a strategy pivot.",
      ),
      false,
    );
  });

  it("treats missing bodies as no evidence", () => {
    assert.strictEqual(isDuplicateBody("", "something"), false);
    assert.strictEqual(isDuplicateBody(undefined, "something"), false);
    assert.strictEqual(isDuplicateBody(undefined, undefined), false);
  });
});

describe("findCandidateCollisions", () => {
  it("blocks a candidate colliding with an installed skill", () => {
    const candidate = snap("prevent-iteration-limits", "Detect and break out of infinite iteration loops", {
      trigger: "/prevent-loops",
    });
    const installed = [
      snap("agent-loop-prevention", "Stop infinite execution loops", {
        trigger: "/prevent-loops",
      }),
    ];
    const collisions = findCandidateCollisions(candidate, installed);
    assert.strictEqual(collisions.length, 1);
    assert.ok(
      collisions[0].a === "prevent-iteration-limits" ||
        collisions[0].b === "prevent-iteration-limits",
    );
  });

  it("passes a clean candidate", () => {
    const candidate = snap("tdd-loop", "Red-green-refactor TDD loop", {
      trigger: "/tdd",
    });
    const installed = [
      snap("langfuse-traces", "Inspect Langfuse traces. Read-only.", {
        trigger: "/traces",
      }),
    ];
    assert.deepStrictEqual(findCandidateCollisions(candidate, installed), []);
  });
});
