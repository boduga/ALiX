import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RiskScoreStore } from "../../src/adaptation/risk-score-store.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "risk-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "risk-prop-1",
    subject: "Risk for prop-1",
    outcome: "medium",
    confidence: 0.7,
    reasons: ["evidence is moderate"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    overallRisk: 0.45,
    risks: [],
    dimensions: {
      governance: 0.3,
      operational: 0.5,
      capability: 0.4,
      revertability: 0.5,
      evidence_quality: 0.4,
    },
    sourceArtifacts: [],
    ...overrides,
  };
}

describe("RiskScoreStore: append + query", () => {
  it("appends a risk score and persists as one JSONL line", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-1" }));
    const path = join(tempRoot, ".alix", "risk-scores", "risk-scores.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("risk-1");
    expect(parsed.overallRisk).toBe(0.45);
  });

  it("get(id) returns the stored risk score", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-42", overallRisk: 0.72 }));
    const got = await store.get("risk-42");
    expect(got).not.toBeNull();
    expect(got!.overallRisk).toBe(0.72);
    expect(got!.outcome).toBe("medium");
  });

  it("get(id) returns null for an unknown id", async () => {
    const store = new RiskScoreStore();
    const got = await store.get("nonexistent");
    expect(got).toBeNull();
  });

  it("list() returns all stored risk scores", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-1" }));
    await store.append(makeScore({ id: "risk-2" }));
    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(["risk-1", "risk-2"]);
  });

  it("queryByWindow(days) returns only risk scores within the window", async () => {
    const store = new RiskScoreStore();
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    await store.append(makeScore({ id: "recent", generatedAt: tenDaysAgo.toISOString() }));
    await store.append(makeScore({ id: "old", generatedAt: fortyDaysAgo.toISOString() }));
    const inWindow = await store.queryByWindow(30);
    expect(inWindow.map((r) => r.id)).toEqual(["recent"]);
  });
});

describe("RiskScoreStore: append-only + no source mutation", () => {
  it("prototype has no delete/update/clear/truncate/set/replace/modifySource/writeBack methods", () => {
    const store = new RiskScoreStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "set", "replace", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("appending the same id twice does NOT overwrite — both lines are kept", async () => {
    const store = new RiskScoreStore();
    await store.append(makeScore({ id: "risk-dup", overallRisk: 0.3 }));
    await store.append(makeScore({ id: "risk-dup", overallRisk: 0.6 }));
    const path = join(tempRoot, ".alix", "risk-scores", "risk-scores.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("RiskScoreStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = join(tempRoot, ".alix", "risk-scores");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "risk-scores.jsonl"),
      JSON.stringify(makeScore({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new RiskScoreStore();
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
  });
});