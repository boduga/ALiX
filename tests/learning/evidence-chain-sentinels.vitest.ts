/**
 * P8.5a.0.3 — Evidence Chain governance boundary sentinels.
 *
 * Enforces the structural invariants of the Evidence Chain layer: it is a
 * record layer and must never carry approval/apply/reject authority, the store
 * must stay append-only, and the chain must remain a pure derivable view.
 *
 * Dependency claims use the real import graph (#697); call-site scans run on
 * comment-stripped code.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { importedBindings, importedSpecifiers, codeOnly } from "../helpers/import-graph.js";

const CHAIN_LAYER_FILES = [
  "src/learning/evidence-chain-types.ts",
  "src/learning/forward-ref-extractors.ts",
  "src/learning/evidence-chain-store.ts",
];

// Symbol-form forbidden imports.
const FORBIDDEN_IMPORTS = [
  "ProposalStore",
  "ApprovalGate",
  "AutomaticProposalGenerator",
  "ApproveCommand",
  "ApplyCommand",
];

// Call-site patterns that must never appear in the chain layer.
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
      const bindings = importedBindings(file);
      const specifiers = [...importedSpecifiers(file)];
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(
          bindings.has(forbidden) || specifiers.some((s) => s.includes(forbidden)),
          `imports ${forbidden}`,
        ).toBe(false);
      }
    });
  }
});

describe("evidence-chain-sentinels: no approval call sites", () => {
  for (const file of CHAIN_LAYER_FILES) {
    it(`${file} does not call approve(, apply(, or reject(`, () => {
      const code = codeOnly(readFileSync(file, "utf-8"));
      for (const pattern of FORBIDDEN_CALL_PATTERNS) {
        expect(code).not.toMatch(pattern);
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
    const all = [...walk("src/cli"), ...walk("src/adaptation")];
    for (const file of all) {
      if (file.includes("/learning/")) continue;
      const specifiers = [...importedSpecifiers(file)];
      const offending = specifiers.filter(
        (s) => s.includes("evidence-chain") || s.includes("forward-ref-extractors"),
      );
      expect(offending, `${file} imports the chain layer`).toEqual([]);
    }
  });
});
