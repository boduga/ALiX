import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult } from "../../src/agents/result-contract-validator.js";
import type { SubagentResult } from "../../src/config/schema.js";

function makeResult(status: SubagentResult["status"], content?: string): SubagentResult {
  return {
    id: "t", role: "worker",
    status,
    findings: content ? [{ type: "summary", content, confidence: "high" }] : [],
    events: [],
    error: status === "partial" ? "delegated objective incomplete" : undefined,
  };
}

test("validateResult: partial behaves identically to success for expected-output checks", () => {
  const partial = validateResult(makeResult("partial", "edited foo to 42"), "42");
  const success = validateResult(makeResult("success", "edited foo to 42"), "42");
  assert.deepEqual(partial.warnings, success.warnings);
  assert.equal(partial.valid, success.valid);
});

test("validateResult: partial behaves identically to success for no-findings warnings", () => {
  const partial = validateResult(makeResult("partial"));
  const success = validateResult(makeResult("success"));
  assert.deepEqual(partial.warnings, success.warnings);
  assert.equal(partial.valid, success.valid);
});
