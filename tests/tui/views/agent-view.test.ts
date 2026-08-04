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
});