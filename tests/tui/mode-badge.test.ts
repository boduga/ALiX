import { describe, it } from "node:test";
import assert from "node:assert/strict";

function getModeIcon(mode: string): string {
  return mode === "bypass" ? "⚠" : mode === "auto" ? "●" : "✓";
}

describe("TUI mode badge", () => {
  it("bypass mode shows warning icon", () => {
    assert.equal(getModeIcon("bypass"), "⚠");
  });

  it("ask mode shows checkmark", () => {
    assert.equal(getModeIcon("ask"), "✓");
  });

  it("auto mode shows bullet", () => {
    assert.equal(getModeIcon("auto"), "●");
  });
});
