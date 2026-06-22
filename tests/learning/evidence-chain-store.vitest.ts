import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import type { LearningEvidenceChain } from "../../src/learning/evidence-chain-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "evidence-chain-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

function makeChain(overrides: Partial<LearningEvidenceChain> = {}): LearningEvidenceChain {
  return {
    id: "chain-1",
    subject: "Evidence chain for signal-1",
    outcome: "explained",
    confidence: 1,
    reasons: [],
    generatedAt: "2026-06-22T00:00:00.000Z",
    rootArtifactId: "signal-1",
    rootArtifactType: "learning_signal",
    links: [],
    depth: 1,
    ...overrides,
  };
}

describe("EvidenceChainStore: append + query", () => {
  it("appends a chain and returns it with a populated id if missing", async () => {
    const store = new EvidenceChainStore();
    const chain = makeChain({ id: "" });
    const saved = await store.appendChain(chain);
    expect(saved.id).toBeTruthy();
    expect(saved.id).not.toBe("");
  });

  it("persists as one JSONL line in .alix/learning/evidence-chains.jsonl", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "chain-1" }));
    const path = join(tempRoot, ".alix", "learning", "evidence-chains.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe("chain-1");
  });

  it("getChainForRoot returns all chains for a root id", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "c-1", rootArtifactId: "signal-A" }));
    await store.appendChain(makeChain({ id: "c-2", rootArtifactId: "signal-A" }));
    await store.appendChain(makeChain({ id: "c-3", rootArtifactId: "signal-B" }));
    const chains = await store.getChainForRoot("signal-A");
    expect(chains.map((c) => c.id).sort()).toEqual(["c-1", "c-2"]);
  });

  it("listChains returns all chains", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "c-1" }));
    await store.appendChain(makeChain({ id: "c-2" }));
    const all = await store.listChains();
    expect(all.map((c) => c.id).sort()).toEqual(["c-1", "c-2"]);
  });
});

describe("EvidenceChainStore: append-only + no source mutation", () => {
  it("has no delete / update / clear / truncate / setChain / replaceChain / modifySource / writeBack methods", () => {
    const store = new EvidenceChainStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const forbidden of [
      "delete", "update", "clear", "truncate",
      "setChain", "replaceChain", "modifySource", "writeBack",
    ]) {
      expect(typeof proto[forbidden]).not.toBe("function");
    }
  });

  it("does not expose any method that returns a mutable reference to a stored chain", () => {
    const store = new EvidenceChainStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      expect(name).not.toMatch(/Mutable/i);
      expect(name).not.toMatch(/Edit/i);
    }
  });

  it("appending the same chain id twice does NOT overwrite — both lines are kept", async () => {
    const store = new EvidenceChainStore();
    await store.appendChain(makeChain({ id: "chain-dup" }));
    await store.appendChain(makeChain({ id: "chain-dup" }));
    const path = join(tempRoot, ".alix", "learning", "evidence-chains.jsonl");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

describe("EvidenceChainStore: corrupt-line skip", () => {
  it("skips malformed lines when reading back", async () => {
    // Write one valid line and one corrupt line manually.
    const dir = join(tempRoot, ".alix", "learning");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "evidence-chains.jsonl"),
      JSON.stringify(makeChain({ id: "good" })) + "\n" + "{ not valid json\n",
    );
    const store = new EvidenceChainStore();
    const chains = await store.listChains();
    expect(chains).toHaveLength(1);
    expect(chains[0].id).toBe("good");
  });
});