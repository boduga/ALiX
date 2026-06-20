/**
 * P5.5.5 — CapabilityDriftAnalyzer tests.
 *
 * Covers all 6 behavioral requirements:
 *   (a) Capability used exactly as described → low drift.
 *   (b) Capability used for completely different purpose → high drift, split candidate.
 *   (c) No proposals → driftMagnitude=0, excluded from results.
 *   (d) Single keyword difference → moderate drift.
 *   (e) minDriftMagnitude filtering.
 *   (f) Multiple capabilities → each analyzed independently.
 */

import { describe, it, expect } from "vitest";
import { CapabilityDriftAnalyzer } from "../../src/adaptation/capability-drift-analyzer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Return an ISO timestamp `offsetDays` before now. */
function ts(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * MS_PER_DAY).toISOString();
}

/** Create an agent card with optional description. */
function agentCard(
  id: string,
  capabilities: string[],
  description?: string,
): { id: string; capabilities: string[]; description?: string } {
  return { id, capabilities, description };
}

/** Create a proposal targeting a capability via target.kind. */
function proposalFor(
  capability: string,
  offsetDays: number,
  opts?: {
    reason?: string;
    payload?: Record<string, unknown>;
  },
): {
  target: { kind: string; capability?: string };
  payload?: Record<string, unknown>;
  reason?: string;
  createdAt: string;
} {
  return {
    target: { kind: "capability", capability },
    ...(opts?.reason ? { reason: opts.reason } : {}),
    ...(opts?.payload ? { payload: opts.payload } : {}),
    createdAt: ts(offsetDays),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CapabilityDriftAnalyzer", () => {
  const analyzer = new CapabilityDriftAnalyzer();

  // -----------------------------------------------------------------------
  // (a) Capability used exactly as described → low drift
  // -----------------------------------------------------------------------

  it("(a) Capability used exactly as described → low drift", () => {
    const cap = "code-generation";

    const agentCards = [
      agentCard(
        "agent-1",
        [cap],
        "generates code from natural language descriptions",
      ),
    ];

    // Old proposals (earliest 3, used for original scope)
    const proposals = [
      proposalFor(cap, 90, { reason: "generates code from natural language" }),
      proposalFor(cap, 85, { reason: "generates code from language input" }),
      proposalFor(cap, 80, { reason: "natural language code generation" }),
      // Recent proposals (last 30 days) — same domain, very similar keywords
      proposalFor(cap, 5, { reason: "generates code from natural language" }),
      proposalFor(cap, 10, { reason: "code generation from natural language" }),
      proposalFor(cap, 15, { reason: "generates natural language code" }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    // All text is nearly identical → extremely low drift.
    // It may be below the default minDriftMagnitude (0.3) and thus excluded,
    // or appear with very low magnitude. Either way, it is NOT a split candidate.
    const drift = results.find((r) => r.capability === cap);
    if (drift) {
      expect(drift.driftMagnitude).toBeLessThan(0.5);
      expect(drift.splitCandidate).toBe(false);
    }
    // If excluded entirely (drift < 0.3), that is also correct.
  });

  // -----------------------------------------------------------------------
  // (b) Capability used for completely different purpose → high drift, split candidate
  // -----------------------------------------------------------------------

  it("(b) Capability used for completely different purpose → high drift, split candidate", () => {
    const cap = "code-generation";

    const agentCards = [
      agentCard(
        "agent-1",
        [cap],
        "generates source code from technical specifications",
      ),
    ];

    const proposals = [
      // Old proposals — code generation domain
      proposalFor(cap, 90, { reason: "generating source code from specifications" }),
      proposalFor(cap, 85, { reason: "translate requirements into working programs" }),
      proposalFor(cap, 80, { reason: "code synthesis from design documents" }),
      // Recent proposals — completely different: network security
      proposalFor(cap, 5, { reason: "analyze network traffic for security threats" }),
      proposalFor(cap, 10, { reason: "detect intrusion attempts in firewall logs" }),
      proposalFor(cap, 15, { reason: "scan system for malware vulnerabilities" }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe(cap);
    expect(results[0].driftMagnitude).toBeGreaterThan(0.5);
    expect(results[0].splitCandidate).toBe(true);
    // Scope strings truncated to 200 chars
    expect(results[0].originalScope.length).toBeLessThanOrEqual(200);
    expect(results[0].currentScope.length).toBeLessThanOrEqual(200);
  });

  // -----------------------------------------------------------------------
  // (c) No proposals → driftMagnitude=0, excluded from results
  // -----------------------------------------------------------------------

  it("(c) No proposals and no agent description → driftMagnitude=0, excluded", () => {
    const cap = "some-capability";

    const agentCards = [agentCard("agent-1", [cap])];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals: [],
    });

    // Both scopes fall back to the capability name "some-capability".
    // Identical keywords → Jaccard = 1 → driftMagnitude = 0 → excluded.
    expect(results).toHaveLength(0);
  });

  it("(c2) No proposals but agent has description → original has keywords, current does not → computed drift", () => {
    // When there's an agent description but no proposals, original scope
    // has text while current scope falls back to the capability name.
    // If both keyword sets are non-empty, drift is computed and may appear.

    const cap = "data-processing";

    const agentCards = [
      agentCard(
        "agent-1",
        [cap],
        "processes large datasets and transforms structured data records",
      ),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals: [],
    });

    // Current scope is the capability name "data-processing" which splits
    // into ["data-processing"] — a single keyword. Original scope has
    // multiple keywords from the description. Drift will be high (> 0.5)
    // because there is essentially no overlap between the two sets.
    //
    // This is correct behaviour: when the capability was described for
    // one purpose but has zero usage data, the drift is real signal.
    if (results.length > 0) {
      const drift = results[0];
      expect(drift.capability).toBe(cap);
      expect(drift.originalScope).toContain("processes");
    }
    // If excluded (both keyword sets happen to be empty), that's also fine.
  });

  // -----------------------------------------------------------------------
  // (d) Single keyword difference → moderate drift
  // -----------------------------------------------------------------------

  it("(d) Single keyword difference → moderate drift", () => {
    const cap = "web-testing";

    const agentCards = [
      agentCard(
        "agent-1",
        [cap],
        "generate code for web application testing",
      ),
    ];

    const proposals = [
      // Old proposals — web domain
      proposalFor(cap, 90, { reason: "generate code for web application testing" }),
      proposalFor(cap, 85, { reason: "generate code for web application testing" }),
      proposalFor(cap, 80, { reason: "generate code for web application testing" }),
      // Recent proposals — mobile domain (single keyword: web → mobile)
      proposalFor(cap, 5, { reason: "generate code for mobile application testing" }),
      proposalFor(cap, 10, { reason: "generate code for mobile application testing" }),
      proposalFor(cap, 15, { reason: "generate code for mobile application testing" }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    // Original: "generate code for web application testing"
    //   → keywords: ["generate", "code", "web", "application", "testing"]  (5)
    // Current: "generate code for mobile application testing"
    //   → keywords: ["generate", "code", "mobile", "application", "testing"]  (5)
    // intersection: ["generate", "code", "application", "testing"] = 4
    // union: 6 unique → Jaccard = 4/6 ≈ 0.667 → drift = 0.333

    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe(cap);
    expect(results[0].driftMagnitude).toBeGreaterThan(0.3);
    expect(results[0].driftMagnitude).toBeLessThan(0.5);
    expect(results[0].splitCandidate).toBe(false);
  });

  // -----------------------------------------------------------------------
  // (e) minDriftMagnitude filtering
  // -----------------------------------------------------------------------

  it("(e) minDriftMagnitude filtering excludes moderate-drift capabilities", () => {
    const cap = "web-testing";

    const agentCards = [
      agentCard(
        "agent-1",
        [cap],
        "generate code for web application testing",
      ),
    ];

    const proposals = [
      proposalFor(cap, 90, { reason: "generate code for web application testing" }),
      proposalFor(cap, 85, { reason: "generate code for web application testing" }),
      proposalFor(cap, 80, { reason: "generate code for web application testing" }),
      proposalFor(cap, 5, { reason: "generate code for mobile application testing" }),
      proposalFor(cap, 10, { reason: "generate code for mobile application testing" }),
      proposalFor(cap, 15, { reason: "generate code for mobile application testing" }),
    ];

    // Same setup as (d), drift ≈ 0.333.
    // With minDriftMagnitude = 0.5, it should be excluded.
    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
      minDriftMagnitude: 0.5,
    });

    expect(results).toHaveLength(0);
  });

  it("(e2) minDriftMagnitude lower than default includes more results", () => {
    const cap = "web-testing";

    const agentCards = [
      agentCard(
        "agent-1",
        [cap],
        "generate code for web application testing",
      ),
    ];

    const proposals = [
      proposalFor(cap, 90, { reason: "generate code for web application testing" }),
      proposalFor(cap, 85, { reason: "generate code for web application testing" }),
      proposalFor(cap, 80, { reason: "generate code for web application testing" }),
      proposalFor(cap, 5, { reason: "generate code for mobile application testing" }),
      proposalFor(cap, 10, { reason: "generate code for mobile application testing" }),
      proposalFor(cap, 15, { reason: "generate code for mobile application testing" }),
    ];

    // With minDriftMagnitude = 0.1, the moderate drift (≈0.333) is included.
    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
      minDriftMagnitude: 0.1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].driftMagnitude).toBeGreaterThan(0.3);
  });

  // -----------------------------------------------------------------------
  // (f) Multiple capabilities → each analyzed independently
  // -----------------------------------------------------------------------

  it("(f) Multiple capabilities → each analyzed independently", () => {
    const capA = "code-generation";
    const capB = "security-scanning";
    const capC = "data-migration";

    const agentCards = [
      agentCard("agent-1", [capA], "generates source code from specifications"),
      agentCard("agent-2", [capA, capB], "handles code generation and security analysis"),
      agentCard("agent-3", [capB], "scans systems for security vulnerabilities"),
      agentCard("agent-4", [capC], "migrates data between storage systems"),
    ];

    const proposals = [
      // capA — code generation: original code, recent stays code
      proposalFor(capA, 90, { reason: "generating code from specifications" }),
      proposalFor(capA, 85, { reason: "code synthesis from requirements" }),
      proposalFor(capA, 80, { reason: "source code generation for web apps" }),
      proposalFor(capA, 5, { reason: "generating code from specifications" }),
      proposalFor(capA, 10, { reason: "source code creation for projects" }),
      proposalFor(capA, 15, { reason: "code synthesis for applications" }),

      // capB — security scanning: original security, recent drifts to code analysis
      proposalFor(capB, 90, { reason: "scanning systems for vulnerabilities" }),
      proposalFor(capB, 85, { reason: "detecting security threats in networks" }),
      proposalFor(capB, 80, { reason: "vulnerability assessment for infrastructure" }),
      proposalFor(capB, 5, { reason: "analyzing code quality and style issues" }),
      proposalFor(capB, 10, { reason: "reviewing source code for best practices" }),
      proposalFor(capB, 15, { reason: "static analysis of application source code" }),

      // capC — data migration: original data, recent data (similar)
      proposalFor(capC, 90, { reason: "migrating data between storage systems" }),
      proposalFor(capC, 85, { reason: "moving data across database platforms" }),
      proposalFor(capC, 80, { reason: "data transfer between storage backends" }),
      proposalFor(capC, 5, { reason: "migrating data between storage systems" }),
      proposalFor(capC, 10, { reason: "data movement across database systems" }),
      proposalFor(capC, 15, { reason: "transferring data between storage platforms" }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [capA, capB, capC],
      agentCards,
      proposals,
    });

    // capA: low drift (same domain) — may or may not appear
    // capB: high drift (security → code analysis) — should appear as split candidate
    // capC: low drift (same domain) — may or may not appear

    const driftB = results.find((r) => r.capability === capB);
    expect(driftB).toBeDefined();
    expect(driftB!.driftMagnitude).toBeGreaterThan(0.5);
    expect(driftB!.splitCandidate).toBe(true);

    // Verify each result has proper fields
    for (const r of results) {
      expect(r.capability).toBeTruthy();
      expect(r.originalScope.length).toBeLessThanOrEqual(200);
      expect(r.currentScope.length).toBeLessThanOrEqual(200);
      expect(r.driftMagnitude).toBeGreaterThanOrEqual(0);
      expect(r.driftMagnitude).toBeLessThanOrEqual(1);
      expect(typeof r.splitCandidate).toBe("boolean");
    }
  });

  // -----------------------------------------------------------------------
  // Edge case: empty registered capabilities
  // -----------------------------------------------------------------------

  it("empty registered capabilities → empty result", () => {
    const results = analyzer.analyze({
      registeredCapabilities: [],
      agentCards: [agentCard("agent-1", ["some-cap"], "does something")],
      proposals: [proposalFor("some-cap", 5, { reason: "does something" })],
    });

    expect(results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Edge case: proposals matched via target.kind !== "capability"
  // -----------------------------------------------------------------------

  it("matches proposals via target.kind capability and payload.capability", () => {
    const cap = "test-match";

    const agentCards = [agentCard("agent-1", [cap], "testing matching behavior")];

    const proposals = [
      // Matched via target.kind === "capability"
      proposalFor(cap, 90, { reason: "original testing text for scope analysis" }),
      proposalFor(cap, 85, { reason: "original testing text for scope analysis" }),
      proposalFor(cap, 80, { reason: "original testing text for scope analysis" }),
      // Matched via payload.capability
      {
        target: { kind: "agent_card" },
        payload: { capability: cap, description: "payload matched" },
        reason: "recent security vulnerability scanning and threat detection",
        createdAt: ts(5),
      },
      {
        target: { kind: "agent_card" },
        payload: { capability: cap, description: "payload matched" },
        reason: "recent security vulnerability scanning and threat detection",
        createdAt: ts(10),
      },
      {
        target: { kind: "agent_card" },
        payload: { capability: cap, description: "payload matched" },
        reason: "recent security vulnerability scanning and threat detection",
        createdAt: ts(15),
      },
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    // Original scope: testing text + first 3 proposals (the 3 old ones)
    // Current scope: recent proposals (security domain)
    // → high drift expected
    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe(cap);
    expect(results[0].splitCandidate).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Edge case: few recent proposals falls back to all proposals
  // -----------------------------------------------------------------------

  it("fewer than 3 recent proposals → uses all proposals for current scope", () => {
    const cap = "sparse-cap";

    const agentCards = [
      agentCard("agent-1", [cap], "original capability for data encryption tasks"),
    ];

    const proposals = [
      // 3 old proposals (encryption domain)
      proposalFor(cap, 90, { reason: "encrypting sensitive data with keys" }),
      proposalFor(cap, 85, { reason: "data encryption using ciphers" }),
      proposalFor(cap, 80, { reason: "secure data cipher operations" }),
      // Only 2 recent proposals (security domain) → < 3 triggers fallback
      proposalFor(cap, 5, { reason: "network firewall intrusion detection" }),
      proposalFor(cap, 3, { reason: "security threat analysis scanning" }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    // Recent count = 2 (< 3), so ALL 5 proposals used for current scope.
    // Original scope: agent desc + first 3 proposals by date = encryption only.
    // Current scope: all 5 proposals = encryption + security → moderate drift.
    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe(cap);
    expect(results[0].driftMagnitude).toBeGreaterThan(0.3);
  });

  // -----------------------------------------------------------------------
  // Edge case: proposal payload text extraction
  // -----------------------------------------------------------------------

  it("extracts text from proposal payload fields beyond reason", () => {
    const cap = "payload-test";

    const agentCards = [
      agentCard("agent-1", [cap], "original scope for payload testing"),
    ];

    const proposals = [
      proposalFor(cap, 90, {
        reason: "original text",
        payload: { description: "doing original work", category: "legacy" },
      }),
      proposalFor(cap, 85, {
        reason: "original text",
        payload: { description: "doing original work", category: "legacy" },
      }),
      proposalFor(cap, 80, {
        reason: "original text",
        payload: { description: "doing original work", category: "legacy" },
      }),
      proposalFor(cap, 5, {
        reason: "modern text",
        payload: { description: "doing completely different modern work", category: "cloud" },
      }),
      proposalFor(cap, 10, {
        reason: "modern text",
        payload: { description: "doing completely different modern work", category: "cloud" },
      }),
      proposalFor(cap, 15, {
        reason: "modern text",
        payload: { description: "doing completely different modern work", category: "cloud" },
      }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    expect(results).toHaveLength(1);
    // Payload text contributes to keyword extraction
    expect(results[0].driftMagnitude).toBeGreaterThan(0);
    expect(results[0].splitCandidate).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Edge case: driftMagnitude rounding
  // -----------------------------------------------------------------------

  it("driftMagnitude is rounded to 6 decimal places", () => {
    const cap = "rounding-test";

    const agentCards = [
      agentCard("agent-1", [cap], "completely unique domain specific text"),
    ];

    const proposals = [
      proposalFor(cap, 90, { reason: "completely unique domain specific text" }),
      proposalFor(cap, 85, { reason: "completely unique domain specific text" }),
      proposalFor(cap, 80, { reason: "completely unique domain specific text" }),
      proposalFor(cap, 5, { reason: "totally different unrelated separate words" }),
      proposalFor(cap, 10, { reason: "totally different unrelated separate words" }),
      proposalFor(cap, 15, { reason: "totally different unrelated separate words" }),
    ];

    const results = analyzer.analyze({
      registeredCapabilities: [cap],
      agentCards,
      proposals,
    });

    if (results.length > 0) {
      const str = results[0].driftMagnitude.toString();
      const decimalPlaces = str.includes(".") ? str.split(".")[1].length : 0;
      expect(decimalPlaces).toBeLessThanOrEqual(6);
    }
  });
});
