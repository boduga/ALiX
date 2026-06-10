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
import { renderDashboardCards, renderCompactSummary, snapshotFromStore } from "./dashboard-renderer.js";

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
  private lastCards: string[] = [];

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
    const w = process.stdout.columns || 80;
    const cardCount = this.cardCount(h, w);
    const scrollH = h - STATUS - cardCount;
    process.stdout.write(`\x1b[1;${scrollH}r`);
    process.stdout.write("\n".repeat(scrollH));
    this.putFixed();
  }

  /** Separator before a new task. */
  resetOutput(): void {
    if (!this.ready) return;
    this.lastBlock = "";
    this.lastCards = [];
    process.stdout.write("\n" + clearToEndOfLine() + "─".repeat(process.stdout.columns || 80));
    this.putFixed();
  }

  /** Append output. streaming=true overwrites last line. */
  appendOutput(text: string, streaming = false): void {
    if (!this.running || !this.ready) return;
    if (streaming) {
      process.stdout.write("\r" + clearToEndOfLine() + text);
    } else {
      process.stdout.write(text + "\n");
    }
    this.putFixed();
  }

  // ── Internal ────────────────────────────────────────────────────

  private cardCount(h: number, w: number): number {
    const s = this.store.getState();
    if (s.activePanel !== "chat") return 0;
    if (h >= 40 && w >= 150) return 10;  // full 3-wide cards
    if (h >= 28 && w >= 110) return 5;   // laptop 2-row
    if (h >= 25 && w >= 100) return 1;   // compact summary
    return 0;
  }

  private requestRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    setTimeout(() => {
      if (!this.running) return;
      this.renderPending = false;
      this.renderFixed();
    }, 50);
  }

  /** Write all fixed content: cards + status lines. */
  private putFixed(): void {
    if (!this.ready) return;
    const statusBlock = this.buildStatusBlock();
    this.lastBlock = statusBlock;
    const h = getTerminalHeight();
    const w = process.stdout.columns || 80;
    const s = this.store.getState();
    const cCount = this.cardCount(h, w);

    let cards: string[] = [];
    if (cCount >= 10) {
      cards = renderDashboardCards(snapshotFromStore(s), w);
    } else if (cCount >= 5) {
      cards = renderDashboardCards(snapshotFromStore(s), w, true);
    } else if (cCount >= 1) {
      cards = [renderCompactSummary(snapshotFromStore(s), w)];
    }

    const totalFixed = cards.length + STATUS;
    const fixedStart = h - totalFixed;

    process.stdout.write("\x1b[s");
    // Dashboard cards
    for (let i = 0; i < cards.length; i++) {
      process.stdout.write(LINE(fixedStart + i));
      process.stdout.write(clearToEndOfLine() + cards[i]);
    }
    // Status lines
    const statusStart = fixedStart + cards.length;
    const parts = statusBlock.split("\n");
    for (let i = 0; i < STATUS; i++) {
      process.stdout.write(LINE(statusStart + i));
      if (i < parts.length) process.stdout.write(parts[i]);
      else process.stdout.write(clearToEndOfLine());
    }
    process.stdout.write("\x1b[u");

    this.lastCards = cards;
  }

  private renderFixed(): void {
    if (!this.ready) return;
    const statusBlock = this.buildStatusBlock();
    if (statusBlock === this.lastBlock) {
      // Check if cards changed
      const h = getTerminalHeight();
      const w = process.stdout.columns || 80;
      const s = this.store.getState();
      const cCount = this.cardCount(h, w);
      let cards: string[] = [];
      if (cCount >= 10) cards = renderDashboardCards(snapshotFromStore(s), w);
      else if (cCount >= 5) cards = renderDashboardCards(snapshotFromStore(s), w, true);
      else if (cCount >= 1) cards = [renderCompactSummary(snapshotFromStore(s), w)];
      if (JSON.stringify(cards) === JSON.stringify(this.lastCards)) return;
    }
    this.putFixed();
  }

  private buildStatusBlock(): string {
    const s = this.store.getState();
    this.stateTheater.setState(s.agentState);
    if (s.agentReasoning) this.stateTheater.setReasoning(s.agentReasoning);
    this.budgetBar.setTokens(s.tokenBudget.used, s.tokenBudget.max);
    this.budgetBar.setFiles(s.tokenBudget.files);

    const w = process.stdout.columns || 80;
    const l: string[] = [];
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
