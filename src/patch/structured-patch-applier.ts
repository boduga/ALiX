import { PatchParser, ParsedHunk } from "./patch-parser.js";

export interface ApplyResult {
  success: boolean;
  content?: string;
  hunksApplied: number;
  hunksTotal: number;
  conflicts?: { line: number; expected: string; actual: string }[];
  error?: string;
}

export interface StructuredPatchApplierOptions {
  strict?: boolean;
  allowFuzz?: boolean;
  fuzzFactor?: number;
}

export class StructuredPatchApplier {
  private parser: PatchParser;
  private strict: boolean;
  private allowFuzz: boolean;
  private fuzzFactor: number;

  constructor(options: StructuredPatchApplierOptions = {}) {
    this.parser = new PatchParser();
    this.strict = options.strict ?? true;
    this.allowFuzz = options.allowFuzz ?? false;
    this.fuzzFactor = options.fuzzFactor ?? 0.5;
  }

  apply(original: string, patch: string): ApplyResult {
    const parsed = this.parser.parse(patch);

    if (parsed.files.length === 0) {
      return { success: false, hunksApplied: 0, hunksTotal: 0, error: "No files in patch" };
    }

    const originalLines = original.split("\n");
    let result = [...originalLines];
    let hunksApplied = 0;
    const conflicts: ApplyResult["conflicts"] = [];

    for (const file of parsed.files) {
      for (const hunk of file.hunks) {
        const applyResult = this.applyHunk(result, hunk);

        if (applyResult.conflict) {
          if (this.strict) {
            return {
              success: false,
              hunksApplied,
              hunksTotal: parsed.files.reduce((sum, f) => sum + f.hunks.length, 0),
              conflicts: [...conflicts, ...applyResult.conflicts!],
              error: "Patch conflicts detected",
            };
          }
          conflicts.push(...(applyResult.conflicts ?? []));
        } else {
          hunksApplied++;
          result = applyResult.result ?? result;
        }
      }
    }

    return {
      success: true,
      content: result.join("\n"),
      hunksApplied,
      hunksTotal: parsed.files.reduce((sum, f) => sum + f.hunks.length, 0),
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    };
  }

  private applyHunk(
    lines: string[],
    hunk: ParsedHunk
  ): { result?: string[]; conflict?: boolean; conflicts?: ApplyResult["conflicts"] } {
    // Find leading context length
    let leadingContext = 0;
    for (const line of hunk.lines) {
      if (line.type === "context") leadingContext++;
      else break;
    }

    // Find trailing context length
    let trailingContext = 0;
    for (let i = hunk.lines.length - 1; i >= 0; i--) {
      if (hunk.lines[i].type === "context") trailingContext++;
      else break;
    }

    // Find position where leading context matches in source
    let matchStart = -1;
    const contextLines = hunk.lines.slice(0, leadingContext);
    if (contextLines.length > 0) {
      for (let i = 0; i <= Math.max(0, lines.length - leadingContext); i++) {
        let matches = true;
        for (let j = 0; j < contextLines.length; j++) {
          if (lines[i + j] !== contextLines[j].content) {
            matches = false;
            break;
          }
        }
        if (matches) {
          matchStart = i;
          break;
        }
      }
    } else {
      // No leading context, try to match from oldStart position
      matchStart = Math.max(0, hunk.oldStart - 1);
    }

    if (matchStart === -1) {
      const expected = contextLines[0]?.content ?? hunk.lines[0]?.content ?? "MISSING";
      return {
        conflict: true,
        conflicts: [{ line: hunk.oldStart, expected, actual: lines[hunk.oldStart - 1] ?? "MISSING" }],
      };
    }

    // Build result array
    const result: string[] = [];
    let lineIdx = matchStart;  // Start at match position in source
    let hunkIdx = 0;

    // Copy lines before the match position (lines we won't touch)
    for (let i = 0; i < matchStart; i++) {
      result.push(lines[i]);
    }

    // Add leading context lines (they are matched but not in result yet when matchStart=0)
    if (matchStart === 0 && leadingContext > 0) {
      for (let i = 0; i < leadingContext; i++) {
        result.push(hunk.lines[i].content);
      }
    }

    // Skip leading context in hunk, advance lineIdx past leading context in source
    hunkIdx = leadingContext;
    lineIdx = matchStart + leadingContext;  // Move past the matched leading context
    while (hunkIdx < hunk.lines.length - trailingContext) {
      const hunkLine = hunk.lines[hunkIdx];

      if (hunkLine.type === "delete") {
        // Skip the line in source
        if (lines[lineIdx] !== hunkLine.content) {
          return {
            conflict: true,
            conflicts: [{ line: lineIdx + 1, expected: hunkLine.content, actual: lines[lineIdx] ?? "MISSING" }],
          };
        }
        lineIdx++;
        hunkIdx++;
      } else if (hunkLine.type === "add") {
        // Insert the new line
        result.push(hunkLine.content);
        hunkIdx++;
      } else {
        // Context line - verify match
        if (lines[lineIdx] !== hunkLine.content) {
          return {
            conflict: true,
            conflicts: [{ line: lineIdx + 1, expected: hunkLine.content, actual: lines[lineIdx] ?? "MISSING" }],
          };
        }
        result.push(hunkLine.content);
        lineIdx++;
        hunkIdx++;
      }
    }

    // Skip trailing context in hunk and continue copying from source
    hunkIdx = hunk.lines.length - trailingContext;

    // Copy remaining source lines
    while (lineIdx < lines.length) {
      result.push(lines[lineIdx]);
      lineIdx++;
    }

    return { result };
  }
}