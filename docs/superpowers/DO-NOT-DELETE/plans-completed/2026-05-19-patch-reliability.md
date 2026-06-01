# Patch Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement patch reliability components for edit format selection, parsing, applying, and rollback

**Architecture:** EditFormatSelector chooses diff strategy, PatchParser handles format conversion, StructuredPatchApplier applies changes safely, RollbackManager handles recovery.

**Tech Stack:** TypeScript, unified/diff libraries, AST parsing

---

## Patch Reliability Components

### Task 1: EditFormatSelector

**Files:**
- Create: `src/patch/edit-format-selector.ts`
- Create: `tests/patch/edit-format-selector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/patch/edit-format-selector.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { EditFormatSelector } from "../../src/patch/edit-format-selector.js";

describe("EditFormatSelector", () => {
  it("selects unified diff for simple line changes", () => {
    const selector = new EditFormatSelector();
    const format = selector.select({
      fileType: "ts",
      changeType: "replace_lines",
      contextLines: 3,
    });
    assert.equal(format, "unified");
  });

  it("selects structured for language-aware edits", () => {
    const selector = new EditFormatSelector();
    const format = selector.select({
      fileType: "ts",
      changeType: "replace_function",
      contextLines: 5,
    });
    assert.equal(format, "structured");
  });

  it("selects search-replace for pattern-based edits", () => {
    const selector = new EditFormatSelector();
    const format = selector.select({
      fileType: "json",
      changeType: "replace_value",
      contextLines: 1,
    });
    assert.equal(format, "search_replace");
  });

  it("considers file type for format selection", () => {
    const selector = new EditFormatSelector();
    const tsFormat = selector.select({ fileType: "ts", changeType: "any", contextLines: 3 });
    const jsonFormat = selector.select({ fileType: "json", changeType: "any", contextLines: 3 });
    assert.notEqual(tsFormat, jsonFormat);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/patch/edit-format-selector.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement EditFormatSelector**

```typescript
// src/patch/edit-format-selector.ts
export type EditFormat = "unified" | "context" | "unified_minimal" | "structured" | "search_replace";

export interface EditFormatSelectorOptions {
  fileType?: string;
  changeType?: "any" | "replace_lines" | "replace_function" | "replace_value" | "insert" | "delete";
  contextLines?: number;
  preferStructured?: boolean;
}

export interface FormatSelection {
  format: EditFormat;
  confidence: number;
  reasoning: string;
}

export class EditFormatSelector {
  private preferStructured: boolean;

  constructor(options: { preferStructured?: boolean } = {}) {
    this.preferStructured = options.preferStructured ?? false;
  }

  select(options: EditFormatSelectorOptions): EditFormat {
    const { fileType, changeType, contextLines = 3 } = options;
    
    if (this.preferStructured && this.canUseStructured(fileType, changeType)) {
      return "structured";
    }

    if (this.isStructuredLanguage(fileType) && changeType === "replace_function") {
      return "structured";
    }

    if (this.isDataFile(fileType)) {
      return "search_replace";
    }

    if (changeType === "replace_lines" && contextLines >= 3) {
      return "unified";
    }

    if (changeType === "delete" || changeType === "insert") {
      return "context";
    }

    return "unified";
  }

  selectWithConfidence(options: EditFormatSelectorOptions): FormatSelection {
    const format = this.select(options);
    
    let confidence = 0.8;
    let reasoning = "Default selection";
    
    if (this.isStructuredLanguage(options.fileType) && format === "structured") {
      confidence = 0.95;
      reasoning = "Language-aware parsing available for this file type";
    } else if (this.isDataFile(options.fileType) && format === "search_replace") {
      confidence = 0.9;
      reasoning = "Data file format benefits from pattern-based edits";
    }
    
    return { format, confidence, reasoning };
  }

  private canUseStructured(fileType: string | undefined, changeType: string | undefined): boolean {
    if (!fileType) return false;
    return ["ts", "tsx", "js", "jsx", "py", "go", "java"].includes(fileType);
  }

  private isStructuredLanguage(fileType: string | undefined): boolean {
    if (!fileType) return false;
    return ["ts", "tsx", "js", "jsx", "py", "go", "java", "cs", "rb"].includes(fileType);
  }

  private isDataFile(fileType: string | undefined): boolean {
    if (!fileType) return false;
    return ["json", "yaml", "yml", "toml", "xml", "env"].includes(fileType);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/patch/edit-format-selector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/edit-format-selector.ts tests/patch/edit-format-selector.test.ts
git commit -m "feat(patch-reliability): add EditFormatSelector for diff strategy selection"
```

---

### Task 2: PatchParser

**Files:**
- Create: `src/patch/patch-parser.ts`
- Create: `tests/patch/patch-parser.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/patch/patch-parser.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { PatchParser } from "../../src/patch/patch-parser.js";

describe("PatchParser", () => {
  it("parses unified diff format", () => {
    const parser = new PatchParser();
    const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 3;`;
    
    const parsed = parser.parse(patch, "unified");
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].hunks.length, 1);
  });

  it("normalizes line endings", () => {
    const parser = new PatchParser();
    const patch = "line1\r\nline2\r\nline3";
    const parsed = parser.parse(patch, "unified");
    assert.ok(!parsed.raw.includes("\r"));
  });

  it("extracts metadata from patch header", () => {
    const parser = new PatchParser();
    const patch = `--- a/src/main.ts
+++ b/src/main.ts
@@ -5,7 +5,7 @@
 function test() {`;
    
    const parsed = parser.parse(patch, "unified");
    assert.equal(parsed.files[0].oldPath, "src/main.ts");
    assert.equal(parsed.files[0].newPath, "src/main.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/patch/patch-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement PatchParser**

```typescript
// src/patch/patch-parser.ts
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
  parse(patch: string, format: "unified" | "context" | "unified_minimal" = "unified"): ParsedPatch {
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

  serialize(patch: ParsedPatch, format: "unified" = "unified"): string {
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/patch/patch-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/patch-parser.ts tests/patch/patch-parser.test.ts
git commit -m "feat(patch-reliability): add PatchParser for diff format handling"
```

---

### Task 3: StructuredPatchApplier

**Files:**
- Create: `src/patch/structured-patch-applier.ts`
- Create: `tests/patch/structured-patch-applier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/patch/structured-patch-applier.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { StructuredPatchApplier } from "../../src/patch/structured-patch-applier.js";

describe("StructuredPatchApplier", () => {
  it("applies valid unified diff", () => {
    const applier = new StructuredPatchApplier();
    const original = "line1\nline2\nline3\n";
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
`;
    
    const result = applier.apply(original, patch);
    assert.ok(result.success);
    assert.equal(result.content, "line1\nmodified\nline3\n");
  });

  it("rejects patch with conflicts", () => {
    const applier = new StructuredPatchApplier({ strict: true });
    const original = "line1\nline2\nline3\n";
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-line0
+something
 line1
`;
    
    const result = applier.apply(original, patch);
    assert.ok(!result.success);
    assert.ok(result.conflicts);
  });

  it("reports applied hunk count", () => {
    const applier = new StructuredPatchApplier();
    const original = "a\nb\nc\nd\ne\n";
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-a
+one
 b
 c
@@ -4,2 +4,2 @@
-d
+four
 e
`;
    
    const result = applier.apply(original, patch);
    assert.ok(result.success);
    assert.equal(result.hunksApplied, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/patch/structured-patch-applier.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement StructuredPatchApplier**

```typescript
// src/patch/structured-patch-applier.ts
import { PatchParser } from "./patch-parser.js";

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
              conflicts: [...conflicts, ...applyResult.conflicts],
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
    hunk: import("./patch-parser.js").ParsedHunk
  ): { result?: string[]; conflict?: boolean; conflicts?: ApplyResult["conflicts"] } {
    const startIndex = hunk.oldStart - 1;
    const contextBefore = 3;
    
    let contextStart = Math.max(0, startIndex - contextBefore);
    let contextEnd = Math.min(lines.length, startIndex + hunk.oldLines + contextBefore);
    
    let matchIndex = -1;
    for (let i = contextStart; i <= startIndex; i++) {
      const contextMatch = this.matchContext(lines, hunk.lines, i, "before");
      if (contextMatch >= 3) {
        matchIndex = i;
        break;
      }
    }
    
    if (matchIndex === -1 && this.allowFuzz) {
      for (let i = 0; i < lines.length; i++) {
        const fuzzMatch = this.matchContext(lines, hunk.lines, i, "any");
        if (fuzzMatch >= hunk.lines.length * this.fuzzFactor) {
          matchIndex = i;
          break;
        }
      }
    }
    
    if (matchIndex === -1) {
      const startLine = lines[startIndex] ?? "MISSING";
      const expectedLine = hunk.lines.find(l => l.type === "context")?.content ?? "MISSING";
      return {
        conflict: true,
        conflicts: [{ line: startIndex + 1, expected: expectedLine, actual: startLine }],
      };
    }
    
    const newLines: string[] = [];
    let hunkIdx = 0;
    
    for (let i = 0; i < matchIndex; i++) {
      newLines.push(lines[i]);
    }
    
    while (hunkIdx < hunk.lines.length) {
      const line = hunk.lines[hunkIdx];
      if (line.type === "context") {
        if (lines[matchIndex] !== line.content) {
          return {
            conflict: true,
            conflicts: [{ line: matchIndex + 1, expected: line.content, actual: lines[matchIndex] ?? "MISSING" }],
          };
        }
        newLines.push(line.content);
        matchIndex++;
        hunkIdx++;
      } else if (line.type === "delete") {
        if (lines[matchIndex] !== line.content) {
          return {
            conflict: true,
            conflicts: [{ line: matchIndex + 1, expected: line.content, actual: lines[matchIndex] ?? "MISSING" }],
          };
        }
        matchIndex++;
        hunkIdx++;
      } else if (line.type === "add") {
        newLines.push(line.content);
        hunkIdx++;
      }
    }
    
    while (matchIndex < lines.length) {
      newLines.push(lines[matchIndex]);
      matchIndex++;
    }
    
    return { result: newLines };
  }

  private matchContext(
    lines: string[],
    hunkLines: import("./patch-parser.js").ParsedHunk["lines"],
    startIndex: number,
    mode: "before" | "after" | "any"
  ): number {
    let matches = 0;
    let hunkIdx = 0;
    
    while (hunkIdx < hunkLines.length && hunkLines[hunkIdx].type !== "context") {
      hunkIdx++;
    }
    
    if (mode === "before" || mode === "any") {
      for (let i = 0; i < 3 && hunkIdx < hunkLines.length; i++) {
        if (lines[startIndex + i] === hunkLines[hunkIdx].content) {
          matches++;
        }
        hunkIdx++;
        while (hunkIdx < hunkLines.length && hunkLines[hunkIdx].type !== "context") {
          hunkIdx++;
        }
      }
    }
    
    return matches;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/patch/structured-patch-applier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/structured-patch-applier.ts tests/patch/structured-patch-applier.test.ts
git commit -m "feat(patch-reliability): add StructuredPatchApplier for safe diff application"
```

---

### Task 4: DiffRenderer and RollbackManager

**Files:**
- Create: `src/patch/diff-renderer.ts`
- Create: `src/patch/rollback-manager.ts`
- Create: `tests/patch/diff-renderer.test.ts`
- Create: `tests/patch/rollback-manager.test.ts`

- [ ] **Step 1: Write failing tests for DiffRenderer**

```typescript
// tests/patch/diff-renderer.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { DiffRenderer } from "../../src/patch/diff-renderer.js";

describe("DiffRenderer", () => {
  it("renders unified diff with colors", () => {
    const renderer = new DiffRenderer({ format: "unified", color: true });
    const result = renderer.render({
      oldContent: "line1\nline2\n",
      newContent: "line1\nmodified\n",
      file: "test.txt",
    });
    assert.ok(result.includes("line2"));
    assert.ok(result.includes("modified"));
  });

  it("renders side-by-side diff", () => {
    const renderer = new DiffRenderer({ format: "side-by-side" });
    const result = renderer.render({
      oldContent: "old\n",
      newContent: "new\n",
      file: "test.txt",
    });
    assert.ok(result.includes("old") && result.includes("new"));
  });

  it("highlights changed lines", () => {
    const renderer = new DiffRenderer({ format: "unified" });
    const result = renderer.render({
      oldContent: "a\nb\nc\n",
      newContent: "a\nB\nc\n",
      file: "test.txt",
    });
    assert.ok(result.includes("-") || result.includes("+"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/patch/diff-renderer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement DiffRenderer**

```typescript
// src/patch/diff-renderer.ts
export type DiffFormat = "unified" | "side-by-side" | "raw";

export interface DiffRendererOptions {
  format?: DiffFormat;
  color?: boolean;
  contextLines?: number;
}

export interface DiffInput {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
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
      const marker = oldLine !== newLine ? "│" : " ";
      
      const left = oldLine.padEnd(maxWidth).slice(0, maxWidth);
      const right = newLine.padEnd(maxWidth).slice(0, maxWidth);
      
      if (this.color) {
        lines.push(`${this.colorize(marker, "context")} ${this.colorize(left, oldLine !== newLine ? "delete" : "context")} ${this.colorize("│", "context")} ${this.colorize(right, newLine !== oldLine ? "add" : "context")}`);
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/patch/diff-renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for RollbackManager**

```typescript
// tests/patch/rollback-manager.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { RollbackManager } from "../../src/patch/rollback-manager.js";

describe("RollbackManager", () => {
  let manager: RollbackManager;

  beforeEach(() => {
    manager = new RollbackManager({ maxSnapshots: 10 });
  });

  it("saves snapshots before changes", async () => {
    await manager.snapshot("test.txt", "original content");
    const snapshot = await manager.getSnapshot("test.txt");
    assert.equal(snapshot?.content, "original content");
  });

  it("restores previous version", async () => {
    await manager.snapshot("test.txt", "version 1");
    await manager.snapshot("test.txt", "version 2");
    
    const restored = await manager.rollback("test.txt", 1);
    assert.equal(restored, "version 1");
  });

  it("prunes old snapshots beyond limit", async () => {
    for (let i = 0; i < 15; i++) {
      await manager.snapshot("test.txt", `version ${i}`);
    }
    
    const snapshots = await manager.listSnapshots("test.txt");
    assert.ok(snapshots.length <= 10);
  });

  it("clears snapshots on commit", async () => {
    await manager.snapshot("test.txt", "content");
    await manager.commit("test.txt");
    
    const snapshots = await manager.listSnapshots("test.txt");
    assert.equal(snapshots.length, 0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**
Run: `npm test -- tests/patch/rollback-manager.test.ts`
Expected: FAIL

- [ ] **Step 7: Implement RollbackManager**

```typescript
// src/patch/rollback-manager.ts
interface Snapshot {
  id: string;
  file: string;
  content: string;
  timestamp: number;
  version: number;
}

export class RollbackManager {
  private snapshots = new Map<string, Snapshot[]>();
  private maxSnapshots: number;
  private counter = 0;

  constructor(options: { maxSnapshots?: number } = {}) {
    this.maxSnapshots = options.maxSnapshots ?? 10;
  }

  async snapshot(file: string, content: string): Promise<string> {
    const id = `${file}-${++this.counter}-${Date.now()}`;
    const fileSnapshots = this.snapshots.get(file) ?? [];
    
    fileSnapshots.push({
      id,
      file,
      content,
      timestamp: Date.now(),
      version: fileSnapshots.length + 1,
    });
    
    while (fileSnapshots.length > this.maxSnapshots) {
      fileSnapshots.shift();
    }
    
    this.snapshots.set(file, fileSnapshots);
    return id;
  }

  async getSnapshot(file: string, version?: number): Promise<Snapshot | null> {
    const fileSnapshots = this.snapshots.get(file) ?? [];
    if (fileSnapshots.length === 0) return null;
    
    if (version !== undefined) {
      const targetIndex = fileSnapshots.length - version;
      return fileSnapshots[targetIndex] ?? null;
    }
    
    return fileSnapshots[fileSnapshots.length - 1];
  }

  async rollback(file: string, steps = 1): Promise<string | null> {
    const fileSnapshots = this.snapshots.get(file) ?? [];
    const targetIndex = fileSnapshots.length - steps - 1;
    
    if (targetIndex < 0) return null;
    
    return fileSnapshots[targetIndex].content;
  }

  async listSnapshots(file: string): Promise<Snapshot[]> {
    return this.snapshots.get(file) ?? [];
  }

  async commit(file: string): Promise<void> {
    this.snapshots.delete(file);
  }

  async clear(): Promise<void> {
    this.snapshots.clear();
  }

  async getMetadata(file: string): Promise<{ snapshotCount: number; oldestSnapshot?: Date; newestSnapshot?: Date } | null> {
    const fileSnapshots = this.snapshots.get(file);
    if (!fileSnapshots || fileSnapshots.length === 0) return null;
    
    return {
      snapshotCount: fileSnapshots.length,
      oldestSnapshot: new Date(fileSnapshots[0].timestamp),
      newestSnapshot: new Date(fileSnapshots[fileSnapshots.length - 1].timestamp),
    };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**
Run: `npm test -- tests/patch/rollback-manager.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/patch/diff-renderer.ts src/patch/rollback-manager.ts tests/patch/diff-renderer.test.ts tests/patch/rollback-manager.test.ts
git commit -m "feat(patch-reliability): add DiffRenderer and RollbackManager"
```

---

## Execution Options

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**