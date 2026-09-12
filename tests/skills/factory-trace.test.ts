import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

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

const stubProvider = (text: string) => ({
  complete: async () => ({ text }),
});

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
      traceIds: ["t1", "t2"],
      runs: 5,
      suggestedName: "mined-1-file.read",
      config,
      provider: stubProvider(SKILL_MD) as any,
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
    const counting = { complete: async () => { calls++; return { text: SKILL_MD }; } };
    await factory.runSkillFactoryFromTrace({
      sessionId: "x", toolSequence: [], traceIds: [], runs: 0, config, provider: counting as any,
    });
    await factory.runSkillFactoryFromTrace({
      sessionId: "y", toolSequence: ["a"], traceIds: ["t"], runs: 1,
      config: { ...config, enabled: false }, provider: counting as any,
    });
    assert.equal(calls, 0);
  });
});
