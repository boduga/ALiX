import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChronicleStore } from "../../src/chronicle/chronicle-store.js";
import type { ChronicleEntry, ChronicleOutcome } from "../../src/chronicle/chronicle-store.js";
import type { SignalDomain, SignalPolarity } from "../../src/runtime/signal-frame.js";

describe("ChronicleStore", () => {
  let tmpDir: string;
  let store: ChronicleStore;

  /** Helper to build a minimal entry payload */
  function makeEntry(overrides: Partial<Omit<ChronicleEntry, "entryId" | "createdAt">> = {}) {
    return {
      signalCode: "00100010",
      domain: "chronicle" as SignalDomain,
      polarity: "ire" as SignalPolarity,
      problem: "Test problem",
      diagnosis: "Test diagnosis",
      actionTaken: "Test action",
      outcome: "success" as ChronicleOutcome,
      lesson: "Test lesson",
      taboosObserved: ["no_mutation"],
      offeringsUsed: ["clarity"],
      traceRefs: ["trace_001"],
      replayRefs: [],
      rollbackRefs: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "chronicle-"));
    store = new ChronicleStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("append creates entry file and index entry", async () => {
    const entry = await store.append(makeEntry());
    const filePath = join(tmpDir, ".alix", "chronicle", "entries", `${entry.entryId}.json`);
    const indexFile = join(tmpDir, ".alix", "chronicle", "index.json");

    assert.ok(entry.entryId);
    assert.ok(entry.createdAt);
    assert.ok(existsSync(filePath));
    assert.ok(existsSync(indexFile));

    const indexContent = JSON.parse(readFileSync(indexFile, "utf-8"));
    assert.equal(indexContent.length, 1);
    assert.equal(indexContent[0].entryId, entry.entryId);
    assert.equal(indexContent[0].domain, "chronicle");
    assert.equal(indexContent[0].outcome, "success");
    assert.equal(indexContent[0].problem, "Test problem");
  });

  it("get returns undefined for unknown entryId", async () => {
    const result = await store.get("nonexistent-id");
    assert.equal(result, undefined);
  });

  it("get returns the correct entry for existing entryId", async () => {
    const entry = await store.append(makeEntry({ problem: "Get test problem" }));
    const fetched = await store.get(entry.entryId);
    assert.ok(fetched);
    assert.equal(fetched!.entryId, entry.entryId);
    assert.equal(fetched!.problem, "Get test problem");
    assert.equal(fetched!.signalCode, "00100010");
    assert.equal(fetched!.domain, "chronicle");
    assert.equal(fetched!.outcome, "success");
  });

  it("search by domain returns matching entries", async () => {
    const entry1 = await store.append(makeEntry({ domain: "chronicle", problem: "Domain test A" }));
    const entry2 = await store.append(makeEntry({ domain: "task", problem: "Domain test B" }));
    const entry3 = await store.append(makeEntry({ domain: "chronicle", problem: "Domain test C" }));

    const results = await store.search({ domain: "chronicle" });
    assert.equal(results.length, 2);
    const ids = results.map(r => r.entryId);
    assert.ok(ids.includes(entry1.entryId));
    assert.ok(ids.includes(entry3.entryId));
    assert.ok(!ids.includes(entry2.entryId));
  });

  it("search by outcome returns matching entries", async () => {
    await store.append(makeEntry({ outcome: "success", problem: "Outcome test A" }));
    const entryB = await store.append(makeEntry({ outcome: "failure", problem: "Outcome test B" }));
    await store.append(makeEntry({ outcome: "success", problem: "Outcome test C" }));

    const results = await store.search({ outcome: "failure" });
    assert.equal(results.length, 1);
    assert.equal(results[0].entryId, entryB.entryId);
  });

  it("search by signalCode returns matching entries", async () => {
    await store.append(makeEntry({ signalCode: "00000000", problem: "Signal A" }));
    const entryB = await store.append(makeEntry({ signalCode: "11111111", problem: "Signal B" }));
    await store.append(makeEntry({ signalCode: "00000000", problem: "Signal C" }));

    const results = await store.search({ signalCode: "11111111" });
    assert.equal(results.length, 1);
    assert.equal(results[0].entryId, entryB.entryId);
  });

  it("search with multiple filters uses AND logic", async () => {
    // Matches all three filters
    const entry1 = await store.append(makeEntry({
      domain: "tool",
      polarity: "ibi",
      outcome: "partial",
      problem: "Multi-filter A",
    }));
    // Matches domain + polarity but not outcome
    await store.append(makeEntry({
      domain: "tool",
      polarity: "ibi",
      outcome: "success",
      problem: "Multi-filter B",
    }));
    // Matches polarity + outcome but not domain
    await store.append(makeEntry({
      domain: "memory",
      polarity: "ibi",
      outcome: "partial",
      problem: "Multi-filter C",
    }));

    const results = await store.search({
      domain: "tool",
      polarity: "ibi",
      outcome: "partial",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].entryId, entry1.entryId);
  });

  it("search returns [] when index doesn't exist", async () => {
    const emptyStore = new ChronicleStore("/tmp/nonexistent-path-12345");
    const results = await emptyStore.search({ domain: "chronicle" });
    assert.deepEqual(results, []);
  });

  it("handles empty entries directory gracefully", async () => {
    const entry = await store.append(makeEntry({ problem: "Graceful test" }));

    const entryFilePath = join(tmpDir, ".alix", "chronicle", "entries", `${entry.entryId}.json`);
    rmSync(entryFilePath);

    const results = await store.search({ outcome: "success" });
    assert.equal(results.length, 0);
  });

  it("index file is valid JSON after multiple appends", async () => {
    await store.append(makeEntry({ problem: "Index JSON A" }));
    await store.append(makeEntry({ problem: "Index JSON B" }));
    await store.append(makeEntry({ problem: "Index JSON C" }));

    const indexFile = join(tmpDir, ".alix", "chronicle", "index.json");
    const content = readFileSync(indexFile, "utf-8");

    let parsed: unknown;
    assert.doesNotThrow(() => { parsed = JSON.parse(content); });
    assert.ok(Array.isArray(parsed));
    assert.equal((parsed as unknown[]).length, 3);
  });

  it("round-trip: append -> get returns identical data", async () => {
    const original = await store.append(makeEntry({
      signalCode: "10101010",
      domain: "replay",
      polarity: "mixed",
      problem: "Round-trip problem",
      diagnosis: "Round-trip diagnosis",
      actionTaken: "Round-trip action",
      outcome: "partial",
      lesson: "Round-trip lesson",
      taboosObserved: ["no_side_effects_without_approval", "test_taboo"],
      offeringsUsed: ["palm_oil", "kola_nut"],
      traceRefs: ["trace_a", "trace_b"],
      replayRefs: ["replay_x"],
      rollbackRefs: ["rollback_y"],
    }));

    const fetched = await store.get(original.entryId);
    assert.ok(fetched);
    assert.deepEqual(fetched, original);
  });
});
