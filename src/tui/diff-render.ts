// src/tui/diff-render.ts
import { moveToLine, clearToEndOfLine, clearLine } from "./ansi.js";

export type DiffOp =
  | { type: "keep" }
  | { type: "replace"; lineIndex: number; line: string }
  | { type: "insert"; lineIndex: number; line: string }
  | { type: "delete"; lineIndex: number };

/**
 * Compute a line-level diff between prev and next.
 * Uses LCS (longest common subsequence) to find minimal operations.
 */
export function diffLines(prev: string, next: string): DiffOp[] {
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");

  const m = prevLines.length;
  const n = nextLines.length;

  // Special case: empty prev (all inserts) - also handle single empty line case
  if (m === 0 || (m === 1 && prevLines[0] === "" && n > 0)) {
    return nextLines.map((line, idx) => ({ type: "insert", lineIndex: idx, line }));
  }

  // Special case: empty next (all deletes) - also handle single empty line case
  if (n === 0 || (n === 1 && nextLines[0] === "" && m > 0)) {
    return prevLines.map((_, idx) => ({ type: "delete", lineIndex: idx }));
  }

  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (prevLines[i - 1] === nextLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build operations (emitted in reverse)
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && prevLines[i - 1] === nextLines[j - 1]) {
      ops.push({ type: "keep" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      ops.push({ type: "insert", lineIndex: j - 1, line: nextLines[j - 1] });
      j--;
    } else if (i > 0) {
      ops.push({ type: "delete", lineIndex: i - 1 });
      i--;
    }
  }

  // Separate paired ops (delete+insert at same lineIndex) from unpaired
  const paired = new Map<number, { delete?: DiffOp; insert?: DiffOp }>();
  const unpaired: DiffOp[] = [];

  for (const op of ops.reverse()) {
    if (op.type === "delete") {
      if (!paired.has(op.lineIndex)) {
        paired.set(op.lineIndex, {});
      }
      paired.get(op.lineIndex)!.delete = op;
    } else if (op.type === "insert") {
      if (!paired.has(op.lineIndex)) {
        paired.set(op.lineIndex, {});
      }
      paired.get(op.lineIndex)!.insert = op;
    } else if (op.type === "keep") {
      // Skip keeps
    } else {
      unpaired.push(op);
    }
  }

  // Build result with paired ops converted to replace
  const result: DiffOp[] = [...unpaired];
  for (const [lineIdx, pair] of paired) {
    if (pair.delete && pair.insert) {
      result.push({ type: "replace", lineIndex: lineIdx, line: (pair.insert as { line: string }).line });
    } else if (pair.delete) {
      result.push(pair.delete);
    } else if (pair.insert) {
      result.push(pair.insert);
    }
  }

  // Sort by lineIndex for proper rendering order
  result.sort((a, b) => {
    if (a.type === "keep" || b.type === "keep") return 0;
    return (a as { lineIndex: number }).lineIndex - (b as { lineIndex: number }).lineIndex;
  });

  return result;
}

/**
 * Render a diff by emitting minimal ANSI escape sequences.
 * Only changed lines are updated; unchanged lines are left alone.
 */
export function renderDiff(
  prev: string,
  next: string,
  stream: NodeJS.WriteStream = process.stdout
): void {
  const ops = diffLines(prev, next);
  if (ops.length === 0) return;

  for (const op of ops) {
    switch (op.type) {
      case "keep":
        break;
      case "replace":
        stream.write(moveToLine(op.lineIndex));
        stream.write(clearToEndOfLine());
        stream.write(op.line);
        break;
      case "insert":
        stream.write(moveToLine(op.lineIndex));
        stream.write(clearToEndOfLine());
        stream.write(op.line + "\n");
        break;
      case "delete":
        stream.write(moveToLine(op.lineIndex));
        stream.write(clearLine());
        break;
    }
  }
}