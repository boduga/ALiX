export type DiffFormat = "unified" | "side-by-side" | "raw";

export interface DiffRendererOptions {
  format?: DiffFormat;
  color?: boolean;
  /**
   * Reserved for future implementation - limits context lines around changes.
   * Currently unused but maintained for API compatibility.
   */
  contextLines?: number;
}

export interface DiffInput {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
  /**
   * Reserved for future implementation - file path for additional context.
   * Currently unused.
   */
  file?: string;
}

export class DiffRenderer {
  private format: DiffFormat;
  private color: boolean;
  private contextLines: number;

  constructor(options: DiffRendererOptions = {}) {
    this.format = options.format ?? "unified";
    this.color = options.color ?? false;
    this.contextLines = options.contextLines ?? 3;
  }

  render(input: DiffInput): string {
    switch (this.format) {
      case "side-by-side":
        return this.renderSideBySide(input);
      case "raw":
        return this.renderRaw(input);
      default:
        return this.renderUnified(input);
    }
  }

  private renderUnified(input: DiffInput): string {
    const oldLines = input.oldContent.split("\n");
    const newLines = input.newContent.split("\n");
    const hunks = this.computeHunks(oldLines, newLines);

    const lines: string[] = [];
    lines.push(`--- ${input.oldLabel ?? "a/file"}`);
    lines.push(`+++ ${input.newLabel ?? "b/file"}`);

    for (const hunk of hunks) {
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);

      for (const line of hunk.lines) {
        const prefix = line.type === "add" ? "+" : line.type === "delete" ? "-" : " ";
        const content = this.color ? this.colorize(line.content, line.type) : line.content;
        lines.push(prefix + content);
      }
    }

    return lines.join("\n");
  }

  private renderSideBySide(input: DiffInput): string {
    const oldLines = input.oldContent.split("\n");
    const newLines = input.newContent.split("\n");
    const maxLines = Math.max(oldLines.length, newLines.length);

    const lines: string[] = [];
    const maxWidth = Math.max(...oldLines.map(l => l.length), ...newLines.map(l => l.length), 20);

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] ?? "";
      const newLine = newLines[i] ?? "";
      const isOldDeleted = oldLine !== "" && newLine === "";
      const isNewAdded = oldLine === "" && newLine !== "";
      const hasChanged = oldLine !== newLine && oldLine !== "" && newLine !== "";

      // Determine marker and colors based on line state
      let marker = " ";
      let leftType: "add" | "delete" | "context" = "context";
      let rightType: "add" | "delete" | "context" = "context";

      if (isOldDeleted) {
        marker = "-";
        leftType = "delete";
      } else if (isNewAdded) {
        marker = "+";
        rightType = "add";
      } else if (hasChanged) {
        marker = "~";
        leftType = "delete";
        rightType = "add";
      }

      const left = oldLine.padEnd(maxWidth).slice(0, maxWidth);
      const right = newLine.padEnd(maxWidth).slice(0, maxWidth);

      if (this.color) {
        lines.push(`${this.colorize(marker, leftType)} ${this.colorize(left, leftType)} ${this.colorize("│", "context")} ${this.colorize(right, rightType)}`);
      } else {
        lines.push(`${marker} ${left} │ ${right}`);
      }
    }

    return lines.join("\n");
  }

  private renderRaw(input: DiffInput): string {
    return JSON.stringify({
      oldContent: input.oldContent,
      newContent: input.newContent,
      hunks: this.computeHunks(input.oldContent.split("\n"), input.newContent.split("\n")),
    }, null, 2);
  }

  private computeHunks(oldLines: string[], newLines: string[]) {
    const hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: { type: "context" | "add" | "delete"; content: string }[] }[] = [];

    let i = 0, j = 0;
    let hunkStart = -1;
    let oldStart = 0, newStart = 0;
    let hunkLines: { type: "context" | "add" | "delete"; content: string }[] = [];

    while (i < oldLines.length || j < newLines.length) {
      const oldMatch = i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j];
      const oldOnly = i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j]);
      const newOnly = j < newLines.length && (i >= oldLines.length || newLines[j] !== oldLines[i]);

      if (oldOnly || newOnly) {
        if (hunkStart === -1) {
          hunkStart = i;
          oldStart = i + 1;
          newStart = j + 1;
          hunkLines = [];
        }

        if (oldOnly) {
          hunkLines.push({ type: "delete", content: oldLines[i] });
          i++;
        }
        if (newOnly) {
          hunkLines.push({ type: "add", content: newLines[j] });
          j++;
        }
      } else {
        if (hunkStart !== -1) {
          hunks.push({
            oldStart,
            oldLines: hunkLines.filter(l => l.type !== "add").length,
            newStart,
            newLines: hunkLines.filter(l => l.type !== "delete").length,
            lines: hunkLines,
          });
          hunkStart = -1;
          hunkLines = [];
        }
        if (i < oldLines.length) i++;
        if (j < newLines.length) j++;
      }
    }

    if (hunkStart !== -1) {
      hunks.push({
        oldStart,
        oldLines: hunkLines.filter(l => l.type !== "add").length,
        newStart,
        newLines: hunkLines.filter(l => l.type !== "delete").length,
        lines: hunkLines,
      });
    }

    return hunks;
  }

  private colorize(text: string, type: "add" | "delete" | "context"): string {
    const colors = { add: "\x1b[32m", delete: "\x1b[31m", context: "\x1b[36m" };
    const reset = "\x1b[0m";
    return `${colors[type]}${text}${reset}`;
  }
}
