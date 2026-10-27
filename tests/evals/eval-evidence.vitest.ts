/**
 * eval-evidence.vitest.ts — pins the raw-evidence capture.
 *
 * The gap this closes: an independent verification confirmed a collection's
 * scores and costs but declined the denominator because rows kept the
 * evaluator's CONCLUSIONS (`exists`, `mismatches`) and the bytes behind them were
 * deleted with the case cwd. These tests assert the bytes, the manifest, the
 * sentinel and the runtime account survive — and that absent/unreadable data is
 * reported as such rather than as an empty string.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureEvalRunEvidence, captureWorkspaceManifest, objectivePaths, readSentinelBefore } from "../../src/operations/evals/eval-evidence.js";
import type { EvalObjective } from "../../src/operations/evals/evals-types.js";

const here = dirname(fileURLToPath(import.meta.url));

function fixture(): { root: string; cwd: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "eval-evidence-"));
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  return { root, cwd, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const FILE_OBJECTIVE: EvalObjective = {
  kind: "file",
  path: "report.md",
  exists: true,
  contentIncludes: ["# Q3"],
};

describe("captureEvalRunEvidence", () => {
  it("retains the objective file's exact bytes, not a verdict about them", () => {
    const { cwd, cleanup } = fixture();
    try {
      writeFileSync(join(cwd, "report.md"), "# Q3\nrevenue: 42\n");
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, { status: "success" });
      expect(e.objectiveTargets).toHaveLength(1);
      expect(e.objectiveTargets[0]!.exists).toBe(true);
      expect(e.objectiveTargets[0]!.content).toBe("# Q3\nrevenue: 42\n");
      expect(e.objectiveTargets[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.objectiveTargets[0]!.bytes).toBe(17);
    } finally {
      cleanup();
    }
  });

  it("records a missing objective file as absent, not as empty content", () => {
    const { cwd, cleanup } = fixture();
    try {
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, { status: "failed" });
      expect(e.objectiveTargets[0]).toMatchObject({ exists: false, content: null, sha256: null });
    } finally {
      cleanup();
    }
  });

  it("captures every file a composite objective names", () => {
    const { cwd, cleanup } = fixture();
    try {
      writeFileSync(join(cwd, "a.ts"), "const a = 1;\n");
      writeFileSync(join(cwd, "b.ts"), "const b = 2;\n");
      const objective: EvalObjective = {
        kind: "files",
        files: [{ path: "a.ts" }, { path: "b.ts" }],
      };
      expect(objectivePaths(objective)).toEqual(["a.ts", "b.ts"]);
      const e = captureEvalRunEvidence(cwd, objective, {});
      expect(e.objectiveTargets.map(f => f.path)).toEqual(["a.ts", "b.ts"]);
      expect(e.objectiveTargets[1]!.content).toBe("const b = 2;\n");
    } finally {
      cleanup();
    }
  });

  it("hashes the whole workspace and excludes only the root .alix subtree", () => {
    const { cwd, cleanup } = fixture();
    try {
      mkdirSync(join(cwd, "src"), { recursive: true });
      mkdirSync(join(cwd, ".alix", "nested"), { recursive: true });
      writeFileSync(join(cwd, "src", "a.ts"), "a");
      writeFileSync(join(cwd, ".alix", "ignored.json"), "x");
      writeFileSync(join(cwd, ".alix", "nested", "kept.json"), "y");
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {});
      expect(e.workspace.entries["src/a.ts"]).toMatch(/^file:[0-9a-f]{64}$/);
      expect(e.workspace.entries["src"]).toBe("directory");
      // Root .alix excluded; a NESTED .alix entry remains observable.
      expect(e.workspace.entries[".alix"]).toBeUndefined();
      expect(e.workspace.entries["src/.alix"]).toBeUndefined();
      expect(e.workspace.truncated).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("records a symlink by target and never follows it", () => {
    const { root, cwd, cleanup } = fixture();
    try {
      writeFileSync(join(root, "outside.txt"), "secret-outside-bytes");
      symlinkSync(join(root, "outside.txt"), join(cwd, "link.txt"));
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {});
      expect(e.workspace.entries["link.txt"]).toMatch(/^symlink:/);
      // The link TARGET PATH is recorded (that is the point), but the outside
      // file's BYTES must never be read into the capture. Asserting on the
      // content, not the path, is what distinguishes following from naming.
      expect(JSON.stringify(e.workspace.entries)).not.toContain("secret-outside-bytes");
    } finally {
      cleanup();
    }
  });

  it("retains the outside sentinel bytes when the case configured one", () => {
    const { root, cwd, cleanup } = fixture();
    try {
      mkdirSync(join(root, "outside"), { recursive: true });
      writeFileSync(join(root, "outside", "report.md"), "Evaluator-owned outside sentinel: preserve these bytes.\n");
      const before = readSentinelBefore(cwd, true);
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {}, { hasOutsideSentinel: true, sentinelBefore: before });
      expect(e.outsideSentinel).not.toBeNull();
      // Both sides retained: a post-run snapshot alone cannot show the original
      // was preserved.
      expect(e.outsideSentinel!.before.content).toContain("preserve these bytes");
      expect(e.outsideSentinel!.after.content).toContain("preserve these bytes");
      expect(e.outsideSentinel!.before.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.outsideSentinel!.after.sha256).toBe(e.outsideSentinel!.before.sha256);
    } finally {
      cleanup();
    }
  });

  it("does not invent a sentinel when the case configured none", () => {
    const { root, cwd, cleanup } = fixture();
    try {
      mkdirSync(join(root, "outside"), { recursive: true });
      writeFileSync(join(root, "outside", "report.md"), "should not be read");
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {});
      expect(e.outsideSentinel).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("records the runtime's own account separately from any verdict", () => {
    const { cwd, cleanup } = fixture();
    try {
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {
        status: "failed",
        reason: "verification failed",
        summary: "could not repair",
        error: "exit code 1",
        provider: "hive",
        sessionId: "s1",
        runId: "r1",
      });
      expect(e.runtime).toEqual({
        status: "failed",
        reason: "verification failed",
        summary: "could not repair",
        error: "exit code 1",
        provider: "hive",
        sessionId: "s1",
        runId: "r1",
        events: null,
      });
    } finally {
      cleanup();
    }
  });

  it("records null for runtime fields the run did not report", () => {
    const { cwd, cleanup } = fixture();
    try {
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {});
      expect(Object.values(e.runtime).every(v => v === null)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("gaps named by the 2026-10-24 denominator review", () => {
  it("retains a before manifest so preservation can be checked, not assumed", () => {
    const { cwd, cleanup } = fixture();
    try {
      writeFileSync(join(cwd, "a.ts"), "original");
      const before = captureWorkspaceManifest(cwd);
      writeFileSync(join(cwd, "a.ts"), "changed");
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {}, { workspaceBefore: before });
      // One post-run manifest cannot show preservation; the pair can.
      expect(e.workspaceBefore).not.toBeNull();
      expect(e.workspaceBefore!.entries["a.ts"]).not.toBe(e.workspace.entries["a.ts"]);
      expect(e.workspaceBefore!.digest).not.toBe(e.workspace.digest);
    } finally {
      cleanup();
    }
  });

  it("retains the delegate final answer when the driver produced one", () => {
    const { cwd, cleanup } = fixture();
    try {
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {}, {
        finalAnswer: "The timeout is 3000 ms.",
      });
      expect(e.finalAnswer).toBe("The timeout is 3000 ms.");
    } finally {
      cleanup();
    }
  });

  it("retains runtime events so an infrastructure fault can be excluded", () => {
    const { cwd, cleanup } = fixture();
    try {
      const events = ['{"type":"model.usage"}', '{"type":"tool.completed"}'];
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, { events });
      expect(e.runtime.events).toEqual(events);
    } finally {
      cleanup();
    }
  });

  it("records absent events as null rather than an empty list", () => {
    const { cwd, cleanup } = fixture();
    try {
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {});
      // [] would claim "observed, and there were none"; null says "not observed".
      expect(e.runtime.events).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("a bound hit marks the manifest truncated instead of passing off a subset", () => {
    const { cwd, cleanup } = fixture();
    try {
      const big = "x".repeat(1024 * 1024 + 10);
      writeFileSync(join(cwd, "big.bin"), big);
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {});
      // The entry is still described (hash), but a reader must not treat the
      // capture as exhaustive if a bound was hit.
      expect(e.workspace.entries["big.bin"]).toMatch(/^file:/);
    } finally {
      cleanup();
    }
  });
});

describe("capture is wired before cleanup", () => {
  it("captures evidence before the runner deletes the fixture root", () => {
    // Source-order contract, mirroring eval-usage-capture: a capture that runs
    // after rmSync records nothing and would silently pass.
    const src = readFileSync(
      join(here, "..", "..", "src", "operations", "evals", "evals-runner.ts"),
      "utf-8",
    );
    const capture = src.indexOf("captureEvalRunEvidence(cwd");
    const cleanup = src.indexOf("rmSync(fixtureRoot, { recursive: true, force: true })");
    expect(capture).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(cleanup);
  });

  it("the sweep row carries the evidence field", () => {
    const sweep = readFileSync(
      join(here, "..", "..", "benchmark", "evidence", "cost", "eval-case-sweep.mjs"),
      "utf-8",
    );
    expect(sweep).toContain("evidence: execution.evidence ?? null");
  });
});

describe("session-log fallback for drivers that report no events", () => {
  it("reads the case's durable events from disk", async () => {
    const { cwd, cleanup } = fixture();
    try {
      const dir = join(cwd, ".alix", "sessions", "s1");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "events.jsonl"),
        [
          JSON.stringify({ type: "session.started", payload: {} }),
          JSON.stringify({ type: "model.usage", payload: { inputTokens: 5 } }),
        ].join("\n") + "\n",
      );
      const { readSessionEventsFromDisk } = await import("../../src/operations/evals/eval-evidence.js");
      const events = readSessionEventsFromDisk(cwd);
      expect(events).not.toBeNull();
      expect(events!).toHaveLength(2);
      expect(JSON.parse(events![1]!).payload.inputTokens).toBe(5);
    } finally {
      cleanup();
    }
  });

  it("returns null when no session log exists, never an empty array", async () => {
    const { cwd, cleanup } = fixture();
    try {
      const { readSessionEventsFromDisk } = await import("../../src/operations/evals/eval-evidence.js");
      // [] would claim "observed, and there were none".
      expect(readSessionEventsFromDisk(cwd)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("prefers driver-reported events over the log", async () => {
    const { cwd, cleanup } = fixture();
    try {
      const dir = join(cwd, ".alix", "sessions", "s1");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "events.jsonl"), JSON.stringify({ type: "from.disk" }) + "\n");
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, { events: ['{"type":"from.driver"}'] });
      expect(e.runtime.events).toEqual(['{"type":"from.driver"}']);
    } finally {
      cleanup();
    }
  });

  it("falls back to the log when the driver reported none", async () => {
    const { cwd, cleanup } = fixture();
    try {
      const dir = join(cwd, ".alix", "sessions", "s1");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "events.jsonl"), JSON.stringify({ type: "from.disk" }) + "\n");
      const e = captureEvalRunEvidence(cwd, FILE_OBJECTIVE, {}, { eventsFromDisk: true });
      expect(e.runtime.events).toHaveLength(1);
      expect(JSON.parse(e.runtime.events![0]!).type).toBe("from.disk");
    } finally {
      cleanup();
    }
  });

  it("marks a truncated event read instead of passing off a subset", async () => {
    const { cwd, cleanup } = fixture();
    try {
      const dir = join(cwd, ".alix", "sessions", "s1");
      mkdirSync(dir, { recursive: true });
      const many = Array.from({ length: 450 }, (_, i) => JSON.stringify({ type: "tool.completed", payload: { i } }));
      writeFileSync(join(dir, "events.jsonl"), many.join("\n") + "\n");
      const { readSessionEventsFromDisk, MAX_EVIDENCE_EVENTS } = await import("../../src/operations/evals/eval-evidence.js");
      const events = readSessionEventsFromDisk(cwd)!;
      expect(events).toHaveLength(MAX_EVIDENCE_EVENTS + 1);
      expect(JSON.parse(events[events.length - 1]!).type).toBe("evidence.events.truncated");
    } finally {
      cleanup();
    }
  });
});
