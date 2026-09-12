import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shellQuote } from "../../../src/cli/commands/evals.js";

describe("shellQuote", () => {
  it("single-quotes plain values", () => {
    assert.equal(shellQuote("champion"), "'champion'");
    assert.equal(shellQuote("fix login"), "'fix login'");
  });

  it("escapes embedded single quotes", () => {
    assert.equal(shellQuote("it's"), "'it'\\''s'");
  });
});
