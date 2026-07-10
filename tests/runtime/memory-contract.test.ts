import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ─────────────────────────────────────────────────

import type {
  MemoryType,
  MemoryEntry,
  MemoryConfig,
  MemoryQuery,
  MemoryStoreContract,
  MemoryInvariantsAssertion,
} from "../../src/runtime/contracts/memory-contract.js";
import {
  DEFAULT_MEMORY_CONFIG,
  MEMORY_INVARIANTS,
} from "../../src/runtime/contracts/memory-contract.js";

// ── Source types (for structural comparison) ───────────────────────

import type { MemoryEntry as SourceMemoryEntry } from "../../src/utils/memory/types.js";
import type { MemoryConfig as SourceMemoryConfig } from "../../src/utils/memory/types.js";
import type { MemoryType as SourceMemoryType } from "../../src/utils/memory/types.js";

// ── Tests ──────────────────────────────────────────────────────────

describe("M1.6 — Memory Contract", () => {
  // ── Structural type compatibility ───────────────────────────────

  it("MemoryEntry contract matches source type exactly", () => {
    // Structural typing: verify source is assignable to contract and vice versa.
    // If either direction fails the types have drifted.
    const sourceToContract = (e: SourceMemoryEntry): MemoryEntry => e;
    const contractToSource = (e: MemoryEntry): SourceMemoryEntry => e;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("MemoryConfig contract matches source type exactly", () => {
    const sourceToContract = (c: SourceMemoryConfig): MemoryConfig => c;
    const contractToSource = (c: MemoryConfig): SourceMemoryConfig => c;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("MemoryType contract matches source type exactly", () => {
    const sourceToContract = (t: SourceMemoryType): MemoryType => t;
    const contractToSource = (t: MemoryType): SourceMemoryType => t;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── MemoryConfig shape ─────────────────────────────────────────

  it("MemoryConfig has all required fields", () => {
    const config: MemoryConfig = {
      decayEnabled: true,
      decayDays: 30,
      maxEntriesPerType: 50,
      consolidateSchedule: "daily",
      indexMaxLines: 100,
    };

    assert.equal(typeof config.decayEnabled, "boolean");
    assert.equal(typeof config.decayDays, "number");
    assert.equal(typeof config.maxEntriesPerType, "number");
    assert.equal(typeof config.consolidateSchedule, "string");
    assert.equal(typeof config.indexMaxLines, "number");
  });

  it("MemoryConfig supports all consolidateSchedule values", () => {
    const daily: MemoryConfig = { decayEnabled: true, decayDays: 30, maxEntriesPerType: 50, consolidateSchedule: "daily", indexMaxLines: 100 };
    const weekly: MemoryConfig = { decayEnabled: true, decayDays: 30, maxEntriesPerType: 50, consolidateSchedule: "weekly", indexMaxLines: 100 };
    const manual: MemoryConfig = { decayEnabled: true, decayDays: 30, maxEntriesPerType: 50, consolidateSchedule: "manual", indexMaxLines: 100 };

    assert.equal(daily.consolidateSchedule, "daily");
    assert.equal(weekly.consolidateSchedule, "weekly");
    assert.equal(manual.consolidateSchedule, "manual");
  });

  // ── DEFAULT_MEMORY_CONFIG ──────────────────────────────────────

  it("DEFAULT_MEMORY_CONFIG has expected default values", () => {
    assert.equal(DEFAULT_MEMORY_CONFIG.decayEnabled, true);
    assert.equal(DEFAULT_MEMORY_CONFIG.decayDays, 30);
    assert.equal(DEFAULT_MEMORY_CONFIG.maxEntriesPerType, 50);
    assert.equal(DEFAULT_MEMORY_CONFIG.consolidateSchedule, "daily");
    assert.equal(DEFAULT_MEMORY_CONFIG.indexMaxLines, 100);
  });

  // ── MemoryEntry shape ──────────────────────────────────────────

  it("MemoryEntry has all required fields", () => {
    const entry: MemoryEntry = {
      name: "test-entry",
      description: "A test memory entry",
      type: "user",
      content: "Some content here",
      createdAt: "2025-01-01T00:00:00.000Z",
      modifiedAt: "2025-01-01T00:00:00.000Z",
      confidence: 0.5,
      confirmations: 0,
    };

    assert.equal(typeof entry.name, "string");
    assert.equal(typeof entry.description, "string");
    assert.equal(typeof entry.type, "string");
    assert.equal(typeof entry.content, "string");
    assert.equal(typeof entry.createdAt, "string");
    assert.equal(typeof entry.modifiedAt, "string");
    assert.equal(typeof entry.confidence, "number");
    assert.equal(typeof entry.confirmations, "number");
  });

  it("MemoryEntry supports optional source field", () => {
    const withSource: MemoryEntry = {
      name: "entry",
      description: "desc",
      type: "reference",
      content: "content",
      createdAt: "2025-01-01T00:00:00.000Z",
      modifiedAt: "2025-01-01T00:00:00.000Z",
      confidence: 0.8,
      confirmations: 3,
      source: "https://example.com/doc",
    };

    assert.equal(withSource.source, "https://example.com/doc");

    const withoutSource: MemoryEntry = {
      name: "entry",
      description: "desc",
      type: "reference",
      content: "content",
      createdAt: "2025-01-01T00:00:00.000Z",
      modifiedAt: "2025-01-01T00:00:00.000Z",
      confidence: 0.8,
      confirmations: 3,
    };

    assert.equal(withoutSource.source, undefined);
  });

  it("MemoryEntry supports all MemoryType values", () => {
    const user: MemoryEntry = { name: "e", description: "d", type: "user", content: "c", createdAt: "now", modifiedAt: "now", confidence: 0.5, confirmations: 0 };
    const project: MemoryEntry = { name: "e", description: "d", type: "project", content: "c", createdAt: "now", modifiedAt: "now", confidence: 0.5, confirmations: 0 };
    const feedback: MemoryEntry = { name: "e", description: "d", type: "feedback", content: "c", createdAt: "now", modifiedAt: "now", confidence: 0.5, confirmations: 0 };
    const reference: MemoryEntry = { name: "e", description: "d", type: "reference", content: "c", createdAt: "now", modifiedAt: "now", confidence: 0.5, confirmations: 0 };

    assert.equal(user.type, "user");
    assert.equal(project.type, "project");
    assert.equal(feedback.type, "feedback");
    assert.equal(reference.type, "reference");
  });

  // ── MemoryStoreContract interface ──────────────────────────────

  it("MemoryStoreContract interface is structurally sound", () => {
    // Verify the interface describes all expected methods by constructing
    // a minimal mock that satisfies MemoryStoreContract.
    const mock: MemoryStoreContract = {
      async save(entry) {
        return {
          ...entry,
          createdAt: "2025-01-01T00:00:00.000Z",
          modifiedAt: "2025-01-01T00:00:00.000Z",
        } as MemoryEntry;
      },
      async read(_name, _type) {
        return null;
      },
      async query(_params) {
        return [];
      },
      async delete(_name, _type) {
        return true;
      },
      async list(_type) {
        return [];
      },
      async consolidate() {
        // no-op
      },
    };

    // Verify all methods exist on the mock
    assert.equal(typeof mock.save, "function");
    assert.equal(typeof mock.read, "function");
    assert.equal(typeof mock.query, "function");
    assert.equal(typeof mock.delete, "function");
    assert.equal(typeof mock.list, "function");
    assert.equal(typeof mock.consolidate, "function");

    // Verify the mock can be exercised
    assert.ok(mock);
  });

  it("MemoryStoreContract save returns fully-materialised MemoryEntry", async () => {
    const store: MemoryStoreContract = {
      async save(entry) {
        return {
          ...entry,
          createdAt: "2025-01-01T00:00:00.000Z",
          modifiedAt: "2025-01-01T00:00:00.000Z",
        } as MemoryEntry;
      },
      async read() { return null; },
      async query() { return []; },
      async delete() { return false; },
      async list() { return []; },
      async consolidate() {},
    };

    const result = await store.save({
      name: "test",
      description: "desc",
      type: "user",
      content: "content",
      confidence: 0.5,
      confirmations: 0,
    });

    assert.equal(typeof result.createdAt, "string");
    assert.equal(typeof result.modifiedAt, "string");
    assert.ok(result.createdAt.length > 0);
  });

  // ── MemoryQuery shape ──────────────────────────────────────────

  it("MemoryQuery supports all filter dimensions", () => {
    const full: MemoryQuery = { text: "search", type: "user", limit: 5 };
    const minimal: MemoryQuery = {};
    const textOnly: MemoryQuery = { text: "keyword" };
    const typeOnly: MemoryQuery = { type: "reference" };

    assert.equal(full.text, "search");
    assert.equal(full.type, "user");
    assert.equal(full.limit, 5);
    assert.equal(minimal.text, undefined);
    assert.equal(textOnly.text, "keyword");
    assert.equal(typeOnly.type, "reference");
  });

  // ── Memory invariants ──────────────────────────────────────────

  it("MEMORY_INVARIANTS documents all memory rules", () => {
    assert.equal(MEMORY_INVARIANTS.immutableIdentity, true);
    assert.equal(MEMORY_INVARIANTS.appendOnlyCreatedAt, true);
    assert.equal(MEMORY_INVARIANTS.confidenceMonotonic, true);
    assert.equal(MEMORY_INVARIANTS.fourFixedTypes, true);
    assert.equal(MEMORY_INVARIANTS.noSilentOverwrite, true);

    const keys = Object.keys(MEMORY_INVARIANTS) as Array<keyof typeof MEMORY_INVARIANTS>;
    for (const key of keys) {
      assert.equal(MEMORY_INVARIANTS[key], true, `invariant "${key}" must be true`);
    }
  });

  it("MemoryInvariantsAssertion type-level check compiles", () => {
    // Type-level assertion: all invariants are `true` literals.
    // This test passes at compile time by construction.
    const _check: MemoryInvariantsAssertion = {
      immutableIdentity: true,
      appendOnlyCreatedAt: true,
      confidenceMonotonic: true,
      fourFixedTypes: true,
      noSilentOverwrite: true,
    };
    assert.ok(_check.immutableIdentity);
  });
});
