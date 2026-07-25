/**
 * tests/session-resume.vitest.ts — Task 6 (action-based routing).
 *
 * Verifies `reconstructSession()` correctly restores structured plan
 * tasks from the `.tasks.json` sidecar written by `runPlanPhase`:
 *
 *   1. Valid sidecar → return its tasks verbatim.
 *   2. Missing sidecar → fall back to `parsePlanTasks(planContent, sessionId)`.
 *   3. Malformed sidecar (invalid JSON) → fall back to parsePlanTasks.
 *   4. Schema-incompatible sidecar (wrong schemaVersion) → fall back.
 *   5. Empty/garbage task array → still considered valid (returns []).
 *   6. Missing plan content → no planTasks (undefined).
 *   7. Resume never throws when sidecar is broken.
 *   8. The `isValidTasksSidecar` validator rejects malformed input.
 *   9. The `isValidTasksSidecar` validator accepts well-formed input.
 *
 * Sidecar schemaVersion lock = 1 (matches Task 5's `buildPlanTaskList`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidTasksSidecar,
  reconstructSession,
} from "../src/session/resume.js";

const SESSIONS_DIR = ".alix/sessions";
const PLANS_DIR = ".alix/plans";

let testCwd: string;
let testSessionId: string;
let cleanup: (() => Promise<void>) | null = null;

beforeEach(async () => {
  testCwd = await mkdtemp(join(tmpdir(), "session-resume-"));
  cleanup = async () => { await rm(testCwd, { recursive: true, force: true }); };
  testSessionId = "abc12345-1234-1234-1234-1234567890ab";
});

afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = null;
});

/** Helper: create the .alix/sessions/<id> dir with a single user message. */
async function writeSession(cwd: string, sessionId: string, task: string) {
  const sessionDir = join(cwd, SESSIONS_DIR, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "messages.jsonl"),
    `${JSON.stringify({ role: "user", content: task })}\n`,
  );
}

/** Helper: write a .md plan file. */
async function writePlan(cwd: string, sessionId: string, planContent: string) {
  const planDir = join(cwd, PLANS_DIR);
  await mkdir(planDir, { recursive: true });
  await writeFile(join(planDir, `${sessionId}.md`), planContent);
}

/** Helper: write a .tasks.json sidecar. */
async function writeSidecar(cwd: string, sessionId: string, data: unknown) {
  const planDir = join(cwd, PLANS_DIR);
  await mkdir(planDir, { recursive: true });
  await writeFile(
    join(planDir, `${sessionId}.tasks.json`),
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
  );
}

/** Helper: write events.jsonl marking session as completed. */
async function writeCompletedEvents(cwd: string, sessionId: string) {
  const sessionDir = join(cwd, SESSIONS_DIR, sessionId);
  await mkdir(sessionDir, { recursive: true });
  const events = [
    JSON.stringify({
      id: "1", seq: 1, version: 1,
      sessionId, timestamp: "2026-07-24T00:00:00Z",
      type: "session.started", actor: "system", payload: {},
    }),
    JSON.stringify({
      id: "2", seq: 2, version: 1,
      sessionId, timestamp: "2026-07-24T00:01:00Z",
      type: "session.ended", actor: "system",
      payload: { reason: "completed" },
    }),
  ];
  await writeFile(join(sessionDir, "events.jsonl"), `${events.join("\n")}\n`);
}

/** Helper: write state.json so completed-flag detection can short-circuit. */
async function writeStoppedState(cwd: string, sessionId: string, iterations = 1) {
  const sessionDir = join(cwd, SESSIONS_DIR, sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "state.json"),
    JSON.stringify({
      state: "stopped",
      counters: { iterations, repairs: 0, fileChanges: 0, shellCommands: 0 },
    }),
  );
}

describe("isValidTasksSidecar", () => {
  it("accepts a well-formed sidecar", () => {
    const sidecar = {
      schemaVersion: 1,
      sessionId: "s1",
      summary: "",
      tasks: [
        { id: "s1:task:1", index: 1, title: "Task one", status: "pending" },
        { id: "s1:task:2", index: 2, title: "Task two", status: "completed", detail: "extra" },
      ],
    };
    expect(isValidTasksSidecar(sidecar)).toBe(true);
  });

  it("rejects null/non-object input", () => {
    expect(isValidTasksSidecar(null)).toBe(false);
    expect(isValidTasksSidecar(undefined)).toBe(false);
    expect(isValidTasksSidecar(42)).toBe(false);
    expect(isValidTasksSidecar("string")).toBe(false);
    expect(isValidTasksSidecar([])).toBe(false);
  });

  it("rejects wrong schemaVersion", () => {
    const sidecar = {
      schemaVersion: 2,
      sessionId: "s1",
      summary: "",
      tasks: [],
    };
    expect(isValidTasksSidecar(sidecar)).toBe(false);
  });

  it("rejects missing or non-string sessionId/summary", () => {
    expect(isValidTasksSidecar({ schemaVersion: 1, sessionId: 42, summary: "", tasks: [] })).toBe(false);
    expect(isValidTasksSidecar({ schemaVersion: 1, sessionId: "", summary: "", tasks: [] })).toBe(false);
    expect(isValidTasksSidecar({ schemaVersion: 1, sessionId: "s1", summary: 5, tasks: [] })).toBe(false);
  });

  it("rejects non-array tasks", () => {
    expect(isValidTasksSidecar({ schemaVersion: 1, sessionId: "s1", summary: "", tasks: "bad" })).toBe(false);
  });

  it("rejects task with bad status", () => {
    const sidecar = {
      schemaVersion: 1,
      sessionId: "s1",
      summary: "",
      tasks: [{ id: "s1:task:1", index: 1, title: "x", status: "weird" }],
    };
    expect(isValidTasksSidecar(sidecar)).toBe(false);
  });

  it("rejects task with non-integer index", () => {
    const sidecar = {
      schemaVersion: 1,
      sessionId: "s1",
      summary: "",
      tasks: [{ id: "s1:task:1", index: 1.5, title: "x", status: "pending" }],
    };
    expect(isValidTasksSidecar(sidecar)).toBe(false);
  });

  it("rejects task with non-string detail", () => {
    const sidecar = {
      schemaVersion: 1,
      sessionId: "s1",
      summary: "",
      tasks: [{ id: "s1:task:1", index: 1, title: "x", status: "pending", detail: 5 }],
    };
    expect(isValidTasksSidecar(sidecar)).toBe(false);
  });

  it("accepts empty tasks array", () => {
    expect(isValidTasksSidecar({ schemaVersion: 1, sessionId: "s1", summary: "", tasks: [] })).toBe(true);
  });

  it("accepts all four valid statuses", () => {
    for (const status of ["pending", "in_progress", "completed", "skipped"] as const) {
      const sidecar = {
        schemaVersion: 1,
        sessionId: "s1",
        summary: "",
        tasks: [{ id: "s1:task:1", index: 1, title: "x", status }],
      };
      expect(isValidTasksSidecar(sidecar)).toBe(true);
    }
  });
});

describe("reconstructSession — sidecar loading", () => {
  const PLAN_MD = `## Summary
A demo plan.

## Changes
- Add widget A
- Add widget B
- Add widget C

## Verification
- Run tests
`;

  it("returns structured planTasks from a valid sidecar", async () => {
    await writeSession(testCwd, testSessionId, "Add a dashboard panel widget");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 1,
      sessionId: testSessionId,
      summary: "",
      tasks: [
        { id: `${testSessionId}:task:1`, index: 1, title: "From sidecar A", status: "completed" },
        { id: `${testSessionId}:task:2`, index: 2, title: "From sidecar B", status: "pending" },
      ],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks).toHaveLength(2);
    expect(result.planTasks![0]!.title).toBe("From sidecar A");
    expect(result.planTasks![0]!.status).toBe("completed");
    expect(result.planTasks![1]!.title).toBe("From sidecar B");
    expect(result.planTasks![1]!.status).toBe("pending");
    expect(result.planContent).toBe(PLAN_MD);
  });

  it("preserves custom status from sidecar", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 1,
      sessionId: testSessionId,
      summary: "",
      tasks: [
        { id: `${testSessionId}:task:1`, index: 1, title: "done", status: "completed" },
        { id: `${testSessionId}:task:2`, index: 2, title: "in progress", status: "in_progress" },
        { id: `${testSessionId}:task:3`, index: 3, title: "skipped", status: "skipped" },
      ],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks!.map(t => t.status)).toEqual([
      "completed",
      "in_progress",
      "skipped",
    ]);
  });

  it("preserves task detail field from sidecar", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 1,
      sessionId: testSessionId,
      summary: "",
      tasks: [
        {
          id: `${testSessionId}:task:1`,
          index: 1,
          title: "with detail",
          status: "pending",
          detail: "  - sub bullet\n  - another",
        },
      ],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks![0]!.detail).toContain("sub bullet");
    expect(result.planTasks![0]!.detail).toContain("another");
  });

  it("accepts valid sidecar with empty task array (parsed to zero tasks)", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 1,
      sessionId: testSessionId,
      summary: "",
      tasks: [],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toEqual([]);
  });
});

describe("reconstructSession — fallback to parsePlanTasks", () => {
  const PLAN_MD = `## Summary
A demo plan.

## Changes
- Add widget A
- Add widget B

## Verification
- Run unit tests
`;

  it("falls back to parsePlanTasks when sidecar is missing", async () => {
    await writeSession(testCwd, testSessionId, "Add a dashboard panel widget");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    // No sidecar written.

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks!.length).toBeGreaterThan(0);
    // parsePlanTasks section-scoped: ## Changes + ## Verification.
    const titles = result.planTasks!.map(t => t.title);
    expect(titles).toContain("Add widget A");
    expect(titles).toContain("Add widget B");
    // Verification task gets the "Verify:" prefix.
    expect(titles.some(t => t.startsWith("Verify:"))).toBe(true);
    // Sidecar-missing fallback creates pending tasks (fresh state).
    for (const t of result.planTasks!) {
      expect(t.status).toBe("pending");
    }
  });

  it("falls back when sidecar contains invalid JSON", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, "{ this is not valid json ###");

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks!.length).toBeGreaterThan(0);
    expect(result.planTasks!.map(t => t.title)).toContain("Add widget A");
  });

  it("falls back when sidecar has wrong schemaVersion", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 99,
      sessionId: testSessionId,
      summary: "future sidecar",
      tasks: [{ id: "x", index: 1, title: "x", status: "pending" }],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks!.map(t => t.title)).toContain("Add widget A");
    // Falls back to markdown parser (status pending), not the sidecar's
    // pending task.
    expect(result.planTasks!.every(t => t.status === "pending")).toBe(true);
  });

  it("falls back when sidecar structure is invalid (missing fields)", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 1,
      // missing sessionId
      summary: "",
      tasks: [],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks!.length).toBeGreaterThan(0);
  });

  it("falls back when sidecar has structurally-broken tasks", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, {
      schemaVersion: 1,
      sessionId: testSessionId,
      summary: "",
      tasks: [{ id: "x", index: "not-a-number", title: "x", status: "pending" }],
    });

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks!.length).toBeGreaterThan(0);
  });

  it("returns no planTasks when no plan and no sidecar exist", async () => {
    await writeSession(testCwd, testSessionId, "task");
    // No plan, no sidecar.

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planContent).toBeNull();
    expect(result.planTasks).toBeUndefined();
  });

  it("returns planContent but no planTasks when plan has no task-shaped bullets", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, "## Summary\nJust a brief note.");

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planContent).toContain("Just a brief note");
    // parsePlanTasks returns [] for plans without Changes/Verification sections.
    // The empty-array fallback is intentional — callers can still iterate safely.
    expect(result.planTasks).toEqual([]);
  });
});

describe("reconstructSession — never fails on sidecar issues", () => {
  const PLAN_MD = "## Changes\n- First change\n";

  it("does not throw when sidecar is unreadable garbage", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    // Garbage that may or may not be parseable.
    await writeSidecar(testCwd, testSessionId, "\x00\x01\x02 not json");

    await expect(reconstructSession(testCwd, testSessionId)).resolves.toBeDefined();
  });

  it("does not throw when sidecar JSON is a bare primitive", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, '"just a string"');

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
    expect(result.planTasks!.length).toBeGreaterThan(0);
  });

  it("does not throw when sidecar is an empty file", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writePlan(testCwd, testSessionId, PLAN_MD);
    await writeSidecar(testCwd, testSessionId, "");

    const result = await reconstructSession(testCwd, testSessionId);

    expect(result.planTasks).toBeDefined();
  });
});

describe("reconstructSession — completed flag", () => {
  it("completed=false when no session.ended event with reason=completed", async () => {
    await writeSession(testCwd, testSessionId, "task");
    expect((await reconstructSession(testCwd, testSessionId)).completed).toBe(false);
  });

  it("completed=true when session.ended with reason=completed", async () => {
    await writeSession(testCwd, testSessionId, "task");
    await writeStoppedState(testCwd, testSessionId);
    await writeCompletedEvents(testCwd, testSessionId);

    const result = await reconstructSession(testCwd, testSessionId);
    expect(result.completed).toBe(true);
  });
});

describe("reconstructSession — messages + scope state", () => {
  it("loads user messages from messages.jsonl", async () => {
    await writeSession(testCwd, testSessionId, "first user message");
    const result = await reconstructSession(testCwd, testSessionId);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
    expect(result.messages[0]!.content).toBe("first user message");
  });

  it("returns sessionId and sessionDir", async () => {
    await writeSession(testCwd, testSessionId, "task");
    const result = await reconstructSession(testCwd, testSessionId);
    expect(result.sessionId).toBe(testSessionId);
    expect(result.sessionDir).toBe(join(testCwd, SESSIONS_DIR, testSessionId));
  });

  it("returns empty scopeSnapshot/stateSnapshot when not present", async () => {
    await writeSession(testCwd, testSessionId, "task");
    const result = await reconstructSession(testCwd, testSessionId);
    expect(result.scopeSnapshot).toBeNull();
    expect(result.stateSnapshot).toBeNull();
  });
});

describe("reconstructSession — error paths", () => {
  it("throws when session does not exist", async () => {
    await expect(
      reconstructSession(testCwd, "ghost-session"),
    ).rejects.toThrow(/Session not found/);
  });
});
