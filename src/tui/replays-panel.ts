/**
 * replays-panel.ts — TUI panel for browsing replay and rollback history.
 *
 * Reads status from ReplayStatusIndex, loads rollback progress, and
 * renders a scrollable list. Selection opens a detail view with
 * diffs, approval state, and step results.
 */

import type { ReplayStatusEntry } from "../runtime/replay-status-index.js";
import type { ReplayDiffStore } from "../runtime/replay-diff-store.js";
import type { RollbackProgressStore } from "../runtime/rollback-progress.js";
import type { ReplayLock } from "../runtime/replay-lock.js";
import type { TuiStore } from "./store.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type ReplaySummary = {
  replayId: string;
  status: string;
  mode: string;
  stepCount: number;
  createdAt: string;
  hasDiffSet: boolean;
  lockState: boolean;
};

export type ReplaysPanelState = {
  replays: ReplaySummary[];
  selectedIndex: number;
  detailView: boolean;
  loading: boolean;
  error?: string;
};

// ─── Colors (ANSI) ─────────────────────────────────────────────────────

const COLOR_GREEN = "\x1b[32m";
const COLOR_YELLOW = "\x1b[33m";
const COLOR_RED = "\x1b[31m";
const COLOR_CYAN = "\x1b[36m";
const COLOR_DIM = "\x1b[2m";
const COLOR_RESET = "\x1b[0m";
const COLOR_BOLD = "\x1b[1m";

// ─── Status helpers ────────────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case "completed": return `${COLOR_GREEN}✓${COLOR_RESET}`;
    case "capturing": return `${COLOR_YELLOW}●${COLOR_RESET}`;
    case "rollback-dry-run": return `${COLOR_CYAN}○${COLOR_RESET}`;
    case "rollback-running": return `${COLOR_YELLOW}●${COLOR_RESET}`;
    case "rollback-completed": return `${COLOR_GREEN}↩${COLOR_RESET}`;
    case "rollback-partial": return `${COLOR_YELLOW}↩${COLOR_RESET}`;
    case "locked": return `${COLOR_YELLOW}🔒${COLOR_RESET}`;
    default: return `${COLOR_DIM}?${COLOR_RESET}`;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "capturing": return "capturing";
    case "completed": return "completed";
    case "rollback-dry-run": return "dry-run";
    case "rollback-running": return "rollback running";
    case "rollback-completed": return "rolled back";
    case "rollback-partial": return "partial";
    case "locked": return "locked";
    default: return status;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// ─── ReplaysPanel ──────────────────────────────────────────────────────

export class ReplaysPanel {
  readonly name = "replays";
  private state: ReplaysPanelState = {
    replays: [],
    selectedIndex: 0,
    detailView: false,
    loading: true,
  };

  constructor(
    private cwd: string,
    private store: TuiStore,
  ) {}

  async refresh(): Promise<void> {
    this.state.loading = true;
    this.state.detailView = false;
    this.state.selectedIndex = 0;
    try {
      this.state.replays = await this.loadReplays();
      this.state.error = undefined;
    } catch (err: any) {
      this.state.error = err.message ?? String(err);
      this.state.replays = [];
    }
    this.state.loading = false;
  }

  private async loadReplays(): Promise<ReplaySummary[]> {
    const { ReplayStatusIndex } = await import("../runtime/replay-status-index.js");
    const { ReplayDiffStore } = await import("../runtime/replay-diff-store.js");
    const statusIndex = new ReplayStatusIndex(this.cwd);
    const diffStore = new ReplayDiffStore(this.cwd);

    const entries = await statusIndex.getAll();
    const lockStates = this.store.getState().replayLockStates ?? {};

    const summaries: ReplaySummary[] = [];
    for (const entry of entries) {
      const diffSet = await diffStore.loadIndex(entry.replayId);
      summaries.push({
        replayId: entry.replayId,
        status: entry.status,
        mode: entry.replayMode ?? "unknown",
        stepCount: diffSet?.records.length ?? 0,
        createdAt: entry.createdAt,
        hasDiffSet: !!diffSet && diffSet.records.length > 0,
        lockState: !!lockStates[entry.replayId],
      });
    }

    summaries.sort((a, b) => {
      const tA = new Date(a.createdAt || 0).getTime();
      const tB = new Date(b.createdAt || 0).getTime();
      return tB - tA; // most recent first
    });

    return summaries;
  }

  render(width: number, height: number): string[] {
    if (this.state.error) {
      return [`${COLOR_RED}Error loading replays: ${this.state.error}${COLOR_RESET}`];
    }
    if (this.state.loading) {
      return ["Loading replays..."];
    }
    if (this.state.replays.length === 0) {
      return ["No replays found. Run a replay first via /replay."];
    }

    if (this.state.detailView && this.state.replays[this.state.selectedIndex]) {
      return this.renderDetail(width, height);
    }

    return this.renderList(width, height);
  }

  private renderList(width: number, height: number): string[] {
    const lines: string[] = [];
    const header = `${COLOR_BOLD}Replays (${this.state.replays.length})${COLOR_RESET}`;
    lines.push(header);
    lines.push("─".repeat(Math.min(width, 60)));

    const availableLines = height - 3;
    let startIdx = Math.max(0, this.state.selectedIndex - Math.floor(availableLines / 2));
    const visible = this.state.replays.slice(startIdx, startIdx + availableLines);

    for (const replay of visible) {
      const idx = this.state.replays.indexOf(replay);
      const sel = idx === this.state.selectedIndex ? "▸ " : "  ";
      const icon = statusIcon(replay.status);
      const modeTag = replay.mode === "approved-live" ? "live" : replay.mode;
      const diffIcon = replay.hasDiffSet ? " 📄" : "";
      const lockIcon = replay.lockState ? " 🔒" : "";
      const ts = replay.createdAt ? formatTimestamp(replay.createdAt) : "unknown date";

      lines.push(`${sel}${icon} ${replay.replayId.slice(0, 24)} [${modeTag}]${diffIcon}${lockIcon}`);
      lines.push(`   ${COLOR_DIM}${ts} — ${replay.stepCount} changes${COLOR_RESET}`);
    }

    lines.push("");
    lines.push(`${COLOR_DIM}↑↓ navigate · → detail · r refresh · ESC back${COLOR_RESET}`);
    return lines;
  }

  private renderDetail(width: number, height: number): string[] {
    const replay = this.state.replays[this.state.selectedIndex];
    const lines: string[] = [];

    const header = `${COLOR_BOLD}${statusIcon(replay.status)} ${replay.replayId}${COLOR_RESET}`;
    lines.push(header);
    lines.push("─".repeat(Math.min(width, 60)));

    lines.push(`Mode:   ${replay.mode}`);
    lines.push(`Status: ${statusLabel(replay.status)}`);
    lines.push(`Changes:  ${replay.stepCount}`);
    if (replay.createdAt) lines.push(`Date:   ${formatTimestamp(replay.createdAt)}`);
    lines.push(`Diffs:  ${replay.hasDiffSet ? `${COLOR_GREEN}available${COLOR_RESET}` : `${COLOR_DIM}none${COLOR_RESET}`}`);
    if (replay.lockState) {
      lines.push(`Lock:   ${COLOR_YELLOW}active${COLOR_RESET}`);
    }

    lines.push("");
    lines.push(`${COLOR_DIM}← back to list${COLOR_RESET}`);
    return lines;
  }

  onInput(key: string): boolean {
    if (this.state.replays.length === 0) return false;

    if (this.state.detailView) {
      if (key === "left" || key === "escape") {
        this.state.detailView = false;
        return true;
      }
      return false;
    }

    switch (key) {
      case "down": case "j":
        if (this.state.selectedIndex < this.state.replays.length - 1) {
          this.state.selectedIndex++;
        }
        return true;
      case "up": case "k":
        if (this.state.selectedIndex > 0) {
          this.state.selectedIndex--;
        }
        return true;
      case "right": case "enter":
        this.state.detailView = true;
        return true;
      case "r":
        this.refresh();
        return true;
      default:
        return false;
    }
  }
}
