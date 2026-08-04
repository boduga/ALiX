import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TerminalCanvas } from "../../../src/tui/canvas.js";
import { AgentView } from "../../../src/tui/views/agent-view.js";
import type { ViewRenderContext } from "../../../src/tui/views/types.js";

function stripCtx(slash: any): ViewRenderContext {
  const canvas = new TerminalCanvas(60, 20);
  return {
    snap: {} as any,
    dimensions: { columns: 60, rows: 20 },
    perTab: { inputBuffer: "/tdd" } as any,
    canvas,
    runtime: { chat: { timeline: [] } as any, agent: { timeline: [] } as any },
    slash,
  } as ViewRenderContext;
}

describe("AgentView slash strip", () => {
  it("renders ranked candidates with the selected marker", () => {
    const ctx = stripCtx({
      entries: [
        { name: "tdd", label: "/tdd", description: "TDD" },
        { name: "ts", label: "/ts", description: "TS" },
      ],
      selected: 0,
      hint: null,
    });
    new AgentView().render(ctx);
    const frame = ctx.canvas!.renderFrame();
    assert.match(frame, /\/tdd/);
    assert.match(frame, /TDD/);
  });

  it("renders the unknown-command hint", () => {
    const ctx = stripCtx({ entries: [], selected: 0, hint: 'Unknown skill "/nope"' });
    new AgentView().render(ctx);
    const frame = ctx.canvas!.renderFrame();
    assert.match(frame, /Unknown skill/);
  });

  // Regression for the Task 7 overlay-ordering defect: the strip must be
  // drawn AFTER the scrollback render loop so `TerminalCanvas.write` does
  // not obliterate it on the next iteration. Earlier cut rendered the
  // strip at rows 6-11 BEFORE the scrollback build, so any agent turn /
  // plan / approval / tool-call / ledger line in `runtime.agent.timeline`
  // overwrote the first visible scrollback line. Tests at the time passed
  // only because `stripCtx` left `runtime.agent.timeline` empty.
  it("strip overlays scrollback when timeline is non-empty", () => {
    const canvas = new TerminalCanvas(60, 20);
    const ctx = {
      snap: {} as any,
      dimensions: { columns: 60, rows: 20 },
      perTab: { inputBuffer: "/tdd", scrollOffset: 0 } as any,
      canvas,
      // Minimal TimelineEntry shape (see src/tui/runtime/timeline-builder.ts):
      // kind ∈ TimelineKind, `agent.response` is the simplest kind that
      // survives the scrollback filter at agent-view.ts:100-108 and renders
      // as an agent turn (← marker + text).
      runtime: {
        chat: { timeline: [] } as any,
        agent: {
          timeline: [
            { kind: 'agent.response', text: 'EXISTING SCROLLBACK LINE' } as any,
          ],
        } as any,
      },
      slash: {
        entries: [
          { name: "tdd", label: "/tdd", description: "TDD" },
        ],
        selected: 0,
        hint: null,
      },
    } as ViewRenderContext;
    new AgentView().render(ctx);
    const frame = ctx.canvas!.renderFrame();
    // Both the strip label and the scrollback text must be present in the
    // rendered frame — proves the strip was written AFTER the scrollback
    // build (any other ordering means the scrollback's
    // `← EXISTING SCROLLBACK LINE` line at row 6 would have erased the
    // strip's `/tdd` label at row 6 first).
    //
    // Because the strip and scrollback share row 6, the strip's
    // `c.write(0, 6, " > /tdd TDD ")` overwrites cols 0-12; the scrollback's
    // `c.write(2, 6, "EXISTING SCROLLBACK LINE")` survives only from col 13
    // onward, yielding tail fragment `SCROLLBACK LINE`. Both substrings
    // appearing in `frame` is the regression invariant.
    assert.match(frame, /\/tdd/);
    assert.match(frame, /SCROLLBACK LINE/);
  });
});