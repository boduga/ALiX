// src/run/progress-ledger.ts
// Runtime-owned progress tracker. Derived FROM tool execution —
// the model never writes to the ledger directly.

export type LedgerStatus = "completed" | "failed" | "pending";

export interface LedgerEntry {
  status: LedgerStatus;
  summary: string;
  timestamp: number;
}

export interface LedgerSection {
  label: string;    // e.g. "Research", "Execution"
  entries: LedgerEntry[];
}

export class ProgressLedger {
  private sections: LedgerSection[] = [];
  private currentSection = "";

  /** Start a new section (e.g. "Execution", "Verification"). */
  startSection(label: string): void {
    this.currentSection = label;
    this.sections.push({ label, entries: [] });
  }

  /** Record a completed/failed tool call. */
  recordToolCall(toolName: string, summary: string | undefined, succeeded: boolean): void {
    const text = summary || toolName;
    const section = this.sections.find(s => s.label === this.currentSection)
      ?? this.sections[this.sections.length - 1]
      ?? { label: this.currentSection || "Tasks", entries: [] };
    if (!this.sections.includes(section)) this.sections.push(section);
    section.entries.push({
      status: succeeded ? "completed" : "failed",
      summary: text,
      timestamp: Date.now(),
    });
  }

  /** Render the last N entries across all sections as a plain-text block. */
  render(maxEntries = 10): string {
    const all: { label: string; entry: LedgerEntry }[] = [];
    for (const s of this.sections) {
      for (const e of s.entries) {
        all.push({ label: s.label, entry: e });
      }
    }
    const slice = all.slice(-maxEntries);
    if (slice.length === 0) return "";

    const lines: string[] = [];
    let lastLabel = "";
    for (const { label, entry } of slice) {
      if (label !== lastLabel) {
        lines.push(`─── ${label} ───`);
        lastLabel = label;
      }
      const symbol = entry.status === "completed" ? "✓"
        : entry.status === "failed" ? "✗"
        : "○";
      lines.push(`  ${symbol} ${entry.summary}`);
    }
    return lines.join("\n");
  }

  /** Reset all state (for new task). */
  reset(): void {
    this.sections = [];
    this.currentSection = "";
  }
}
