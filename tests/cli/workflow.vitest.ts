/**
 * P4.5c — Workflow CLI tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkflowCoordinator } from "../../src/workflow/coordinator.js";
import { WORKFLOW_STATES } from "../../src/workflow/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = join("/tmp", "wf-cli-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests — we test the coordinator methods the CLI wraps
// ---------------------------------------------------------------------------

describe("workflow CLI", () => {
  let dir: string;
  let coordinator: WorkflowCoordinator;

  beforeEach(() => {
    dir = tmpDir();
    coordinator = new WorkflowCoordinator({ workflowDir: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("status", () => {
    it("shows workflow status for an issue", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });

      const state = await coordinator.currentState(61);
      expect(state).not.toBeNull();
      expect(state!.issueNumber).toBe(61);
      expect(state!.state).toBe("NEW");
    });

    it("returns nothing for unknown issue", async () => {
      const state = await coordinator.currentState(999);
      expect(state).toBeNull();
    });
  });

  describe("list", () => {
    it("lists active workflow entries", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await coordinator.recover(62, "COMPLETE", "Test setup");

      const active = await coordinator.listActive();
      expect(active.length).toBe(1);
      expect(active[0].issueNumber).toBe(61);
    });

    it("shows empty when no active workflows", async () => {
      const active = await coordinator.listActive();
      expect(active.length).toBe(0);
    });
  });

  describe("transition", () => {
    it("first transition must be NEW", async () => {
      await expect(
        coordinator.transition(61, "SELECTED", { actor: "human" }),
      ).rejects.toThrow();
    });

    it("transitions an issue through the CLI path", async () => {
      const entry = await coordinator.transition(61, "NEW", {
        actor: "system",
      });
      expect(entry.state).toBe("NEW");

      const entry2 = await coordinator.transition(61, "SELECTED", {
        actor: "IssueIntakeAgent",
      });
      expect(entry2.state).toBe("SELECTED");
    });

    it("rejects invalid transitions", async () => {
      await coordinator.transition(61, "NEW", { actor: "system" });
      await expect(
        coordinator.transition(61, "COMPLETE" as any, { actor: "system" }),
      ).rejects.toThrow();
    });

    it("has valid WORKFLOW_STATES that match What the CLI validates", () => {
      expect(WORKFLOW_STATES.has("NEW")).toBe(true);
      expect(WORKFLOW_STATES.has("COMPLETE")).toBe(true);
      expect(WORKFLOW_STATES.has("BLOCKED")).toBe(true);
      expect(WORKFLOW_STATES.has("INVALID")).toBe(false);
    });
  });
});
