/**
 * tests/planning/plan-task.test.ts — node:test coverage for parsePlanTasks
 * and buildPlanTaskList (Task 5: action-based routing).
 *
 * The parser is section-scoped: only `## Changes` and `## Verification`
 * produce tasks. Legacy simple-bullet tests are retained by wrapping
 * the bullets in a `## Changes` block.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlanTasks,
  buildPlanTaskList,
  type PlanTask,
} from "../../src/planning/plan-task.js";

describe("plan-task", () => {
  describe("parsePlanTasks", () => {
    it("returns empty array for empty input", () => {
      const tasks = parsePlanTasks("", "sess-1");
      assert.deepEqual(tasks, []);
    });

    it("returns empty array for non-task-shaped markdown", () => {
      const md = "## Summary\n\nJust a heading with prose.\n\nNo bullets here.\n";
      const tasks = parsePlanTasks(md, "sess-1");
      assert.deepEqual(tasks, []);
    });

    it("ignores bullets outside `## Changes` section", () => {
      // Bullets in Summary / Risk Assessment must NOT become tasks.
      const md = [
        "## Summary",
        "- This bullet should be ignored",
        "",
        "## Risk Assessment",
        "- **Risk level:** low",
        "- **Blast radius:** nothing",
        "- **New dependencies:** none",
        "",
        "## Verification",
        "Run pnpm test.",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "sess-1");
      assert.equal(tasks.length, 1, "expected only the verification task");
      assert.equal(tasks[0]!.title, "Verify: Run pnpm test.");
    });

    it("parses simple dash-bullet tasks inside `## Changes`", () => {
      const md = [
        "## Changes",
        "",
        "- First task",
        "- Second task",
        "- Third task",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "sess-abc");
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0]!.title, "First task");
      assert.equal(tasks[1]!.title, "Second task");
      assert.equal(tasks[2]!.title, "Third task");
      assert.equal(tasks[0]!.id, "sess-abc:task:1");
      assert.equal(tasks[2]!.id, "sess-abc:task:3");
      assert.equal(tasks[0]!.index, 1);
      assert.equal(tasks[2]!.index, 3);
    });

    it("parses checkbox-prefixed tasks", () => {
      const md = [
        "## Changes",
        "",
        "- [ ] Write tests",
        "- [x] Old completed task",
        "- [X] Another completed",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0]!.title, "Write tests");
      assert.equal(tasks[1]!.title, "Old completed task");
      assert.equal(tasks[2]!.title, "Another completed");
    });

    it("parses numbered list tasks", () => {
      const md = [
        "## Changes",
        "",
        "1. First",
        "2. Second",
        "3. Third",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0]!.title, "First");
      assert.equal(tasks[2]!.title, "Third");
    });

    it("collects indented sub-bullets as detail", () => {
      const md = [
        "## Changes",
        "- Parent task",
        "  - sub point A",
        "  - sub point B",
        "- Next task",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]!.title, "Parent task");
      assert.ok(tasks[0]!.detail, "expected detail on first task");
      assert.ok(tasks[0]!.detail!.includes("sub point A"));
      assert.ok(tasks[0]!.detail!.includes("sub point B"));
      assert.equal(tasks[1]!.detail, undefined);
    });

    it("stops collecting detail on blank line", () => {
      const md = [
        "## Changes",
        "- First",
        "  - indented",
        "",
        "- Second",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 2);
      assert.ok(tasks[0]!.detail!.includes("indented"));
      assert.equal(tasks[1]!.detail, undefined);
    });

    it("ignores indented top-level-looking bullets", () => {
      const md = [
        "## Changes",
        "- Top task",
        "  - nested bullet (not a task)",
        "- Another top task",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]!.title, "Top task");
      assert.equal(tasks[1]!.title, "Another top task");
    });

    it("sets initial status to pending", () => {
      const md = "## Changes\n- Only task\n";
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.status, "pending");
    });

    it("uses sessionId in id format", () => {
      const md = "## Changes\n- task\n";
      const tasks = parsePlanTasks(md, "session-xyz-123");
      assert.equal(tasks[0]!.id, "session-xyz-123:task:1");
    });

    it("index starts at 1 and is sequential", () => {
      const md = "## Changes\n- a\n- b\n- c\n- d\n";
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 4);
      assert.deepEqual(
        tasks.map((t) => t.index),
        [1, 2, 3, 4],
      );
      assert.deepEqual(
        tasks.map((t) => t.id),
        ["s:task:1", "s:task:2", "s:task:3", "s:task:4"],
      );
    });

    it("handles mixed bullet shapes", () => {
      const md = [
        "## Changes",
        "- dash task",
        "* star task",
        "1. numbered task",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0]!.title, "dash task");
      assert.equal(tasks[1]!.title, "star task");
      assert.equal(tasks[2]!.title, "numbered task");
    });

    it("skips empty title lines", () => {
      const md = [
        "## Changes",
        "- ",
        "- real task",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.title, "real task");
    });

    it("handles CRLF line endings", () => {
      const md = "## Changes\r\n- one\r\n- two\r\n- three\r\n";
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0]!.title, "one");
      assert.equal(tasks[2]!.title, "three");
    });

    it("creates a single verification task from `## Verification`", () => {
      const md = [
        "## Changes",
        "- alpha",
        "- beta",
        "",
        "## Verification",
        "Run the test suite via pnpm test.",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
      assert.equal(tasks[0]!.title, "alpha");
      assert.equal(tasks[1]!.title, "beta");
      assert.equal(tasks[2]!.title, "Verify: Run the test suite via pnpm test.");
      assert.ok(tasks[2]!.detail!.includes("Run the test suite"));
    });

    it("creates a verification task from a bullet in `## Verification`", () => {
      const md = [
        "## Changes",
        "- alpha",
        "",
        "## Verification",
        "- pnpm test",
        "- pnpm build",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]!.title, "alpha");
      assert.equal(tasks[1]!.title, "Verify: pnpm test");
    });

    it("skips empty `## Verification` body", () => {
      const md = [
        "## Changes",
        "- alpha",
        "",
        "## Verification",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.title, "alpha");
    });

    it("combines Changes + Verification tasks with continuous indexing", () => {
      const md = [
        "## Changes",
        "- a",
        "- b",
        "",
        "## Verification",
        "Run tests.",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
      assert.deepEqual(
        tasks.map((t) => t.index),
        [1, 2, 3],
      );
      assert.equal(tasks[0]!.id, "s:task:1");
      assert.equal(tasks[1]!.id, "s:task:2");
      assert.equal(tasks[2]!.id, "s:task:3");
    });

    it("h3 sub-headings do not match (only `##` headings open new sections)", () => {
      const md = [
        "### Changes",
        "- this should NOT be parsed as a task",
        "",
        "## Changes",
        "- this should be parsed",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.title, "this should be parsed");
    });

    it("excludes `## Risk Assessment` and metadata bullets", () => {
      const md = [
        "## Changes",
        "- alpha",
        "",
        "## Verification",
        "Run tests.",
        "",
        "## Risk Assessment",
        "- **Risk level:** low",
        "- **Blast radius:** nothing",
        "- **New dependencies:** none",
        "",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]!.title, "alpha");
      assert.equal(tasks[1]!.title, "Verify: Run tests.");
    });

    it("ignores `## Summary` and `## Primary Files` bullets", () => {
      const md = [
        "## Summary",
        "- bullet in summary",
        "",
        "## Primary Files",
        "- src/foo.ts",
        "",
        "## Related Tests",
        "- tests/foo.test.ts",
        "",
        "## Changes",
        "- the real task",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0]!.title, "the real task");
    });

    it("handles planner-format bullet with Action/File/Description sub-bullets", () => {
      // The planner's `buildPlanSystemPrompt` template instructs the model
      // to emit each change as a top-level bullet with three sub-bullets
      // (Action / File / Description). Verify the parser captures the
      // metadata as `detail`.
      const md = [
        "## Changes",
        "- modify src/foo.ts",
        "  - **Action:** modify",
        "  - **File:** src/foo.ts",
        "  - **Description:** refactor to use new helper",
        "- create src/bar.ts",
        "  - **Action:** create",
        "  - **File:** src/bar.ts",
        "  - **Description:** new helper module",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 2);
      assert.equal(tasks[0]!.title, "modify src/foo.ts");
      assert.ok(tasks[0]!.detail!.includes("Action:"));
      assert.ok(tasks[0]!.detail!.includes("File:"));
      assert.ok(tasks[0]!.detail!.includes("Description:"));
      assert.equal(tasks[1]!.title, "create src/bar.ts");
    });

    it("plan approval gate options preserved (no behavior change)", () => {
      // Sanity: parser does not throw on markdown with both types of bullets.
      const md = [
        "## Changes",
        "- [ ] task A",
        "  - sub",
        "* task B",
        "1. task C",
      ].join("\n");
      const tasks = parsePlanTasks(md, "s");
      assert.equal(tasks.length, 3);
    });

    it("is pure (no hidden I/O)", () => {
      const md = "## Changes\n- a\n- b\n";
      const a = parsePlanTasks(md, "s");
      const b = parsePlanTasks(md, "s");
      assert.deepEqual(a, b);
    });
  });

  describe("buildPlanTaskList", () => {
    it("returns a schemaVersion=1 list with empty summary", () => {
      const tasks: PlanTask[] = [
        { id: "s:task:1", index: 1, title: "a", status: "pending" },
        { id: "s:task:2", index: 2, title: "b", status: "pending" },
      ];
      const list = buildPlanTaskList("s", tasks);
      assert.equal(list.schemaVersion, 1);
      assert.equal(list.sessionId, "s");
      assert.equal(list.summary, "");
      assert.equal(list.tasks.length, 2);
    });

    it("copies the tasks array (input is not mutated)", () => {
      const tasks: PlanTask[] = [
        { id: "s:task:1", index: 1, title: "a", status: "pending" },
      ];
      const list = buildPlanTaskList("s", tasks);
      assert.notEqual(list.tasks, tasks);
      assert.deepEqual(list.tasks, tasks);
    });

    it("accepts readonly inputs", () => {
      const tasks: readonly PlanTask[] = [
        { id: "s:task:1", index: 1, title: "a", status: "pending" },
      ];
      const list = buildPlanTaskList("s", tasks);
      assert.equal(list.tasks.length, 1);
    });
  });
});
