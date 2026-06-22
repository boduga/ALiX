/**
 * P8.5a.0.3 — Evidence Chain governance boundary sentinels.
 *
 * These tests enforce the structural invariants of the Evidence Chain
 * layer. They are intentionally grep-based and content-based so they
 * fail loudly if a future change re-introduces mutation authority,
 * approval coupling, or other forbidden coupling.
 *
 * The chain layer is a record layer. It must never carry the authority
 * to approve, apply, or reject anything. The store must remain
 * append-only. The chain must remain a pure, derivable view that
 * source artifacts cannot be mutated through.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CHAIN_LAYER_FILES = [
  "src/learning/evidence-chain-types.ts",
  "src/learning/forward-ref-extractors.ts",
  "src/learning/evidence-chain-store.ts",
];

// Symbol-form forbidden imports. Each is matched against import
// statements only (e.g., `from "..."ProposalStore..."`).
const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AutomaticProposalGenerator",
  "ApproveCommand",
  "ApplyCommand",
];

// Regex-form forbidden imports. Used when the forbidden pattern is
// broader than a single symbol (e.g., source-mutation calls).
const FORBIDDEN_IMPORT_PATTERNS = [
  /writeFileSync[^;]*source/i,
];

// Call-site patterns that must never appear in the chain layer.
// We only forbid explicit calls; property/field names like "appliedAt"
// or "rejectedAt" remain allowed.
const FORBIDDEN_CALL_PATTERNS = [
  /\bapprove\s*\(/,
  /\bapply\s*\(/,
  /\breject\s*\(/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

describe("evidence-chain-sentinels: forbidden imports", () => {
  for (const file of CHAIN_LAYER_FILES) {
    it(`${file} does not import forbidden symbols`, () => {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of FORBIDDEN_IMPORTS) {
        const importLine = new RegExp(
          `from\\s+["'][^"']*${forbidden}["']`,
          "g",
        );
        expect(content).not.toMatch(importLine);
      }
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});

describe("evidence-chain-sentinels: no approval call sites", () => {
  for (const file of CHAIN_LAYER_FILES) {
    it(`${file} does not call approve(, apply(, or reject(`, () => {
      const content = readFileSync(file, "utf-8");
      for (const pattern of FORBIDDEN_CALL_PATTERNS) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});

describe("evidence-chain-sentinels: append-only store", () => {
  it("EvidenceChainStore has no forbidden mutation methods", async () => {
    const { EvidenceChainStore } = await import(
      "../../src/learning/evidence-chain-store.js"
    );
    const store = new EvidenceChainStore();
    const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
    const forbidden = [
      "delete",
      "update",
      "clear",
      "truncate",
      "setChain",
      "replaceChain",
      "modifySource",
      "writeBack",
    ];
    for (const name of forbidden) {
      expect(typeof proto[name]).not.toBe("function");
    }
  });
});

describe("evidence-chain-sentinels: no source-artifact mutation surface", () => {
  it("appendChain accepts only a chain record (length === 1)", async () => {
    const { EvidenceChainStore } = await import(
      "../../src/learning/evidence-chain-store.js"
    );
    const store = new EvidenceChainStore();
    // The signature should accept ONLY the chain record — no source
    // artifact parameter. This blocks any future signature that would
    // let the store rewrite a source artifact as part of "appending".
    expect(store.appendChain.length).toBe(1);
  });
});

describe("evidence-chain-sentinels: chain lives in src/learning/", () => {
  it("the chain layer files are all under src/learning/", () => {
    for (const file of CHAIN_LAYER_FILES) {
      expect(file.startsWith("src/learning/")).toBe(true);
    }
  });
});

describe("evidence-chain-sentinels: no leaky helper", () => {
  it("no file in src/cli/ or src/adaptation/ imports from the chain layer yet", () => {
    // The chain layer ships in P8.5a.0 without consumers. P8.5c
    // (explain) will be the first consumer. Until then, no external
    // module imports the chain — that would mean hidden coupling
    // we haven't reviewed.
    const cliFiles = walk("src/cli");
    const adaptFiles = walk("src/adaptation");
    const all = [...cliFiles, ...adaptFiles];
    for (const file of all) {
      if (file.includes("/learning/")) continue;
      const content = readFileSync(file, "utf-8");
      expect(content).not.toMatch(/from\s+["'][^"']*evidence-chain/);
      expect(content).not.toMatch(/from\s+["'][^"']*forward-ref-extractors/);
    }
  });
});
