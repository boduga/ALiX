import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";

/**
 * P7.6d — Chat Inspector tests.
 *
 * Each inspector must return a string even when the underlying store is
 * empty or the directory does not exist.  Graceful degradation is the
 * key invariant.
 */

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "alix-chat-inspector-"));
  _tmpDirs.push(d);
  return d;
}

const _tmpDirs: string[] = [];

afterEach(() => {
  for (const d of _tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  _tmpDirs.length = 0;
});

describe("ChatInspector", () => {
  // -----------------------------------------------------------------------
  // inspectProposals
  // -----------------------------------------------------------------------

  describe("inspectProposals", () => {
    it("returns a string for a non-existent directory", async () => {
      const { inspectProposals } = await import("../../src/chat/chat-inspector.js");
      const result = await inspectProposals(join(tmpdir(), "nonexistent-proposals-dir"));
      expect(typeof result).toBe("string");
    });

    it('returns "No proposals found." for an empty directory', async () => {
      const { inspectProposals } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      const result = await inspectProposals(dir);
      expect(result).toBe("No proposals found.");
    });

    it("returns a formatted string when proposals exist", async () => {
      const { inspectProposals } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      // Write a minimal valid proposal JSON file
      const proposal = {
        id: "prop-2026-06-22-001",
        createdAt: new Date().toISOString(),
        status: "pending",
        action: "add_capability",
        target: { kind: "capability", capability: "test" },
        payload: {},
        sourceRecommendationType: "test",
        sourceConfidence: 0.9,
        evidenceFingerprints: [],
        reason: "Test proposal for inspector",
      };
      writeFileSync(join(dir, "prop-2026-06-22-001.json"), JSON.stringify(proposal));
      const result = await inspectProposals(dir);
      expect(result).toContain("prop-2026-06-22-001");
      expect(result).toContain("[pending]");
      expect(result).toContain("Test proposal for inspector");
    });
  });

  // -----------------------------------------------------------------------
  // inspectSkills
  // -----------------------------------------------------------------------

  describe("inspectSkills", () => {
    it("returns a string for a non-existent directory", async () => {
      const { inspectSkills } = await import("../../src/chat/chat-inspector.js");
      const result = await inspectSkills(join(tmpdir(), "nonexistent-skills-dir"));
      expect(typeof result).toBe("string");
    });

    it('returns "No skills installed." for an empty directory', async () => {
      const { inspectSkills } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      const result = await inspectSkills(dir);
      expect(result).toBe("No skills installed.");
    });

    it("returns a formatted string when skills exist", async () => {
      const { inspectSkills } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      // Create a minimal skill extension directory
      const skillDir = join(dir, "skill-test-skill");
      mkdirSync(skillDir, { recursive: true });
      const manifest = [
        "name: test-skill",
        "version: 2.0.0",
        "description: A test skill for the inspector",
        "type: skill",
        "trigger: /test",
      ].join("\n");
      writeFileSync(join(skillDir, "EXTENSION.yaml"), manifest);
      const result = await inspectSkills(dir);
      expect(result).toContain("test-skill");
      expect(result).toContain("v2.0.0");
      expect(result).toContain("[/test]");
    });
  });

  // -----------------------------------------------------------------------
  // inspectOutcomes
  // -----------------------------------------------------------------------

  describe("inspectOutcomes", () => {
    it("returns a string for a non-existent directory", async () => {
      const { inspectOutcomes } = await import("../../src/chat/chat-inspector.js");
      const result = await inspectOutcomes(join(tmpdir(), "nonexistent-outcomes-dir"));
      expect(typeof result).toBe("string");
    });

    it('returns "No outcomes recorded." for an empty directory', async () => {
      const { inspectOutcomes } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      const result = await inspectOutcomes(dir);
      expect(result).toBe("No outcomes recorded.");
    });

    it("returns a formatted string when outcomes exist", async () => {
      const { inspectOutcomes } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      // Write a minimal outcomes.jsonl
      const record = {
        id: "outcome:2026-06-22-test1",
        subject: "Test outcome",
        outcome: "success",
        confidence: 1,
        reasons: ["test"],
        generatedAt: new Date().toISOString(),
        subjectId: "prop-test-1",
        subjectType: "proposal",
        actionTaken: "Applied capability to agent",
        observationWindowDays: 7,
      };
      writeFileSync(join(dir, "outcomes.jsonl"), JSON.stringify(record) + "\n");
      const result = await inspectOutcomes(dir);
      expect(result).toContain("outcome:2026-06-22-test1");
      expect(result).toContain("[success]");
      expect(result).toContain("Applied capability to agent");
    });

    it("returns only the last 10 outcomes", async () => {
      const { inspectOutcomes } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      let content = "";
      const makeRecord = (i: number) => ({
        id: `outcome:2026-06-22-${String(i).padStart(3, "0")}`,
        subject: `Test ${i}`,
        outcome: "success" as const,
        confidence: 1,
        reasons: ["test"],
        generatedAt: new Date().toISOString(),
        subjectId: `prop-${i}`,
        subjectType: "proposal",
        actionTaken: `Action ${i}`,
        observationWindowDays: 7,
      });
      for (let i = 0; i < 15; i++) {
        content += JSON.stringify(makeRecord(i)) + "\n";
      }
      writeFileSync(join(dir, "outcomes.jsonl"), content);
      const result = await inspectOutcomes(dir);
      // Should mention the last 10, not the first 5
      expect(result).toContain("outcome:2026-06-22-005");
      expect(result).toContain("outcome:2026-06-22-014");
      expect(result).not.toContain("outcome:2026-06-22-000");
      expect(result).not.toContain("outcome:2026-06-22-004");
      const lines = result.split("\n");
      expect(lines.length).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // inspectIntents
  // -----------------------------------------------------------------------

  describe("inspectIntents", () => {
    it("returns a string for a non-existent directory", async () => {
      const { inspectIntents } = await import("../../src/chat/chat-inspector.js");
      const result = await inspectIntents(join(tmpdir(), "nonexistent-intents-dir"));
      expect(typeof result).toBe("string");
    });

    it('returns "No intents found." for an empty directory', async () => {
      const { inspectIntents } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      const result = await inspectIntents(dir);
      expect(result).toBe("No intents found.");
    });

    it("returns a formatted string when intents exist", async () => {
      const { inspectIntents } = await import("../../src/chat/chat-inspector.js");
      const dir = tempDir();
      const record = {
        id: "intent:2026-06-22-test1",
        subject: "Test intent",
        outcome: "captured",
        confidence: 1,
        reasons: ["test"],
        generatedAt: new Date().toISOString(),
        source: "skill_run",
        input: "test input",
        outputSummary: "test summary",
        status: "captured",
        rationale: "Test intent rationale for inspector",
        sourceArtifacts: [],
      };
      writeFileSync(join(dir, "intents.jsonl"), JSON.stringify(record) + "\n");
      const result = await inspectIntents(dir);
      expect(result).toContain("intent:2026-06-22-test1");
      expect(result).toContain("[captured]");
      expect(result).toContain("Test intent rationale for inspector");
    });
  });
});
