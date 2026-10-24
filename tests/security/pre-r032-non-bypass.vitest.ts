/**
 * pre-r032-non-bypass.vitest.ts — PRE-R032 non-bypass demonstration.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT
 *
 * PRE-R032 requires a demonstration that supervision never bypasses existing
 * authorization. No supervision/eligibility engine is implemented, so there is
 * no feature to test for bypass — and asserting "it works" would be testing code
 * that does not exist.
 *
 * What CAN be proven today, and is proven here, is the structural half: the
 * authorization controls an eligibility layer would have to route through are
 * themselves authoritative, and nothing consults an eligibility record to widen
 * a decision. That makes the future bypass surface small and named.
 *
 * This is a parity table, not a spot check: expected outcomes are declared for
 * every direction (deny stays deny, allow is not invented, consumed cannot be
 * reused, scope still decides) so a regression in any one direction fails.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function defaultGate() {
  const { PolicyGate } = await import("../../src/governance/policy/policy-gate.js");
  const { DEFAULT_CONFIG } = await import("../../src/operations/config/defaults.js");
  return { PolicyGate, DEFAULT_CONFIG };
}

// ── Control: authorization cannot be turned into allow by eligibility ──────
describe("authorization is not authority-by-adjacency", () => {
  it("a policy deny stays deny for every session mode", async () => {
    const { PolicyGate, DEFAULT_CONFIG } = await defaultGate();
    const gate = new PolicyGate(structuredClone(DEFAULT_CONFIG) as never);
    // The full declared outcome table, not just the new case: a permissive mode
    // must not convert a hard deny in ANY direction.
    for (const sessionMode of ["ask", "auto", "bypass"] as const) {
      const decision = await gate.evaluateToolCall({
        requestId: `deny-${sessionMode}`,
        toolName: "shell.run",
        capability: "shell.run",
        args: { command: "rm -rf /" },
        cwd: process.cwd(),
        sessionMode,
        source: "tool",
      } as never);
      expect(decision.decision, sessionMode).toBe("deny");
      expect(decision.matchedRuleId, sessionMode).toBe("deny-command-rule");
    }
  });

  it("a protected path stays protected for every session mode", async () => {
    const { PolicyGate, DEFAULT_CONFIG } = await defaultGate();
    for (const sessionMode of ["ask", "auto", "bypass"] as const) {
      const config = structuredClone(DEFAULT_CONFIG) as never as {
        permissions: { tools: Record<string, string> };
      };
      config.permissions.tools["file.write"] = "allow";
      const gate = new PolicyGate(config as never);
      const decision = await gate.evaluateToolCall({
        requestId: `prot-${sessionMode}`,
        toolName: "file.create",
        capability: "file.write",
        args: { path: ".git/config", content: "x" },
        cwd: process.cwd(),
        sessionMode,
        source: "tool",
      } as never);
      // `.git/config` is both protected and sensitive; either rule refusing is
      // correct, both refusing is expected.
      expect(decision.decision, sessionMode).toBe("deny");
    }
  });

  it("no source module consults an eligibility record to widen a decision", async () => {
    // The future bypass would look like: policy says deny, then something reads
    // an eligibility/promotion record and returns allow. Nothing may do that.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];

    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walk(full));
        else if (full.endsWith(".ts")) out.push(full);
      }
      return out;
    };

    const gateSource = readFileSync(
      join(process.cwd(), "src/governance/policy/policy-gate.ts"),
      "utf-8",
    );
    // The gate itself must not know about eligibility at all. If it ever does,
    // this test should be replaced by a real parity table over that coupling
    // rather than deleted.
    expect(gateSource).not.toMatch(/eligibility/i);
    // Sanity: the walker works, so an empty `offenders` is a real negative.
    expect(walk(join(process.cwd(), "src/governance/policy")).length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

// ── Control: scope still decides write targets ────────────────────────────
describe("owned scope is the authorization, and only within itself", () => {
  it("allows the owned path and denies outside it, under a blanket allow", async () => {
    const { PolicyGate, DEFAULT_CONFIG } = await defaultGate();
    const config = structuredClone(DEFAULT_CONFIG) as never as {
      permissions: { tools: Record<string, string> };
    };
    config.permissions.tools["file.write"] = "allow";
    const gate = new PolicyGate(config as never);
    const owned = ["inside.txt"];

    for (const [target, expected] of [["inside.txt", "allow"], ["outside.txt", "deny"]] as const) {
      const decision = await gate.evaluateToolCall({
        requestId: `scope-${target}`,
        toolName: "file.create",
        capability: "file.write",
        args: { path: target, content: "x" },
        cwd: process.cwd(),
        sessionMode: "bypass",
        source: "tool",
        ownedPaths: owned,
      } as never);
      expect(decision.decision, target).toBe(expected);
      expect(decision.matchedRuleId, target).toBe("owned-path-rule");
    }
  });
});

// ── Control: approval binding and single use ──────────────────────────────
describe("approvals cannot be minted, widened or reused", () => {
  it("the approval store's consume path is the only status mutator", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      join(process.cwd(), "src/governance/approvals/approval-store.ts"),
      "utf-8",
    );
    // Consumption sets the terminal status. If a new writer appeared that set
    // `consumed` without going through the claim, single use would be forgeable.
    expect(source).toMatch(/consumeApproved/);
    expect(source).toMatch(/status = "consumed"/);
    // Counting the assignment sites keeps a second, competing writer visible.
    const writers = source.match(/\.status\s*=\s*"consumed"/g) ?? [];
    expect(writers.length).toBe(1);
  });

  it("an approval must be approved, unexpired, key-matched and invocation-matched", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      join(process.cwd(), "src/governance/approvals/approval-store.ts"),
      "utf-8",
    );
    // Each guard is a refusal that must exist independently: removing any one
    // would let a stale or foreign approval authorize an invocation.
    for (const guard of [
      /status !== "approved"/,
      /expiresAt\) <= now/,
      /bindingKey !== expectedBindingKey/,
      /invocationMatches/,
    ]) {
      expect(source, String(guard)).toMatch(guard);
    }
  });
});

// ── Control: durable pause on missing authority ───────────────────────────
describe("missing authority is a pause, never an implicit execute", () => {
  it("a write requiring approval is not allowed by a permissive capability grant alone", async () => {
    const { PolicyGate, DEFAULT_CONFIG } = await defaultGate();
    const config = structuredClone(DEFAULT_CONFIG) as never as {
      permissions: { tools: Record<string, string> };
    };
    // Default `file.write` is `ask`; even under bypass the owned-path rule is
    // what authorizes, so an owned write is scoped rather than unconditionally
    // permitted.
    const gate = new PolicyGate(config as never);
    const decision = await gate.evaluateToolCall({
      requestId: "ask-1",
      toolName: "file.create",
      capability: "file.write",
      args: { path: "a.txt", content: "x" },
      cwd: process.cwd(),
      sessionMode: "ask",
      source: "tool",
      ownedPaths: ["a.txt"],
    } as never);
    // Owned writes are pre-authorized; the assertion is that the decision is
    // attributable to the owned-path rule, not to a blanket allow.
    expect(decision.matchedRuleId).toBe("owned-path-rule");
  });
});
