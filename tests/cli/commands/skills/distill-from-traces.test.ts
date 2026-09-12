import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDistillArgs } from "../../../../src/cli/commands/skills/distill-from-traces.js";

describe("parseDistillArgs", () => {
  it("parses valued options with defaults left undefined", () => {
    assert.deepEqual(parseDistillArgs(["--candidates", "c.json"]), {
      candidatesFile: "c.json",
      minRuns: undefined,
      minScore: undefined,
      provider: "",
      model: "",
      asJson: false,
    });
  });

  it("parses overrides and --json", () => {
    const opts = parseDistillArgs([
      "--candidates", "c.json", "--min-runs", "7", "--min-score", "0.9",
      "--provider", "openrouter", "--model", "x", "--json",
    ]);
    assert.equal(opts.minRuns, 7);
    assert.equal(opts.minScore, 0.9);
    assert.equal(opts.provider, "openrouter");
    assert.equal(opts.model, "x");
    assert.equal(opts.asJson, true);
  });

  it("throws usage when --candidates is missing and drops NaN overrides", () => {
    assert.throws(() => parseDistillArgs([]), /Usage: alix skills distill-from-traces/);
    const opts = parseDistillArgs(["--candidates", "c.json", "--min-runs", "many"]);
    assert.equal(opts.minRuns, undefined);
  });
});
