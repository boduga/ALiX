export interface ParsedHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: { type: "context" | "add" | "delete"; content: string }[];
}

export interface ParsedFile {
  oldPath: string;
  newPath: string;
  hunks: ParsedHunk[];
}

export interface ParsedPatch {
  files: ParsedFile[];
  raw: string;
  normalized: boolean;
}

export class PatchParser {
  /**
   * Parse a patch string into structured format.
   * @param patch - The patch string to parse
   * @param _format - Format type (reserved for future multi-format support: unified, context, unified_minimal)
   */
  parse(patch: string, _format: "unified" | "context" | "unified_minimal" = "unified"): ParsedPatch {
    const normalized = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");

    const files: ParsedFile[] = [];
    let currentFile: ParsedFile | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("--- ")) {
        if (currentFile) files.push(currentFile);
        currentFile = {
          oldPath: line.slice(4).replace(/^a\//, "").replace(/\t.*$/, ""),
          newPath: "",
          hunks: [],
        };
      } else if (line.startsWith("+++ ")) {
        if (currentFile) {
          currentFile.newPath = line.slice(4).replace(/^b\//, "").replace(/\t.*$/, "");
        }
      } else if (line.startsWith("@@") && currentFile) {
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          const hunk: ParsedHunk = {
            oldStart: parseInt(match[1], 10),
            oldLines: parseInt(match[2] || "1", 10),
            newStart: parseInt(match[3], 10),
            newLines: parseInt(match[4] || "1", 10),
            lines: [],
          };
          currentFile.hunks.push(hunk);
        }
      } else if (currentFile && currentFile.hunks.length > 0) {
        const hunk = currentFile.hunks[currentFile.hunks.length - 1];
        if (line.startsWith("+")) {
          hunk.lines.push({ type: "add", content: line.slice(1) });
        } else if (line.startsWith("-")) {
          hunk.lines.push({ type: "delete", content: line.slice(1) });
        } else if (line.startsWith(" ")) {
          hunk.lines.push({ type: "context", content: line.slice(1) });
        }
      }
    }

    if (currentFile) files.push(currentFile);

    return { files, raw: patch, normalized: patch !== normalized };
  }

  /**
   * Serialize a parsed patch back to unified format.
   * @param patch - The parsed patch structure
   * @param _format - Format type (reserved for future multi-format support)
   */
  serialize(patch: ParsedPatch, _format: "unified" = "unified"): string {
    const lines: string[] = [];

    for (const file of patch.files) {
      lines.push(`--- a/${file.oldPath}`);
      lines.push(`+++ b/${file.newPath}`);

      for (const hunk of file.hunks) {
        const range = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
        lines.push(range);

        for (const line of hunk.lines) {
          switch (line.type) {
            case "add": lines.push("+" + line.content); break;
            case "delete": lines.push("-" + line.content); break;
            case "context": lines.push(" " + line.content); break;
          }
        }
      }
    }

    return lines.join("\n");
  }
}