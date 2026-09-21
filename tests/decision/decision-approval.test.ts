import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeApproval,
  exceedsRiskThreshold,
} from "../../src/decision/index.js";

describe("approval floor (JEV-8)", () => {
  it("policy-required approval survives any risk score", () => {
    for (const risk of [true, false]) {
      assert.equal(composeApproval(true, risk), true);
    }
  });

  it("risk escalates only when policy is silent", () => {
    assert.equal(composeApproval(false, false), false);
    assert.equal(composeApproval(false, true), true);
  });

  it("threshold compare is fail-closed on missing risk", () => {
    assert.equal(exceedsRiskThreshold(undefined, 0.5), false);
    assert.equal(exceedsRiskThreshold(0.2, 0.5), false);
    assert.equal(exceedsRiskThreshold(0.5, 0.5), true);
    assert.equal(exceedsRiskThreshold(Number.NaN, 0.5), false);
  });
});
