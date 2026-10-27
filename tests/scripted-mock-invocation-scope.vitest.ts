import { describe, expect, it } from "vitest";
import { advanceScriptedStep, withScriptedScenario, setScriptedScenario, clearScriptedScenario } from "../src/operations/evals/providers/scripted-mock-carrier.js";

const script = { steps: [
  { kind: "tool" as const, tool: "file.create" as const, args: { path: "a", content: "x" } },
  { kind: "text" as const, text: "Done." },
] };

describe("scripted model invocation isolation", () => {
  it("starts a fresh cursor on every invocation and retry", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await withScriptedScenario(script, async () => [advanceScriptedStep(), advanceScriptedStep(), advanceScriptedStep()]);
      expect(result).toEqual([script.steps[0], script.steps[1], undefined]);
    }
  });

  it("isolates interleaved workers and preserves legacy eval cursor", async () => {
    setScriptedScenario(script);
    try {
      const results = await Promise.all(Array.from({ length: 4 }, () => withScriptedScenario(script, async () => {
        const first = advanceScriptedStep();
        await Promise.resolve();
        return [first, advanceScriptedStep(), advanceScriptedStep()];
      })));
      for (const result of results) expect(result).toEqual([script.steps[0], script.steps[1], undefined]);
      expect(advanceScriptedStep()).toEqual(script.steps[0]);
    } finally { clearScriptedScenario(); }
  });
});
