import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ───────────────────────────────────────────────

import type {
  ModelCapabilities,
  TokenUsage,
  CostProfile,
  NormalizedMessage,
  ModelAdapter,
  ProviderResult,
  ProviderInfo,
  ProviderRegistry,
  ProviderAvailability,
  ProviderSelectionMetadata,
} from "../../src/runtime/contracts/provider-contract.js";
import {
  SELECTION_METADATA_INVARIANT,
} from "../../src/runtime/contracts/provider-contract.js";

// ── Source types (for structural comparison) ─────────────────────

import type { ModelCapabilities as SourceModelCapabilities } from "../../src/providers/types.js";
import type { TokenUsage as SourceTokenUsage } from "../../src/providers/types.js";
import type { CostProfile as SourceCostProfile } from "../../src/providers/types.js";
import type { NormalizedMessage as SourceNormalizedMessage } from "../../src/providers/types.js";
import type { ModelAdapter as SourceModelAdapter } from "../../src/providers/types.js";
import { listProviders } from "../../src/providers/registry.js";

// ── Tests ────────────────────────────────────────────────────────

describe("M1.3 — Provider Contract", () => {
  // ── Structural type compatibility ─────────────────────────────

  it("ModelCapabilities contract matches source type exactly", () => {
    // Structural typing: verify source is assignable to contract and vice versa.
    // If either direction fails the types have drifted.
    const sourceToContract = (c: SourceModelCapabilities): ModelCapabilities => c;
    const contractToSource = (c: ModelCapabilities): SourceModelCapabilities => c;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("TokenUsage contract matches source type exactly", () => {
    const sourceToContract = (t: SourceTokenUsage): TokenUsage => t;
    const contractToSource = (t: TokenUsage): SourceTokenUsage => t;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("CostProfile contract matches source type exactly", () => {
    const sourceToContract = (c: SourceCostProfile): CostProfile => c;
    const contractToSource = (c: CostProfile): SourceCostProfile => c;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("NormalizedMessage contract matches source type exactly", () => {
    const sourceToContract = (m: SourceNormalizedMessage): NormalizedMessage => m;
    const contractToSource = (m: NormalizedMessage): SourceNormalizedMessage => m;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ModelAdapter contract matches source type exactly", () => {
    // ModelAdapter is defined as a type in both locations.
    // Structural typing verifies they are interchangeable.
    const sourceToContract = (a: SourceModelAdapter): ModelAdapter => a;
    const contractToSource = (a: ModelAdapter): SourceModelAdapter => a;
    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── ProviderResult shape ──────────────────────────────────────

  it("ProviderResult has the expected fields", () => {
    // Runtime check using a placeholder — verify the shape matches the contract
    const result: ProviderResult = {
      message: "Hello",
      usage: { inputTokens: 10, outputTokens: 20 },
      cost: 0.002,
      finishReason: "stop",
    };

    assert.equal(typeof result.message, "string");
    assert.equal(typeof result.usage.inputTokens, "number");
    assert.equal(typeof result.usage.outputTokens, "number");
    assert.equal(typeof result.cost, "number");
    assert.equal(result.finishReason, "stop");
  });

  it("ProviderResult allows optional cost and finishReason", () => {
    // Both cost and finishReason are optional — verify minimal case compiles
    const result: ProviderResult = {
      message: "Hello",
      usage: { inputTokens: 5, outputTokens: 10 },
    };

    assert.equal(result.message, "Hello");
    assert.equal(result.cost, undefined);
    assert.equal(result.finishReason, undefined);
  });

  // ── ProviderRegistry contract ─────────────────────────────────

  it("ProviderRegistry interface describes registry shape", () => {
    // Assert the expected method signatures exist on the interface
    // by checking the module-level listProviders matches the contract shape.
    assert.equal(typeof listProviders, "function");

    const providers = listProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);

    // Verify each entry matches ProviderInfo shape
    for (const p of providers) {
      assert.equal(typeof p.id, "string");
      assert.equal(typeof p.name, "string");
      assert.equal(typeof p.envKey, "string");
    }
  });

  it("listProviders returns deterministic results", () => {
    const a = listProviders();
    const b = listProviders();
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].id, b[i].id);
      assert.equal(a[i].name, b[i].name);
      assert.equal(a[i].envKey, b[i].envKey);
    }
  });

  // ── ProviderSelectionMetadata invariants ──────────────────────

  it("ProviderSelectionMetadata has descriptive-only shape", () => {
    const meta: ProviderSelectionMetadata = {
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      capabilities: {
        provider: "anthropic",
        model: "claude-3-opus-20240229",
        inputTokenLimit: 200000,
        outputTokenLimit: 4096,
        supportsTools: true,
        supportsStreaming: true,
        supportsStructuredOutput: true,
        supportsVision: true,
      },
      availability: "available",
    };

    // All fields are descriptive — no selection scores or rankings
    assert.equal(typeof meta.provider, "string");
    assert.equal(typeof meta.model, "string");
    assert.equal(typeof meta.capabilities, "object");
    assert.equal(typeof meta.availability, "string");

    // Verify capabilities sub-fields
    assert.equal(meta.capabilities.provider, "anthropic");
    assert.equal(meta.capabilities.supportsTools, true);
    assert.equal(meta.capabilities.inputTokenLimit, 200000);

    // Invariant: all fields are descriptive — no selection scores or rankings.
    // The type system ensures "best", "cheapest", "score", "rank" are not
    // part of ProviderSelectionMetadata.  At runtime we verify the known
    // fields are present and descriptive.
    const knownKeys = Object.keys(meta) as Array<string>;
    assert.ok(knownKeys.includes("provider"));
    assert.ok(knownKeys.includes("model"));
    assert.ok(knownKeys.includes("capabilities"));
    assert.ok(knownKeys.includes("availability"));
  });

  it("SELECTION_METADATA_INVARIANT documents all descriptive-only rules", () => {
    assert.equal(SELECTION_METADATA_INVARIANT.capabilityDescriptionOnly, true);
    assert.equal(SELECTION_METADATA_INVARIANT.noEmbeddedSelection, true);
    assert.equal(SELECTION_METADATA_INVARIANT.noBestOrCheapest, true);

    const keys = Object.keys(SELECTION_METADATA_INVARIANT) as Array<keyof typeof SELECTION_METADATA_INVARIANT>;
    for (const key of keys) {
      assert.equal(SELECTION_METADATA_INVARIANT[key], true, `invariant "${key}" must be true`);
    }
  });

  it("ProviderAvailability is a union of three literal strings", () => {
    // Verify the three expected values work
    const available: ProviderAvailability = "available";
    const unavailable: ProviderAvailability = "unavailable";
    const degraded: ProviderAvailability = "degraded";

    assert.equal(available, "available");
    assert.equal(unavailable, "unavailable");
    assert.equal(degraded, "degraded");
  });
});
