/**
 * eval-usage-capture.vitest.ts — pins that metered usage survives the eval cwd.
 *
 * The bug this guards: `runEvalCase` deletes the case cwd in a `finally`, and
 * `runTask` writes `model.usage` to `<cwd>/.alix/sessions/<id>/events.jsonl`.
 * Reading usage after cleanup is therefore impossible, and a real gpt-4o run
 * passed 2/2 while producing no cost evidence at all.
 *
 * The contract: capture happens BEFORE cleanup, an absent record is `observed:
 * false` (unknown, never a measured zero), and malformed input never throws.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEvalUsage } from "../../src/operations/evals/eval-usage.js";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

function makeCase() {
  const cwd = mkdtempSync(join(tmpdir(), "eval-usage-"));
  return cwd;
}

function writeSession(cwd: string, sessionId: string, events: unknown[]) {
  const dir = join(cwd, ".alix", "sessions", sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
}

function usageEvent(runId: string, inputTokens: number, outputTokens: number) {
  return {
    type: "model.usage",
    runId,
    payload: { provider: "openai", model: "gpt-4o", inputTokens, outputTokens },
  };
}

describe("captureEvalUsage", () => {
  it("captures a single usage record with its run id", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [usageEvent("run-abc", 3274, 38)]);
    const u = captureEvalUsage(cwd);
    expect(u.observed).toBe(true);
    expect(u.inputTokens).toBe(3274);
    expect(u.outputTokens).toBe(38);
    expect(u.records[0]!.runId).toBe("run-abc");
    expect(u.records[0]!.provider).toBe("openai");
    expect(u.records[0]!.model).toBe("gpt-4o");
    rmSync(cwd, { recursive: true, force: true });
  });

  it("sums multiple invocations of the same run", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [
      usageEvent("run-abc", 100, 10),
      usageEvent("run-abc", 200, 20),
      usageEvent("run-abc", 300, 30),
    ]);
    const u = captureEvalUsage(cwd);
    expect(u.records).toHaveLength(3);
    expect(u.inputTokens).toBe(600);
    expect(u.outputTokens).toBe(60);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports observed=false (unknown, NOT zero) when there is no usage", () => {
    // A deterministic/scripted case makes no billable call. Its cost is unknown.
    const cwd = makeCase();
    writeSession(cwd, "s1", [{ type: "session.started", payload: {} }]);
    const u = captureEvalUsage(cwd);
    expect(u.observed).toBe(false);
    expect(u.inputTokens).toBeNull();
    expect(u.outputTokens).toBeNull();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports observed=false when the session dir is absent entirely", () => {
    const cwd = makeCase();
    const u = captureEvalUsage(cwd);
    expect(u.observed).toBe(false);
    expect(u.inputTokens).toBeNull();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("skips malformed lines without discarding valid records", () => {
    const cwd = makeCase();
    const dir = join(cwd, ".alix", "sessions", "s1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      [
        JSON.stringify(usageEvent("run-abc", 50, 5)),
        "{ this is not json",
        "",
        JSON.stringify(usageEvent("run-abc", 70, 7)),
        '{"type":"model.usage","payload":{"inputTokens":1', // torn trailing write
      ].join("\n"),
    );
    const u = captureEvalUsage(cwd);
    expect(u.records).toHaveLength(2);
    expect(u.inputTokens).toBe(120);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reads across multiple session directories", () => {
    const cwd = makeCase();
    writeSession(cwd, "s1", [usageEvent("run-a", 10, 1)]);
    writeSession(cwd, "s2", [usageEvent("run-b", 20, 2)]);
    const u = captureEvalUsage(cwd);
    expect(u.records).toHaveLength(2);
    expect(u.inputTokens).toBe(30);
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("runner ordering", () => {
  it("captures usage BEFORE the cleanup that deletes the session log", () => {
    // Source-order contract: if capture ever moved after rmSync, every priced
    // run would silently lose its cost evidence again. Assert the capture call
    // precedes the cleanup in the runner source.
    const src = readFileSync(
      join(repoRoot, "src", "operations", "evals", "evals-runner.ts"),
      "utf-8",
    );
    const capture = src.indexOf("captureEvalUsage(cwd)");
    const cleanup = src.indexOf("rmSync(fixtureRoot, { recursive: true, force: true })");
    expect(capture).toBeGreaterThan(-1);
    expect(cleanup).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(cleanup);
  });
});
