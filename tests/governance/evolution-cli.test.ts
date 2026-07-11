/**
 * Tests for A0.4 — Evolution Governance Surface CLI.
 *
 * Covers list, show, evidence commands in both human and JSON modes.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvolutionStateMachine } from "../../src/evolution/evolution-state-machine.js";
import { ExecutionEvidenceStore } from "../../src/runtime/execution-evidence-store.js";
import { handleEvolutionCommand } from "../../src/governance/evolution-cli.js";
import { EvolutionState } from "../../src/evolution/contracts/evolution-contract.js";

// ---------------------------------------------------------------------------
// Capture console for testing
// ---------------------------------------------------------------------------

class ConsoleCapture {
  private originalLog: typeof console.log = console.log;
  private originalError: typeof console.error = console.error;
  lines: string[] = [];

  start(): void {
    this.lines = [];
    console.log = (...args: unknown[]) => {
      this.lines.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      this.lines.push(args.map(String).join(" "));
    };
  }

  restore(): void {
    console.log = this.originalLog;
    console.error = this.originalError;
  }

  output(): string {
    return this.lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(dirs?: { evidenceDir?: string }) {
  const sm = new EvolutionStateMachine();

  const evidenceDir = dirs?.evidenceDir ?? mkdtempSync(join(tmpdir(), "evol-cli-"));
  const store = new ExecutionEvidenceStore(evidenceDir);

  const capture = new ConsoleCapture();

  const cleanup = () => {
    try {
      rmSync(evidenceDir, { recursive: true, force: true });
    } catch { /* ok */ }
  };

  return { sm, store, capture, cleanup };
}

function addTestEvolution(
  sm: EvolutionStateMachine,
  id: string,
  state: EvolutionState = EvolutionState.DRAFT,
  meta?: Record<string, string>,
): void {
  sm.createEvolution(
    id,
    state,
    meta ? { targetKind: meta.targetKind, targetId: meta.targetId, origin: meta.origin, createdAt: meta.createdAt } : undefined,
  );
}

const T = "2026-07-11T10:00:00.000Z";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evolution list", () => {
  it("empty list prints 'No evolutions found'", async () => {
    const { sm, store, capture, cleanup } = setup();
    capture.start();
    try {
      await handleEvolutionCommand(["list"], { stateMachine: sm, evidenceStore: store });
      assert.ok(capture.output().includes("No evolutions found"));
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("lists evolutions with correct state", async () => {
    const { sm, store, capture, cleanup } = setup();
    addTestEvolution(sm, "evol-alpha", EvolutionState.APPROVED, { targetKind: "policy", createdAt: T });
    addTestEvolution(sm, "evol-beta", EvolutionState.DRAFT, { targetKind: "agent_behavior", createdAt: T });

    capture.start();
    try {
      await handleEvolutionCommand(["list"], { stateMachine: sm, evidenceStore: store });
      const out = capture.output();
      assert.ok(out.includes("evol-alpha"));
      assert.ok(out.includes("evol-beta"));
      assert.ok(out.includes("APPROVED"));
      assert.ok(out.includes("DRAFT"));
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("list --json produces valid JSON", async () => {
    const { sm, store, capture, cleanup } = setup();
    addTestEvolution(sm, "evol-json", EvolutionState.ACTIVE, { targetKind: "runtime_config", createdAt: T });

    capture.start();
    try {
      await handleEvolutionCommand(["list", "--json"], { stateMachine: sm, evidenceStore: store });
      const parsed = JSON.parse(capture.output());
      assert.ok(Array.isArray(parsed));
      assert.equal(parsed[0].evolutionId, "evol-json");
      assert.equal(parsed[0].state, "ACTIVE");
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("list empty --json returns []", async () => {
    const { sm, store, capture, cleanup } = setup();
    capture.start();
    try {
      await handleEvolutionCommand(["list", "--json"], { stateMachine: sm, evidenceStore: store });
      assert.equal(JSON.parse(capture.output()).length, 0);
    } finally {
      capture.restore();
      cleanup();
    }
  });
});

describe("evolution show", () => {
  it("shows evolution details", async () => {
    const { sm, store, capture, cleanup } = setup();
    addTestEvolution(sm, "evol-show-1", EvolutionState.PROPOSED, {
      targetKind: "policy", targetId: "pol-001", origin: "operator", createdAt: T,
    });

    capture.start();
    try {
      await handleEvolutionCommand(["show", "evol-show-1"], { stateMachine: sm, evidenceStore: store });
      const out = capture.output();
      assert.ok(out.includes("evol-show-1"));
      assert.ok(out.includes("PROPOSED"));
      assert.ok(out.includes("policy"));
      assert.ok(out.includes("operator"));
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("show --json produces valid JSON", async () => {
    const { sm, store, capture, cleanup } = setup();
    addTestEvolution(sm, "evol-json-show", EvolutionState.ACTIVE, { targetKind: "workflow", createdAt: T });

    capture.start();
    try {
      await handleEvolutionCommand(["show", "evol-json-show", "--json"], { stateMachine: sm, evidenceStore: store });
      const parsed = JSON.parse(capture.output());
      assert.equal(parsed.evolutionId, "evol-json-show");
      assert.equal(parsed.state, "ACTIVE");
      assert.equal(parsed.target.kind, "workflow");
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("show with unknown id prints error", async () => {
    const { sm, store, capture, cleanup } = setup();
    capture.start();
    try {
      await handleEvolutionCommand(["show", "nonexistent"], { stateMachine: sm, evidenceStore: store });
      assert.ok(capture.output().includes("not found"));
      assert.equal(process.exitCode, 1);
      process.exitCode = 0; // reset
    } finally {
      capture.restore();
      cleanup();
    }
  });
});

describe("evolution evidence", () => {
  it("shows evidence records", async () => {
    const { sm, store, capture, cleanup } = setup();
    sm.createEvolution("evol-ev-1");

    // Write test evidence directly to the store
    await store.append({
      evidenceId: "evoe-test-001",
      intentId: "evol-ev-1",
      startedAt: T,
      completedAt: T,
      outcome: "PARTIAL",
      summary: "Evolution EvolutionProposed: DRAFT → PROPOSED",
      artifacts: [],
      verificationPassed: false,
      evidenceHash: "",
    });

    capture.start();
    try {
      await handleEvolutionCommand(["evidence", "evol-ev-1"], { stateMachine: sm, evidenceStore: store });
      const out = capture.output();
      assert.ok(out.includes("evol-ev-1"));
      assert.ok(out.includes("evoe-test-001"));
      assert.ok(out.includes("EvolutionProposed"));
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("evidence --json produces valid JSON", async () => {
    const { sm, store, capture, cleanup } = setup();
    sm.createEvolution("evol-ev-json");

    await store.append({
      evidenceId: "evoe-json-001",
      intentId: "evol-ev-json",
      startedAt: T,
      completedAt: T,
      outcome: "PARTIAL",
      summary: "Evolution EvolutionProposed: DRAFT → PROPOSED",
      artifacts: [],
      verificationPassed: false,
      evidenceHash: "",
    });

    capture.start();
    try {
      await handleEvolutionCommand(["evidence", "evol-ev-json", "--json"], { stateMachine: sm, evidenceStore: store });
      const parsed = JSON.parse(capture.output());
      assert.equal(parsed.evolutionId, "evol-ev-json");
      assert.equal(parsed.evidence.length, 1);
      assert.equal(parsed.evidence[0].evidenceId, "evoe-json-001");
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("evidence with no records prints message", async () => {
    const { sm, store, capture, cleanup } = setup();
    sm.createEvolution("evol-ev-empty");

    capture.start();
    try {
      await handleEvolutionCommand(["evidence", "evol-ev-empty"], { stateMachine: sm, evidenceStore: store });
      assert.ok(capture.output().includes("No evidence found"));
    } finally {
      capture.restore();
      cleanup();
    }
  });

  it("evidence with unknown id prints error", async () => {
    const { sm, store, capture, cleanup } = setup();
    capture.start();
    try {
      await handleEvolutionCommand(["evidence", "nonexistent"], { stateMachine: sm, evidenceStore: store });
      assert.ok(capture.output().includes("not found"));
      process.exitCode = 0;
    } finally {
      capture.restore();
      cleanup();
    }
  });
});

describe("evolution help", () => {
  it("prints help for no args", async () => {
    const { sm, store, capture, cleanup } = setup();
    capture.start();
    try {
      await handleEvolutionCommand([], { stateMachine: sm, evidenceStore: store });
      assert.ok(capture.output().includes("Usage"));
    } finally {
      capture.restore();
      cleanup();
    }
  });
});

describe("listEvolutions", () => {
  it("returns all evolutions sorted by createdAt", () => {
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-a", EvolutionState.DRAFT, { createdAt: "2026-07-11T10:00:00Z" });
    sm.createEvolution("evol-b", EvolutionState.DRAFT, { createdAt: "2026-07-11T09:00:00Z" });

    const list = sm.listEvolutions();
    assert.equal(list.length, 2);
    assert.equal(list[0].evolutionId, "evol-b"); // earlier timestamp first
    assert.equal(list[1].evolutionId, "evol-a");
  });

  it("returns targetKind from metadata", () => {
    const sm = new EvolutionStateMachine();
    sm.createEvolution("evol-tk", EvolutionState.DRAFT, { targetKind: "policy" });

    const list = sm.listEvolutions();
    assert.equal(list[0].targetKind, "policy");
  });
});
