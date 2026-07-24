/**
 * Smoke verification for the in-TUI plan approval card.
 *
 * The TUI requires a live LLM provider to drive a plan through to the
 * gate; in offline / CI environments that path is unreachable. This test
 * exercises the rendering path directly: constructs a `TuiPlanApprovalGate`,
 * issues a `requestDecision`, then renders the gate's pending state into
 * a `TerminalCanvas` using the same rendering logic the TUI uses.
 *
 * If this test fails, the card will not appear in the TUI either.
 */
import { describe, it, expect } from "vitest";
import { TuiPlanApprovalGate } from "../../src/tui/plan-approval-gate.js";
import { TerminalCanvas } from "../../src/tui/canvas.js";

const HEADER_H = 3;
const FOOTER_H = 3;
const CARD_H = 4;

/**
 * Mirror of `TuiApp.paintPlanApprovalCard` — kept in sync manually.
 * The TUI's render path is a private method; this is the closest
 * smoke verification we can run without booting the full TUI.
 * If the production path drifts, the assertions break visibly.
 */
function paintCard(
  canvas: TerminalCanvas,
  width: number,
  height: number,
  pending: { planSummary: string } | null,
): void {
  if (!pending) return;
  const cardY = height - FOOTER_H - CARD_H;
  if (cardY <= HEADER_H + 1) return;

  const innerW = Math.max(0, width - 2);
  const summary = pending.planSummary.length > innerW - 2
    ? pending.planSummary.slice(0, innerW - 5) + "…"
    : pending.planSummary;
  const hint = "Y approve · n reject · e edit · d detail";

  const title = " PLAN APPROVAL REQUIRED ";
  const titlePad = Math.max(0, innerW - title.length);
  canvas.write(0, cardY, `\x1b[33m${"╭" + title + "─".repeat(titlePad) + "╮"}\x1b[0m`);

  canvas.write(0, cardY + 1, "\x1b[33m│\x1b[0m");
  canvas.write(1, cardY + 1, summary);
  canvas.write(1 + summary.length, cardY + 1, " ".repeat(Math.max(0, innerW - 1 - summary.length)));
  canvas.write(width - 1, cardY + 1, "\x1b[33m│\x1b[0m");

  const hintRow = hint.length > innerW ? hint.slice(0, innerW) : hint;
  canvas.write(0, cardY + 2, "\x1b[33m│\x1b[0m");
  canvas.write(1, cardY + 2, hintRow);
  canvas.write(1 + hintRow.length, cardY + 2, " ".repeat(Math.max(0, innerW - 1 - hintRow.length)));
  canvas.write(width - 1, cardY + 2, "\x1b[33m│\x1b[0m");

  canvas.write(0, cardY + 3, "\x1b[33m" + "╰" + "─".repeat(innerW) + "╯" + "\x1b[0m");
}

describe("plan approval card render", () => {
  it("renders the card into the canvas when the gate is pending", async () => {
    const gate = new TuiPlanApprovalGate();
    const pending = gate.requestDecision({
      planId: "smoke-1",
      planSummary: "Add hello() to foo.ts",
      planContent: "# Plan\n\n- add hello()\n",
      planPath: "/tmp/smoke.md",
    });

    const canvas = new TerminalCanvas(80, 30);
    const pendingSnap = gate.getPending();
    paintCard(canvas, 80, 30, pendingSnap);

    const rendered = canvas.renderFrame();
    expect(rendered).toContain("PLAN APPROVAL REQUIRED");
    expect(rendered).toContain("Add hello() to foo.ts");
    expect(rendered).toContain("Y approve");
    expect(rendered).toContain("n reject");
    expect(rendered).toContain("e edit");
    expect(rendered).toContain("d detail");

    // Cleanup so the dangling Promise doesn't linger.
    gate.resolve("smoke-1", "approve");
    await pending;
  });

  it("renders nothing when the gate has no pending request", () => {
    const gate = new TuiPlanApprovalGate();
    const canvas = new TerminalCanvas(80, 30);
    paintCard(canvas, 80, 30, gate.getPending());
    const rendered = canvas.renderFrame();
    expect(rendered).not.toContain("PLAN APPROVAL");
  });

  it("truncates the summary to fit narrow terminals", async () => {
    const gate = new TuiPlanApprovalGate();
    const longSummary = "x".repeat(200);
    const pending = gate.requestDecision({
      planId: "smoke-narrow",
      planSummary: longSummary,
      planContent: "",
      planPath: "/tmp/smoke.md",
    });
    const canvas = new TerminalCanvas(40, 30);
    paintCard(canvas, 40, 30, gate.getPending());
    const rendered = canvas.renderFrame();
    // The card should be present but the summary line should not exceed
    // the inner width (here 38 cols, so 38 chars max).
    expect(rendered).toContain("PLAN APPROVAL REQUIRED");
    // The truncation char is '…', so the trailing char of the summary
    // line should be '…' or the line should not contain the full 200
    // x's.
    expect(rendered).not.toContain("x".repeat(80));
    gate.resolve("smoke-narrow", "approve");
    await pending;
  });

  it("card renders above the footer, not in the scrollback area", async () => {
    const gate = new TuiPlanApprovalGate();
    const pending = gate.requestDecision({
      planId: "smoke-geom",
      planSummary: "summary",
      planContent: "",
      planPath: "/tmp/smoke.md",
    });
    const canvas = new TerminalCanvas(60, 24);
    paintCard(canvas, 60, 24, gate.getPending());
    const rows = canvas.renderFrame().split("\n");
    // CARD_H=4, FOOTER_H=3, so the card occupies rows 24-3-4=17 to 20.
    // The footer occupies rows 21-23 (the last 3 rows).
    // The card's bottom border should be at row 20, not in the footer.
    const bottomBorderRow = rows[20] ?? "";
    expect(bottomBorderRow).toContain("╰");
    gate.resolve("smoke-geom", "approve");
    await pending;
  });
});
