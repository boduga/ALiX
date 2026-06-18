/**
 * P4.5c — Workflow state file and coordinator tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateFile } from "../../src/workflow/state-file.js";
import { WorkflowCoordinator } from "../../src/workflow/coordinator.js";
import type { WorkflowStateEntry } from "../../src/workflow/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "wf-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

function makeStateFile(dir?: string): { stateFile: StateFile; dir: string } {
  const d = dir ?? tmpDir();
  return { stateFile: new StateFile(d), dir: d };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// StateFile tests
// ---------------------------------------------------------------------------

describe("StateFile", () => {
  let dir: string;
  let stateFile: StateFile;

  beforeEach(() => {
    const m = makeStateFile();
    dir = m.dir;
    stateFile = m.stateFile;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("readState / writeState", () => {
    it("returns empty map when state file does not exist", async () => {
      const entries = await stateFile.readState();
      expect(entries).toBeInstanceOf(Map);
      expect(entries.size).toBe(0);
    });

    it("persists and reads back state entries", async () => {
      const entries = new Map<number, WorkflowStateEntry>();
      entries.set(61, {
        issueNumber: 61,
        state: "NEW",
        assignedAgent: null,
        evidenceFingerprints: [],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        humanGateRequired: false,
      });
      await stateFile.writeState(entries);

      const read = await stateFile.readState();
      expect(read.size).toBe(1);
      expect(read.get(61)?.state).toBe("NEW");
      expect(read.get(61)?.issueNumber).toBe(61);
    });

    it("handles multiple entries", async () => {
      const entries = new Map<number, WorkflowStateEntry>();
      for (const n of [61, 62, 63]) {
        entries.set(n, {
          issueNumber: n,
          state: n === 61 ? "NEW" : n === 62 ? "EXECUTING" : "COMPLETE",
          assignedAgent: null,
          evidenceFingerprints: [],
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          humanGateRequired: false,
        });
      }
      await stateFile.writeState(entries);

      const read = await stateFile.readState();
      expect(read.size).toBe(3);
      expect(read.get(62)?.state).toBe("EXECUTING");
    });

    it("overwrites existing data on write", async () => {
      const entries1 = new Map<number, WorkflowStateEntry>();
      entries1.set(61, {
        issueNumber: 61, state: "NEW", assignedAgent: null,
        evidenceFingerprints: [], startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z", humanGateRequired: false,
      });
      await stateFile.writeState(entries1);

      const entries2 = new Map<number, WorkflowStateEntry>();
      entries2.set(61, {
        issueNumber: 61, state: "SELECTED", assignedAgent: null,
        evidenceFingerprints: [], startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z", humanGateRequired: false,
      });
      await stateFile.writeState(entries2);

      const read = await stateFile.readState();
      expect(read.get(61)?.state).toBe("SELECTED");
      expect(read.size).toBe(1);
    });

    it("returns empty map on corrupted state file", async () => {
      writeFileSync(join(dir, "state.json"), "not valid json{ broken", "utf-8");
      const entries = await stateFile.readState();
      expect(entries).toBeInstanceOf(Map);
      expect(entries.size).toBe(0);
    });
  });

  describe("acquireLock", () => {
    it("acquires and releases a lock", async () => {
      const lock = await stateFile.acquireLock();
      expect(lock.ok).toBe(true);
      expect(lock.path).toContain("state.json.lock");
      lock.release();

      const lock2 = await stateFile.acquireLock();
      expect(lock2.ok).toBe(true);
      lock2.release();
    });

    it("prevents concurrent access then releases", async () => {
      const sf2 = new StateFile(dir);
      const lock1 = await stateFile.acquireLock();
      // Second acquire should wait; release quickly
      const lock2Promise = sf2.acquireLock();
      await sleep(50);
      lock1.release();
      const lock2 = await lock2Promise;
      expect(lock2.ok).toBe(true);
      lock2.release();
    });
  });

  describe("appendHistory", () => {
    it("appends a history event to the file", async () => {
      await stateFile.appendHistory({
        timestamp: new Date().toISOString(),
        issueNumber: 61,
        from: null,
        to: "NEW",
        actor: "system",
      });

      const content = readFileSync(join(dir, "history.jsonl"), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.issueNumber).toBe(61);
      expect(parsed.to).toBe("NEW");
    });

    it("appends multiple events", async () => {
      await stateFile.appendHistory({
        timestamp: new Date().toISOString(), issueNumber: 61,
        from: null, to: "NEW", actor: "system",
      });
      await stateFile.appendHistory({
        timestamp: new Date().toISOString(), issueNumber: 61,
        from: "NEW", to: "SELECTED", actor: "system",
      });

      const content = readFileSync(join(dir, "history.jsonl"), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);
    });
  });

  describe("getPaths", () => {
    it("returns correct paths", () => {
      const paths = stateFile.getPaths();
      expect(paths.statePath).toBe(join(dir, "state.json"));
      expect(paths.lockPath).toBe(join(dir, "state.json.lock"));
      expect(paths.historyPath).toBe(join(dir, "history.jsonl"));
    });
  });
});

// ---------------------------------------------------------------------------
// WorkflowCoordinator tests
// ---------------------------------------------------------------------------

describe("WorkflowCoordinator", () => {
  let dir: string;
  let coordinator: WorkflowCoordinator;

  beforeEach(() => {
    dir = tmpDir();
    coordinator = new WorkflowCoordinator({ workflowDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("transition", () => {
    it("first transition must be NEW", async () => {
      await expect(
        coordinator.transition(61, "SELECTED", { actor: "system" }),
      ).rejects.toThrow(/first transition must be/i);

      // Transitioning to NEW should work
      const entry = await coordinator.transition(61, "NEW", { actor: "system" });
      expect(entry.state).toBe("NEW");
    });

    it("follows allowed transitions NEW → SELECTED", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      const entry = await coordinator.transition(61, "SELECTED", {
        actor: "IssueIntakeAgent",
        reason: "Issue matched ready-for-agent label",
      });
      expect(entry.state).toBe("SELECTED");
    });

    it("follows a full happy-path transition chain", async () => {
      const chain: Array<{ to: string; actor: string }> = [
        { to: "NEW", actor: "system" },
        { to: "SELECTED", actor: "IssueIntakeAgent" },
        { to: "PLANNED", actor: "PlanningAgent" },
        { to: "APPROVED_FOR_EXECUTION", actor: "human" },
        { to: "EXECUTING", actor: "ExecutionAgent" },
        { to: "UNDER_REVIEW", actor: "ExecutionAgent" },
        { to: "PR_READY", actor: "ReviewAgent" },
        { to: "AWAITING_HUMAN", actor: "PRAgent" },
        { to: "MERGED", actor: "human" },
        { to: "COMPLETE", actor: "system" },
      ];

      for (const step of chain) {
        const entry = await coordinator.transition(61, step.to as any, {
          actor: step.actor as any,
        });
        expect(entry.state).toBe(step.to);
      }

      const current = await coordinator.currentState(61);
      expect(current?.state).toBe("COMPLETE");
    });

    it("throws on invalid transitions", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      // NEW → EXECUTING is not allowed
      await expect(
        coordinator.transition(61, "EXECUTING", { actor: "system" }),
      ).rejects.toThrow(/invalid transition/i);
    });

    it("throws on transition from COMPLETE", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(61, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(61, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(61, "APPROVED_FOR_EXECUTION", { actor: "human" });
      await coordinator.transition(61, "EXECUTING", { actor: "ExecutionAgent" });
      await coordinator.transition(61, "UNDER_REVIEW", { actor: "ExecutionAgent" });
      await coordinator.transition(61, "PR_READY", { actor: "ReviewAgent" });
      await coordinator.transition(61, "AWAITING_HUMAN", { actor: "PRAgent" });
      await coordinator.transition(61, "MERGED", { actor: "human" });
      await coordinator.transition(61, "COMPLETE", { actor: "system" });
      await expect(
        coordinator.transition(61, "NEW", { actor: "system" }),
      ).rejects.toThrow(/invalid transition/i);
    });

    it("records history entry on each transition", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(61, "SELECTED", { actor: "IssueIntakeAgent" });

      const content = readFileSync(join(dir, "history.jsonl"), "utf-8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBe(2);
      const first = JSON.parse(lines[0]);
      expect(first.from).toBeNull();
      expect(first.to).toBe("NEW");
      const second = JSON.parse(lines[1]);
      expect(second.from).toBe("NEW");
      expect(second.to).toBe("SELECTED");
    });
  });

  describe("currentState", () => {
    it("returns the current state for an issue", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      const state = await coordinator.currentState(61);
      expect(state).not.toBeNull();
      expect(state!.state).toBe("NEW");
    });

    it("returns null for an unknown issue", async () => {
      const state = await coordinator.currentState(999);
      expect(state).toBeNull();
    });
  });

  describe("listActive", () => {
    it("returns only non-terminal states", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(62, "NEW", { actor: "system" });
      await coordinator.transition(62, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.recover(63, "COMPLETE", "Test setup");

      const active = await coordinator.listActive();
      expect(active.length).toBe(2);
      const states = active.map((e) => e.issueNumber).sort();
      expect(states).toEqual([61, 62]);
    });
  });

  describe("block / unblock", () => {
    it("blocks an executing issue", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(61, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(61, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(61, "APPROVED_FOR_EXECUTION", { actor: "human" });
      await coordinator.transition(61, "EXECUTING", { actor: "ExecutionAgent" });

      const blocked = await coordinator.block(61, "Waiting for CI", "ci-build-#1234");
      expect(blocked.state).toBe("BLOCKED");
      expect(blocked.blockReason).toBe("Waiting for CI");
      expect(blocked.blockingItem).toBe("ci-build-#1234");
      expect(typeof blocked.blockedAt).toBe("string");
    });

    it("unblocks an issue back to EXECUTING", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(61, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(61, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(61, "APPROVED_FOR_EXECUTION", { actor: "human" });
      await coordinator.transition(61, "EXECUTING", { actor: "ExecutionAgent" });
      await coordinator.block(61, "Waiting for CI");

      const unblocked = await coordinator.unblock(61);
      expect(unblocked.state).toBe("EXECUTING");
    });

    it("throws when blocking an issue not in EXECUTING", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });

      await expect(
        coordinator.block(61, "Cannot block from NEW"),
      ).rejects.toThrow(/invalid transition/i);
    });

    it("throws when unblocking an issue that is not BLOCKED", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await expect(coordinator.unblock(61)).rejects.toThrow(/not blocked/i);
    });

    it("block metadata persists after reload", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(61, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(61, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(61, "APPROVED_FOR_EXECUTION", { actor: "human" });
      await coordinator.transition(61, "EXECUTING", { actor: "ExecutionAgent" });
      await coordinator.block(61, "Network timeout", "ci-run-5678");

      // Reload from disk
      const coordinator2 = new WorkflowCoordinator({ workflowDir: dir });
      const state = await coordinator2.currentState(61);
      expect(state).not.toBeNull();
      expect(state!.state).toBe("BLOCKED");
      expect(state!.blockReason).toBe("Network timeout");
      expect(state!.blockingItem).toBe("ci-run-5678");
      expect(typeof state!.blockedAt).toBe("string");
    });
  });

  describe("assignAgent / releaseAgent", () => {
    it("assigns an agent to an issue", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.assignAgent(61, "IssueIntakeAgent");

      const state = await coordinator.currentState(61);
      expect(state?.assignedAgent).toBe("IssueIntakeAgent");
    });

    it("releases an agent from an issue", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.assignAgent(61, "IssueIntakeAgent");
      await coordinator.releaseAgent(61);

      const state = await coordinator.currentState(61);
      expect(state?.assignedAgent).toBeNull();
    });

    it("throws on assign for unknown issue", async () => {
      await expect(
        coordinator.assignAgent(999, "ExecutionAgent"),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("detectStale", () => {
    it("returns stale entries older than threshold", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(62, "NEW", { actor: "system" });

      await sleep(5);
      const stale = await coordinator.detectStale(1);
      expect(stale.length).toBe(2);
      expect(stale.map((e) => e.issueNumber).sort()).toEqual([61, 62]);
    });

    it("excludes COMPLETE and MERGED from stale detection", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(62, "NEW", { actor: "system" });
      await coordinator.transition(62, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(62, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(62, "APPROVED_FOR_EXECUTION", { actor: "human" });
      await coordinator.transition(62, "EXECUTING", { actor: "ExecutionAgent" });
      await coordinator.transition(62, "UNDER_REVIEW", { actor: "ExecutionAgent" });
      await coordinator.transition(62, "PR_READY", { actor: "ReviewAgent" });
      await coordinator.transition(62, "AWAITING_HUMAN", { actor: "PRAgent" });
      await coordinator.transition(62, "MERGED", { actor: "human" });
      await coordinator.transition(62, "COMPLETE", { actor: "system" });
      await coordinator.recover(63, "COMPLETE", "Test setup");

      await sleep(5);
      const stale = await coordinator.detectStale(1);
      expect(stale.length).toBe(1);
      expect(stale[0].issueNumber).toBe(61);
    });
  });

  describe("recover", () => {
    it("force-transitions an issue to a new state", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });

      const recovered = await coordinator.recover(
        61,
        "SELECTED",
        "Manual recovery after crash",
      );
      expect(recovered.state).toBe("SELECTED");
    });

    it("can force invalid normal transitions", async () => {
      // BLOCKED → SELECTED is NOT in ALLOWED_TRANSITIONS
      // but recover() should allow it
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.transition(61, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(61, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(61, "APPROVED_FOR_EXECUTION", { actor: "human" });
      await coordinator.transition(61, "EXECUTING", { actor: "ExecutionAgent" });
      await coordinator.block(61, "CI failure");

      const recovered = await coordinator.recover(61, "SELECTED", "Reset after CI fix");
      expect(recovered.state).toBe("SELECTED");
    });

    it("rejects unknown target state", async () => {
      await expect(
        coordinator.recover(61, "INVALID_STATE" as any, "test"),
      ).rejects.toThrow(/invalid target state/i);
    });
  });

  describe("evidence recording integration", () => {
    it("evidence failure does not block transition", async () => {
      // No evidence store configured — transition should still work
      const entry = await coordinator.transition(61, "NEW", {
        actor: "system",
        evidenceType: "issue_selected",
        evidencePayload: { source: "test" },
      });
      expect(entry.state).toBe("NEW");
      // No evidence fingerprints since there's no store
      expect(entry.evidenceFingerprints.length).toBe(0);
    });
  });
});
