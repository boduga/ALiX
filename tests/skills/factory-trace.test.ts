import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { stubProvider } from "../helpers/stub-provider.js";

// Isolate HOME before the factory module evaluates candidatesDir.
process.env.HOME = mkdtempSync(join(tmpdir(), "factory-trace-"));

const SKILL_MD = `---
name: mined-read
description: Read files then act
trigger: /mined-read
pattern: "(read then act)"
version: "1.0.0"
is_core: false
---
# Mined Read

Read the file first, then act on its contents. This body is long enough to pass validation comfortably and then some padding to exceed one hundred bytes.
`;

let factory: typeof import("../../src/skills/factory.js");

before(async () => {
  factory = await import("../../src/skills/factory.js");
});

const stubSkill = (text: string) => stubProvider([text]);

const config = {
  enabled: true, provider: "ollama", model: "llama3",
  maxStore: 50, maxCandidates: 200, autoPromote: false,
};

describe("runSkillFactoryFromTrace", () => {
  it("distills a tool sequence into a candidate SKILL.md", async () => {
    const sessionId = "trace-sess-1";
    await factory.runSkillFactoryFromTrace({
      sessionId,
      toolSequence: ["file.read", "shell.run"],
      traceIds: ["t1", "t2", "t3", "t4", "t5"],
      runs: 5,
      suggestedName: "mined-1-file.read",
      config,
      provider: stubSkill(SKILL_MD),
    });
    const path = join(process.env.HOME!, ".alix", "candidates", sessionId, "SKILL.md");
    assert.ok(existsSync(path), "candidate SKILL.md written");
    assert.match(readFileSync(path, "utf8"), /mined-read/);
  });

  it("builds the prompt from real sequences, not prose", () => {
    const prompt = factory.buildTraceDistillationPrompt({
      sessionId: "s",
      toolSequence: ["file.read"],
      traceIds: ["t1"],
      runs: 5,
      config,
    });
    assert.match(prompt, /file\.read/);
    assert.match(prompt, /t1/);
    assert.doesNotMatch(prompt, /Session summary/);
  });

  it("no-ops when disabled or evidence-empty", async () => {
    let calls = 0;
    const counting = stubProvider([SKILL_MD], undefined, () => { calls++; });
    await factory.runSkillFactoryFromTrace({
      sessionId: "x", toolSequence: [], traceIds: [], runs: 0, config, provider: counting,
    });
    await factory.runSkillFactoryFromTrace({
      sessionId: "y", toolSequence: ["a"], traceIds: ["t"], runs: 1,
      config: { ...config, enabled: false }, provider: counting,
    });
    assert.equal(calls, 0);
  });

  it("enforces the candidate bar: >=5 runs, scores >= 0.8", async () => {
    let calls = 0;
    const counting = stubProvider([SKILL_MD], undefined, () => { calls++; });
    const base = {
      sessionId: "bar", toolSequence: ["file.read"], config, provider: counting,
    };
    // Too few runs.
    await factory.runSkillFactoryFromTrace({ ...base, traceIds: ["t1", "t2"], runs: 2 });
    // Inflated run counter, too few unique traces.
    await factory.runSkillFactoryFromTrace({ ...base, traceIds: ["t1", "t2", "t3"], runs: 9 });
    // Enough runs but a low score.
    await factory.runSkillFactoryFromTrace({
      ...base, traceIds: ["t1", "t2", "t3", "t4", "t5"], runs: 5,
      scores: { t1: 0.9, t2: 0.9, t3: 0.9, t4: 0.9, t5: 0.4 },
    });
    assert.equal(calls, 0);
    // Bar met: distills.
    await factory.runSkillFactoryFromTrace({
      ...base, sessionId: "bar-ok", traceIds: ["t1", "t2", "t3", "t4", "t5"], runs: 5,
      scores: { t1: 0.9, t2: 0.85, t3: 0.9, t4: 1, t5: 0.8 },
    });
    assert.equal(calls, 1);
  });
});
