import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult } from "../../src/agents/result-contract-validator.js";
import type { SubagentResult } from "../../src/operations/config/schema.js";

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
  // Content must not contain the expected token, or the missing-warning check
  // would pass even if partial were dropped from the expected-output branch.
  const partial = validateResult(makeResult("partial", "edited foo to 41"), "42");
  const success = validateResult(makeResult("success", "edited foo to 41"), "42");
  assert.deepEqual(partial.warnings, success.warnings);
  assert.equal(partial.valid, success.valid);
});

test("validateResult: partial behaves identically to success for no-findings warnings", () => {
  const partial = validateResult(makeResult("partial"));
  const success = validateResult(makeResult("success"));
  assert.deepEqual(partial.warnings, success.warnings);
  assert.equal(partial.valid, success.valid);
});

test("validateResult: valid when no expected output", () => {
  const v = validateResult(makeResult("success", "Found X"));
  assert.equal(v.valid, true);
  assert.equal(v.warnings.length, 0);
});

test("validateResult: warns when expected output not found", () => {
  const v = validateResult(makeResult("success", "No matches"), "specific keyword");
  assert.equal(v.valid, false);
  assert.ok(v.warnings[0].includes("specific keyword"));
});

test("validateResult: warns on success with empty findings", () => {
  const v = validateResult(makeResult("success"));
  assert.equal(v.valid, false);
  assert.ok(v.warnings.some(w => w.includes("no findings")));
});

test("validateResult: skips expected check on failed result", () => {
  const v = validateResult(makeResult("failed"), "anything");
  assert.equal(v.valid, true);
});
