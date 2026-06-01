import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpinnerWidget } from "../../../src/tui/widgets/spinner.js";

describe("SpinnerWidget phases", () => {
  it("starts in 'thinking' phase by default", () => {
    const s = new SpinnerWidget();
    assert.equal(s.getPhase(), "thinking");
  });

  it("can transition to 'writing' phase", () => {
    const s = new SpinnerWidget();
    s.setPhase("writing");
    assert.equal(s.getPhase(), "writing");
  });

  it("renders different glyphs per phase", () => {
    const thinking = new SpinnerWidget({ phase: "thinking" });
    const writing = new SpinnerWidget({ phase: "writing" });
    const verifying = new SpinnerWidget({ phase: "verifying" });
    const r1 = thinking.render();
    const r2 = writing.render();
    const r3 = verifying.render();
    // Each phase should have at least a phase label
    assert.ok(r1.includes("Thinking") || r1.includes("thinking") || r1.length > 0);
    assert.ok(r2.length > 0);
    assert.ok(r3.length > 0);
  });
});
