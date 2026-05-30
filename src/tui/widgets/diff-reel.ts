import { cyan, green, red, dim, bold } from "../ansi.js";

export interface DiffEntry {
  path: string;
  before: string;
  after: string;
  timestamp?: number;
}

export class DiffReelWidget {
  private diffs: DiffEntry[] = [];
  private collapsedDiffs: Set<number> = new Set();
  private maxLinesPerSection = 10;

  addDiff(diff: DiffEntry): void {
    this.diffs.push(diff);
  }

  clearDiffs(): void {
    this.diffs = [];
  }

  toggleCollapse(index: number): void {
    if (this.collapsedDiffs.has(index)) {
      this.collapsedDiffs.delete(index);
    } else {
      this.collapsedDiffs.add(index);
    }
  }

  private renderDiff(diff: DiffEntry, index: number): string {
    const lines: string[] = [];

    // Path header
    lines.push(cyan(`─── ${diff.path} ───────────────────────────`));

    // Check if should collapse
    const beforeLines = diff.before.split("\n");
    const afterLines = diff.after.split("\n");
    const isLarge = beforeLines.length > this.maxLinesPerSection || afterLines.length > this.maxLinesPerSection;

    if (isLarge && this.collapsedDiffs.has(index)) {
      lines.push(`${dim("  ... (collapsed, click to expand) ...")}`);
    } else {
      // Before section
      lines.push(dim("Before:"));
      const beforeToShow = beforeLines.slice(0, this.maxLinesPerSection);
      beforeToShow.forEach(line => {
        lines.push(`  ${red("-")} ${line}`);
      });
      if (beforeLines.length > this.maxLinesPerSection) {
        lines.push(`  ${dim(`... ${beforeLines.length - this.maxLinesPerSection} more lines`)}`);
      }

      lines.push("");

      // After section
      lines.push(green("After:"));
      const afterToShow = afterLines.slice(0, this.maxLinesPerSection);
      afterToShow.forEach(line => {
        lines.push(`  ${green("+")} ${line}`);
      });
      if (afterLines.length > this.maxLinesPerSection) {
        lines.push(`  ${dim(`... ${afterLines.length - this.maxLinesPerSection} more lines`)}`);
      }
    }

    return lines.join("\n");
  }

  render(): string {
    if (this.diffs.length === 0) {
      return dim("No changes yet");
    }

    return this.diffs.map((diff, i) => this.renderDiff(diff, i)).join("\n\n");
  }
}