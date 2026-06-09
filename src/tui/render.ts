// src/tui/render.ts — Scroll-region split-screen renderer.
//
// ANSI scroll region (ESC[top;bottomr) locks lines below <bottom> out of the
// scrollable area. Newlines within the region scroll content, but lines below
// the region are FIXED. The status bar lives in the fixed zone.
// Cursor save/restore prevents desync from external console.log output.
//
// Layout (24-line terminal):
//   0..19  — output area (scroll region, \n scrolls here)
//   20     — divider ────
//   21     — combined status  ○ EXECUTING | TOKENS: ████░░░░ 42% | Files: 3
//   22     — spinner        ⠋ Searching...
//   23     — reserved

import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { clearToEndOfLine, getTerminalHeight } from "./ansi.js";
import { renderDashboardCards, snapshotFromStore } from "./dashboard-renderer.js";

const STATUS = 4;
const LINE = (n: number) => `\x1b[${n + 1};1H`;

export class TuiRenderer {
  private stateTheater = new StateTheaterWidget();
  private budgetBar = new BudgetBarWidget();
  private spinner = new SpinnerWidget({ label: "Thinking..." });
  private running = false;
  private renderPending = false;
  private ready = false;
  private lastBlock = "";

  constructor(private store: TuiStore) {
    this.store.subscribe(() => this.requestRender());
  }

  start(): void { this.running = true; }

  stop(): void {
    this.running = false;
    const h = getTerminalHeight();
    process.stdout.write(`\x1b[1;${h}r\x1b[?25h`);
  }

  /** Set scroll region and write initial status bar at the bottom. */
  drawLayout(): void {
    if (this.ready) return;
    this.ready = true;
    process.stdout.write("\x1b[?25l");

    const h = getTerminalHeight();
    const scrollH = h - STATUS;
    process.stdout.write(`\x1b[1;${scrollH}r`);
    process.stdout.write("\n".repeat(scrollH));
    this.putStatus();
  }

  /** Separator before a new task. */
  resetOutput(): void {
    if (!this.ready) return;
    this.lastBlock = "";
    process.stdout.write("\n" + clearToEndOfLine() + "─".repeat(process.stdout.columns || 80));
    this.putStatus();
  }

  /** Append output. streaming=true overwrites last line. */
  appendOutput(text: string, streaming = false): void {
    if (!this.running || !this.ready) return;
    if (streaming) {
      process.stdout.write("\r" + clearToEndOfLine() + text);
    } else {
      process.stdout.write(text + "\n");
    }
    this.putStatus();
  }

  // ── Internal ────────────────────────────────────────────────────

  private requestRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    setTimeout(() => {
      if (!this.running) return;
      this.renderPending = false;
      this.renderStatus();
    }, 50);
  }

  /** Save cursor, write status lines at bottom, restore cursor. */
  private putStatus(): void {
    if (!this.ready) return;
    const block = this.buildBlock();
    this.lastBlock = block;
    process.stdout.write("\x1b[s"); // save
    const h = getTerminalHeight();
    const start = h - STATUS;
    const parts = block.split("\n");
    for (let i = 0; i < STATUS; i++) {
      process.stdout.write(LINE(start + i));
      if (i < parts.length) process.stdout.write(parts[i]);
      else process.stdout.write(clearToEndOfLine());
    }
    process.stdout.write("\x1b[u"); // restore
  }

  private renderStatus(): void {
    if (!this.ready) return;
    const block = this.buildBlock();
    if (block === this.lastBlock) return;
    this.lastBlock = block;
    process.stdout.write("\x1b[s");
    const h = getTerminalHeight();
    const start = h - STATUS;
    const parts = block.split("\n");
    for (let i = 0; i < STATUS; i++) {
      process.stdout.write(LINE(start + i));
      if (i < parts.length) process.stdout.write(parts[i]);
      else process.stdout.write(clearToEndOfLine());
    }
    process.stdout.write("\x1b[u");
  }

  private buildBlock(): string {
    const s = this.store.getState();
    this.stateTheater.setState(s.agentState);
    if (s.agentReasoning) this.stateTheater.setReasoning(s.agentReasoning);
    this.budgetBar.setTokens(s.tokenBudget.used, s.tokenBudget.max);
    this.budgetBar.setFiles(s.tokenBudget.files);

    const w = process.stdout.columns || 80;
    const h = getTerminalHeight();
    const showCards = h >= 30 && w >= 120 && s.activePanel === "chat";
    const l: string[] = [];
    if (showCards) {
      const snap = snapshotFromStore(s);
      const cards = renderDashboardCards(snap, w);
      for (const line of cards) l.push(clearToEndOfLine() + line);
    }
    l.push(clearToEndOfLine() + "─".repeat(w));
    const daemonIcon = s.daemonRunning === undefined ? "" : s.daemonRunning ? "●" : "○";
    const daemonStr = s.daemonRunning !== undefined ? ` ${daemonIcon}${s.daemonRunning ? " daemon" : " stopped"}` : "";
    const pendingStr = s.pendingApprovalsCount ? ` ⚠ ${s.pendingApprovalsCount} pending` : "";
    const sopsStr = s.sopsCount ? ` SOPs:${s.sopsCount}` : "";
    const policyStr = s.policyRulesCount ? ` rules:${s.policyRulesCount}` : "";
    const panelStr = ` [${s.activePanel}]`;
    l.push(clearToEndOfLine() + panelStr + this.stateTheater.render() + " | " + this.budgetBar.render()
      + daemonStr + pendingStr + sopsStr + policyStr);
    let extra = "";
    if (s.daemonTasks) {
      const t = s.daemonTasks;
      const parts: string[] = [];
      if (t.running) parts.push(`run:${t.running}`);
      if (t.queued) parts.push(`queued:${t.queued}`);
      if (t.completed) parts.push(`done:${t.completed}`);
      if (t.failed) parts.push(`fail:${t.failed}`);
      if (parts.length) extra = " tasks: " + parts.join(" ");
    }
    if (s.runtimeEventCount) extra += ` events:${s.runtimeEventCount}`;
    const isActive = s.agentState !== "idle";
    l.push(clearToEndOfLine() + (isActive ? this.spinner.render() : "") + extra);
    return l.join("\n");
  }
}
