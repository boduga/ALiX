/**
 * objective-evaluator.vitest.ts — Phase 2 self-tests for the filesystem
 * objective evaluator (§25 test matrix).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateObjective, ObjectivePathEscapeError, resolveObjectivePath } from "../../src/operations/evals/evaluators/objective-evaluator.js";
import type { EvalObjective } from "../../src/operations/evals/evals-types.js";

function makeCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-obj-"));
  return dir;
}

describe("objective-evaluator — file objective", () => {
  it("file exists → landed", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "report.md"), "# Q3\nrevenue: 42\n");
    const r = evaluateObjective(cwd, { kind: "file", path: "report.md", exists: true } as EvalObjective);
    expect(r.landed).toBe(true);
    expect(r.evidence.exists).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("file missing → not landed", () => {
    const cwd = makeCwd();
    const r = evaluateObjective(cwd, { kind: "file", path: "report.md", exists: true } as EvalObjective);
    expect(r.landed).toBe(false);
    expect(r.evidence.mismatches).toContain("file missing: report.md");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("content includes all expected → landed", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "a.md"), "# Q3\nrevenue: 42\n");
    const r = evaluateObjective(cwd, { kind: "file", path: "a.md", exists: true, contentIncludes: ["# Q3", "revenue: 42"] });
    expect(r.landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("content missing one expected value → not landed with mismatch", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "a.md"), "# Q3\n");
    const r = evaluateObjective(cwd, { kind: "file", path: "a.md", exists: true, contentIncludes: ["# Q3", "revenue: 42"] });
    expect(r.landed).toBe(false);
    expect(r.evidence.mismatches).toContain("missing expected content: revenue: 42");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("content equals expected → landed", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "a.md"), "exact");
    const r = evaluateObjective(cwd, { kind: "file", path: "a.md", exists: true, contentEquals: "exact" });
    expect(r.landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("objective-evaluator — patch / replacement", () => {
  it("patch landed when expected content present", () => {
    const cwd = makeCwd();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "util.ts"), "const NEW = 1;\n");
    const r = evaluateObjective(cwd, { kind: "patch", path: "src/util.ts", expectedContent: "const NEW = 1;" });
    expect(r.landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("patch not landed when content absent", () => {
    const cwd = makeCwd();
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "src", "util.ts"), "const OLD = 1;\n");
    const r = evaluateObjective(cwd, { kind: "patch", path: "src/util.ts", expectedContent: "const NEW = 1;" });
    expect(r.landed).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("replacement landed when block present", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "x.ts"), "block: HELLO");
    const r = evaluateObjective(cwd, { kind: "replacement", path: "x.ts", expectedContent: "HELLO" });
    expect(r.landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("replacement not landed when block missing", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "x.ts"), "block: GOODBYE");
    const r = evaluateObjective(cwd, { kind: "replacement", path: "x.ts", expectedContent: "HELLO" });
    expect(r.landed).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("objective-evaluator — unchanged", () => {
  it("unchanged file present → landed", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "keep.txt"), "data");
    const r = evaluateObjective(cwd, { kind: "unchanged", path: "keep.txt" });
    expect(r.landed).toBe(true);
    expect(r.evidence.changed).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("unchanged file missing → not landed", () => {
    const cwd = makeCwd();
    const r = evaluateObjective(cwd, { kind: "unchanged", path: "keep.txt" });
    expect(r.landed).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("contentEquals rejects a REWRITTEN file that still exists", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "keep.txt"), "changed");
    const r = evaluateObjective(cwd, {
      kind: "unchanged",
      path: "keep.txt",
      contentEquals: "original",
    } as EvalObjective);
    expect(r.landed).toBe(false);
    expect(r.evidence.exists).toBe(true);
    expect(r.evidence.mismatches?.some(m => m.includes("content mismatch"))).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("unchanged map rejects a rewritten NEIGHBOUR while the named file stays intact", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "keep.txt"), "original");
    writeFileSync(join(cwd, "neighbour.txt"), "rewritten");
    const r = evaluateObjective(cwd, {
      kind: "unchanged",
      path: "keep.txt",
      contentEquals: "original",
      unchanged: { "neighbour.txt": "original" },
    } as EvalObjective);
    expect(r.landed).toBe(false);
    expect(r.evidence.mismatches?.some(m => m.startsWith("neighbour.txt:"))).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("answerIncludes requires the report to state the answer", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "keep.txt"), "original");
    const objective = {
      kind: "unchanged",
      path: "keep.txt",
      answerIncludes: ["kestrel-9"],
    } as EvalObjective;
    expect(evaluateObjective(cwd, objective, { summary: "I could not find it." }).landed).toBe(false);
    expect(evaluateObjective(cwd, objective, { summary: "The value is kestrel-9." }).landed).toBe(true);
    // Case-insensitive: a report must not fail on capitalisation alone.
    expect(evaluateObjective(cwd, objective, { summary: "Value: KESTREL-9" }).landed).toBe(true);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("objective-evaluator — path containment", () => {
  it("rejects path escaping cwd via ..", () => {
    const cwd = makeCwd();
    expect(() => resolveObjectivePath(cwd, "../escape.txt")).toThrow(ObjectivePathEscapeError);
    expect(() => evaluateObjective(cwd, { kind: "file", path: "../escape.txt", exists: true })).toThrow(ObjectivePathEscapeError);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("rejects absolute path outside cwd", () => {
    const cwd = makeCwd();
    const outside = join(tmpdir(), "somewhere-else.txt");
    expect(() => resolveObjectivePath(cwd, outside)).toThrow(ObjectivePathEscapeError);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("allows path inside cwd and absolute path inside cwd", () => {
    const cwd = makeCwd();
    writeFileSync(join(cwd, "inner.txt"), "x");
    expect(resolveObjectivePath(cwd, "inner.txt")).toBe(join(cwd, "inner.txt"));
    expect(resolveObjectivePath(cwd, join(cwd, "inner.txt"))).toBe(join(cwd, "inner.txt"));
    rmSync(cwd, { recursive: true, force: true });
  });
});
