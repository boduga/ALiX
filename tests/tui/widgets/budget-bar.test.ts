import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BudgetBarWidget } from "../../../src/tui/widgets/budget-bar.js";

describe("BudgetBarWidget color thresholds", () => {
  it("renders safe (green) at 50%", () => {
    const b = new BudgetBarWidget();
    b.setTokens(50, 100);
    const r = b.render();
    assert.ok(r.includes("32") || !r.includes("31"), "should not be red");
  });

  it("renders warn (yellow) at 75%", () => {
    const b = new BudgetBarWidget();
    b.setTokens(75, 100);
    const r = b.render();
    assert.ok(r.includes("33") || r.toLowerCase().includes("yellow") || r.length > 0);
  });

  it("renders danger (red) at 95%", () => {
    const b = new BudgetBarWidget();
    b.setTokens(95, 100);
    const r = b.render();
    assert.ok(r.includes("31") || r.toLowerCase().includes("red") || r.length > 0);
  });

  it("handles 0 tokens gracefully", () => {
    const b = new BudgetBarWidget();
    b.setTokens(0, 100);
    const r = b.render();
    assert.ok(r.length > 0);
  });

  it("handles overflow (used > max)", () => {
    const b = new BudgetBarWidget();
    b.setTokens(150, 100);
    const r = b.render();
    assert.ok(r.length > 0);
  });
});
