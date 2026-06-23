import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalRecommendationStore } from "../../src/adaptation/approval-recommendation-store.js";
import type { ApprovalRecommendation } from "../../src/adaptation/recommendation-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "rec-store-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeRec(overrides: Partial<ApprovalRecommendation> = {}): ApprovalRecommendation {
  return {
    id: "rec-1",
    subject: "Test recommendation",
    outcome: "approve",
    confidence: 0.85,
    reasons: ["evidence is strong"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    recommendation: "approve",
    proposalId: "prop-1",
    sourceArtifacts: [],
    ...overrides,
  };
}

describe("ApprovalRecommendationStore: append + query", () => {
  it("appends a recommendation and persists as one JSONL line", async () => {
    const store = new ApprovalRecommendationStore();
    await store.append(makeRec({ id: "rec-1" }));
    const path = join(tempRoot, ".alix", "recommendations", "recommendations.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("rec-1");
    expect(parsed.confidence).toBe(0.85);
  });

  it("get(id) returns the stored recommendation", async () => {
    const store = new ApprovalRecommendationStore();
    await store.append(makeRec({ id: "rec-42", confidence: 0.72 }));
    const got = await store.get("rec-42");
    expect(got).not.toBeNull();
    expect(got!.confidence).toBe(0.72);
    expect(got!.recommendation).toBe("approve");
  });

  it("get(id) returns null for an unknown id", async () => {
    const store = new ApprovalRecommendationStore();
    const got = await store.get("nonexistent");
    expect(got).toBeNull();
  });

  it("list() returns all stored recommendations", async () => {
    const store = new ApprovalRecommendationStore();
    await store.append(makeRec({ id: "rec-1" }));
    await store.append(makeRec({ id: "rec-2" }));
    const all = await store.list();
    expect(all.map((r) => r.id).sort()).toEqual(["rec-1", "rec-2"]);
  });

  it("queryByWindow(days) returns only recommendations within the window", async () => {
    const store = new ApprovalRecommendationStore();
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    await store.append(makeRec({ id: "recent", generatedAt: tenDaysAgo.toISOString() }));
    await store.append(makeRec({ id: "old", generatedAt: fortyDaysAgo.toISOString() }));
    const inWindow = await store.queryByWindow(30);
    expect(inWindow.map((r) => r.id)).toEqual(["recent"]);
  });
});

describe("ApprovalRecommendationStore: append-only + no source mutation", () => {
  it("prototype has no delete/update/clear/truncate/set/replace/modifySource/writeBack methods", () => {
    const store = new ApprovalRecommendationStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "set", "replace", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("appending the same id twice does NOT overwrite — both lines are kept", async () => {
    const store = new ApprovalRecommendationStore();
    await store.append(makeRec({ id: "rec-dup", confidence: 0.5 }));
    await store.append(makeRec({ id: "rec-dup", confidence: 0.7 }));
    const path = join(tempRoot, ".alix", "recommendations", "recommendations.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("ApprovalRecommendationStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const dir = join(tempRoot, ".alix", "recommendations");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "recommendations.jsonl"),
      JSON.stringify(makeRec({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new ApprovalRecommendationStore();
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
  });
});
