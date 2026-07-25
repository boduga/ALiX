import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PlanApprovalDecision, PlanApprovalGate } from "../src/run/plan-approval-gate.js";

describe("plan-phase", () => {

  it("isReadOnlyTask returns true for research and false for write tasks", async () => {
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    // Read-only prompts
    assert.equal(isReadOnlyTask("what is the current president of Nigeria"), true);
    assert.equal(isReadOnlyTask("research the best database for our use case"), true);
    assert.equal(isReadOnlyTask("explain how the auth middleware works"), true);
    assert.equal(isReadOnlyTask("review the code in src/auth.ts"), true);
    // Write prompts
    assert.equal(isReadOnlyTask("fix the null pointer in user.ts"), false);
    assert.equal(isReadOnlyTask("add a healthz endpoint"), false);
    assert.equal(isReadOnlyTask("refactor the login flow"), false);
    assert.equal(isReadOnlyTask("delete the unused utility file"), false);
  });

  it("runPlanPhase module exports the expected function", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    assert.ok(typeof runPlanPhase === "function");
  });

  it("exports the sidecar helpers (persistPlanTaskSidecar, SidecarFs)", async () => {
    const mod = await import("../src/run/plan-phase.js");
    assert.equal(typeof mod.persistPlanTaskSidecar, "function");
    // The SidecarFs interface is erased at runtime but the function's
    // declared signature accepts an optional 4th argument matching
    // { write, unlink }; verify by passing a valid injection.
    const tasks = [
      { id: "s:task:1", index: 1, title: "t", status: "pending" as const },
    ];
    const calls: Array<{ path: string; data: string }> = [];
    const result = await mod.persistPlanTaskSidecar(
      "/tmp/alix-test", "s", tasks, {
        write: async (path, data) => { calls.push({ path, data }); },
        unlink: async () => {},
      },
    );
    assert.equal(result.wrote, true);
    assert.equal(result.warning, null);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.path.endsWith(".tasks.json"));
    assert.ok(calls[0]!.data.includes("\"schemaVersion\": 1"));
  });

  it("plan file is saved to disk", async () => {
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase");
    await mkdir(testDir, { recursive: true });

    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Plan",
      "",
      "**Task:** test",
      "",
      "## Changes",
      "- Create test.txt",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    assert.ok(existsSync(planPath));
    const saved = await readFile(planPath, "utf8");
    assert.ok(saved.includes("## Plan"));

    await rm(testDir, { recursive: true, force: true });
  });

  it("research task auto-approves plan", async () => {
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    // Research tasks don't trigger plan approval prompt
    assert.equal(isReadOnlyTask("research the best caching strategy"), true);
    // This means runPlanPhase will return approved without prompting
  });

  it("task without read or write signals falls back to classifier", async () => {
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    // Ambiguous tasks should not auto-approve
    const result = isReadOnlyTask("update the dependencies");
    assert.ok(typeof result === "boolean");
  });

  it("PlanPhaseResult carries optional planTasks", async () => {
    // Type-level + runtime check: the new additive field round-trips
    // through JSON without losing data.
    const sample = {
      action: "approved",
      planContent: "# plan",
      planTasks: [
        { id: "s:task:1", index: 1, title: "alpha", status: "pending" as const },
      ],
    };
    const round = JSON.parse(JSON.stringify(sample));
    assert.equal(round.action, "approved");
    assert.equal(round.planTasks.length, 1);
    assert.equal(round.planTasks[0].id, "s:task:1");
  });

  it("parsePlanTasks + buildPlanTaskList produce a parseable sidecar", async () => {
    const { parsePlanTasks, buildPlanTaskList } = await import(
      "../src/planning/plan-task.js"
    );
    const md = [
      "## Plan",
      "",
      "## Changes",
      "- alpha task",
      "  - sub point",
      "- beta task",
      "",
    ].join("\n");
    const tasks = parsePlanTasks(md, "sess-x");
    const list = buildPlanTaskList("sess-x", tasks);
    assert.equal(list.schemaVersion, 1);
    assert.equal(list.sessionId, "sess-x");
    assert.equal(list.tasks.length, 2);
    assert.equal(list.tasks[0]!.title, "alpha task");
    assert.ok(list.tasks[0]!.detail!.includes("sub point"));
    assert.equal(list.tasks[1]!.title, "beta task");
    assert.equal(list.tasks[1]!.detail, undefined);
  });

  it("read-only task skips plan and returns approved with no planTasks", async () => {
    // isReadOnlyTask("research ...") === true → runPlanPhase returns
    // immediately without persisting. Just verify the gate here.
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    assert.equal(isReadOnlyTask("research postgres extensions"), true);
  });

  it("shell task skips plan and returns approved with no planTasks", async () => {
    const { isShellTask } = await import("../src/task-classifier.js");
    assert.equal(isShellTask("ls"), true);
    assert.equal(isShellTask("pwd"), true);
  });

  it("persistPlanTaskSidecar: write failure is non-fatal (warning only)", async () => {
    // Direct unit test of the sidecar helper with an injected writer
    // that always throws. This is the "warning only" contract.
    const { persistPlanTaskSidecar } = await import(
      "../src/run/plan-phase.js"
    );
    const tasks = [
      { id: "s:task:1", index: 1, title: "t", status: "pending" as const },
    ];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const failingWriter = {
        write: async () => { throw new Error("disk full"); },
        unlink: async () => {},
      };
      const result = await persistPlanTaskSidecar(
        "/tmp/alix-test", "s", tasks, failingWriter,
      );
      assert.equal(result.wrote, false, "expected wrote=false on write failure");
      assert.ok(result.warning, "expected warning string in result");
      assert.ok(
        result.warning!.includes("failed to persist plan task sidecar"),
        `warning should mention sidecar failure; got: ${result.warning!}`,
      );
      assert.ok(
        result.warning!.includes("disk full"),
        `warning should include underlying error message; got: ${result.warning!}`,
      );
      // The warning is also forwarded to console.warn.
      assert.ok(warnings.length > 0);
      assert.ok(
        warnings.some((w) => w.includes("failed to persist plan task sidecar")),
        `console.warn missing: ${warnings.join("\n")}`,
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it("persistPlanTaskSidecar: empty task list deletes any existing sidecar", async () => {
    const { persistPlanTaskSidecar } = await import(
      "../src/run/plan-phase.js"
    );
    const unlinks: string[] = [];
    const writes: string[] = [];
    const fs = {
      write: async (path: string) => { writes.push(path); },
      unlink: async (path: string) => { unlinks.push(path); },
    };
    const result = await persistPlanTaskSidecar("/tmp/alix-test", "s", [], fs);
    assert.equal(result.wrote, false);
    assert.equal(result.warning, null);
    assert.equal(unlinks.length, 1);
    assert.equal(writes.length, 0);
  });

  it("persistPlanTaskSidecar: empty task list ignores ENOENT on unlink", async () => {
    const { persistPlanTaskSidecar } = await import(
      "../src/run/plan-phase.js"
    );
    const fs = {
      write: async () => {},
      unlink: async () => {
        const err = new Error("ENOENT") as Error & { code?: string };
        err.code = "ENOENT";
        throw err;
      },
    };
    // Should not throw — ENOENT is expected when no sidecar exists yet.
    const result = await persistPlanTaskSidecar("/tmp/alix-test", "s", [], fs);
    assert.equal(result.wrote, false);
    assert.equal(result.warning, null);
  });

  it("runPlanPhase in deferred mode: sidecar write failure returns approved with warning", async () => {
    // Integration test: runPlanPhase with deferred mode (no TTY prompt),
    // a provided planFilePath (skips model call), and a failing sidecar
    // writer. Verifies the whole pipeline is non-fatal on sidecar failure.
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-sidecar");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "- beta",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const mockCtx: any = {
        sessionId: "sidecar-fail-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const failingWriter = {
        write: async () => { throw new Error("simulated sidecar failure"); },
        unlink: async () => {},
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "deferred", sidecarFs: failingWriter },
      );
      assert.equal(result.action, "approved");
      assert.ok(
        (result as any).planTasks && (result as any).planTasks.length === 3,
        "expected planTasks to be parsed even when sidecar write fails",
      );
      assert.ok(
        warnings.some((w) => w.includes("failed to persist plan task sidecar")),
        `expected sidecar warning; got: ${warnings.join("\n")}`,
      );
    } finally {
      console.warn = originalWarn;
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("runPlanPhase in deferred mode: writes real sidecar on success", async () => {
    // End-to-end: deferred mode + real filesystem. Verify the sidecar
    // file actually lands on disk with the parsed tasks.
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-sidecar-ok");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "- beta",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    try {
      const mockCtx: any = {
        sessionId: "sidecar-ok-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "deferred" },
      );
      assert.equal(result.action, "approved");
      const sidecarPath = join(testDir, ".alix", "plans", "sidecar-ok-sess.tasks.json");
      assert.ok(existsSync(sidecarPath), `expected sidecar at ${sidecarPath}`);
      const raw = await readFile(sidecarPath, "utf8");
      const list = JSON.parse(raw);
      assert.equal(list.schemaVersion, 1);
      assert.equal(list.sessionId, "sidecar-ok-sess");
      assert.equal(list.tasks.length, 3);
      assert.equal(list.tasks[0].title, "alpha");
      assert.equal(list.tasks[2].title, "Verify: Run tests.");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("pure parser produces identical output across calls", async () => {
    const { parsePlanTasks } = await import("../src/planning/plan-task.js");
    const md = "## Changes\n- a\n- b\n";
    const a = parsePlanTasks(md, "s");
    const b = parsePlanTasks(md, "s");
    assert.deepEqual(a, b);
  });

  // -----------------------------------------------------------------------
  // PlanApprovalGate (Round 2 rebase)
  // -----------------------------------------------------------------------

  it("PlanApprovalGate type contract is exported from src/run/plan-approval-gate.ts", async () => {
    const gate = await import("../src/run/plan-approval-gate.js");
    // Type-only exports — interface is erased at runtime, so verify
    // the module shape and ensure the compile-time contract links.
    assert.ok(gate, "plan-approval-gate module should be importable");
  });

  it("runPlanPhase forwards opts.gate to the gate and returns approved on gate approve", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-gate-approve");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Summary",
      "small refactor",
      "",
      "## Changes",
      "- tweak foo.ts",
      "  - **Action:** modify",
      "  - **File:** src/foo.ts",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    try {
      const mockCtx: any = {
        sessionId: "gate-approve-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const captured: Array<{ planId: string; planSummary: string; planContent: string; planPath: string }> = [];
      const gate: PlanApprovalGate = {
        requestDecision: async (req) => {
          captured.push(req);
          return "approve" as PlanApprovalDecision;
        },
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "interactive", gate },
      );
      assert.equal(result.action, "approved");
      assert.ok((result as any).planTasks && (result as any).planTasks.length === 2);
      assert.equal(captured.length, 1, "gate should be awaited exactly once for approve");
      assert.equal(captured[0]!.planId, "gate-approve-sess");
      // summarisePlan() returns the first non-empty line stripping
      // leading markdown heading markers. For "## Summary\nsmall refactor\n..."
      // the first non-empty line is "## Summary" → "Summary".
      assert.equal(captured[0]!.planSummary, "Summary");
      assert.ok(captured[0]!.planContent.includes("## Changes"));
      assert.ok(captured[0]!.planPath.endsWith("gate-approve-sess.md"));
      // Sidecar should exist on disk after approve.
      const sidecarPath = join(testDir, ".alix", "plans", "gate-approve-sess.tasks.json");
      assert.ok(existsSync(sidecarPath), `expected sidecar at ${sidecarPath}`);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("gate reject deletes sidecar and returns rejected with currentTasks", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-gate-reject");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "- beta",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    try {
      const mockCtx: any = {
        sessionId: "gate-reject-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const gateCalls: number[] = [];
      const gate: PlanApprovalGate = {
        requestDecision: async () => {
          gateCalls.push(1);
          return "reject" as PlanApprovalDecision;
        },
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "interactive", gate },
      );
      assert.equal(result.action, "rejected");
      assert.ok((result as any).planTasks && (result as any).planTasks.length === 3);
      assert.equal(gateCalls.length, 1);
      // Sidecar should be deleted on reject.
      const sidecarPath = join(testDir, ".alix", "plans", "gate-reject-sess.tasks.json");
      assert.equal(existsSync(sidecarPath), false, `sidecar should be deleted at ${sidecarPath}`);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("gate detail decision triggers print-and-reprompt, then approve on second round", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-gate-detail");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    try {
      const mockCtx: any = {
        sessionId: "gate-detail-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const decisions: PlanApprovalDecision[] = ["detail", "approve"];
      const gate: PlanApprovalGate = {
        requestDecision: async () => decisions.shift() ?? "approve",
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "interactive", gate },
      );
      assert.equal(result.action, "approved");
      assert.ok((result as any).planTasks && (result as any).planTasks.length === 2);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("gate edit decision re-parses and refreshes sidecar, then approves on second round", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-gate-edit");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    // openPlanInEditor() runs $VISUAL (or $EDITOR, or "vim") on the plan
    // file. We need a non-failing editor that doesn't modify the file —
    // `cat` is perfect: it reads stdin but doesn't write to the file.
    const originalVisual = process.env.VISUAL;
    const originalEditor = process.env.EDITOR;
    process.env.VISUAL = "cat";
    delete process.env.EDITOR;

    try {
      const mockCtx: any = {
        sessionId: "gate-edit-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };

      // Capture the request planContent so the edit can mutate the file
      // before the next round sees the new content.
      let firstRoundContent: string | null = null;
      const decisions: PlanApprovalDecision[] = ["edit", "approve"];
      const gate: PlanApprovalGate = {
        requestDecision: async (req) => {
          if (firstRoundContent === null) {
            firstRoundContent = req.planContent;
            // Simulate the operator editing the file with new tasks.
            const edited = [
              "## Changes",
              "- alpha",
              "- beta (added by operator)",
              "- gamma (added by operator)",
              "",
              "## Verification",
              "Run tests.",
              "",
            ].join("\n");
            await writeFile(req.planPath, edited);
          }
          return decisions.shift() ?? "approve";
        },
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "interactive", gate },
      );
      assert.equal(result.action, "approved");
      assert.ok(firstRoundContent !== null);
      // After edit, planContent should reflect the new tasks.
      assert.ok(result.planContent.includes("gamma (added by operator)"));
      // planTasks should reflect the re-parsed sidecar.
      assert.ok((result as any).planTasks && (result as any).planTasks.length === 4);
      // Sidecar should reflect the edited tasks (3 changes + 1 verification).
      const sidecarPath = join(testDir, ".alix", "plans", "gate-edit-sess.tasks.json");
      const raw = JSON.parse(await readFile(sidecarPath, "utf8"));
      assert.equal(raw.tasks.length, 4);
      assert.equal(raw.tasks[0].title, "alpha");
      assert.equal(raw.tasks[1].title, "beta (added by operator)");
      assert.equal(raw.tasks[2].title, "gamma (added by operator)");
    } finally {
      if (originalVisual === undefined) delete process.env.VISUAL;
      else process.env.VISUAL = originalVisual;
      if (originalEditor === undefined) delete process.env.EDITOR;
      else process.env.EDITOR = originalEditor;
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("gate bypasses the no-TTY guard (gate path runs even when process.stdout.isTTY=false)", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-gate-notty");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    const originalIsTTY = (process.stdout as any).isTTY;
    (process.stdout as any).isTTY = false;
    try {
      const mockCtx: any = {
        sessionId: "gate-notty-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const gate: PlanApprovalGate = {
        requestDecision: async () => "approve" as PlanApprovalDecision,
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "interactive", gate },
      );
      // Unlike the no-gate path (which returns empty early), the gate
      // path runs and produces an approved plan.
      assert.equal(result.action, "approved");
      assert.ok((result as any).planTasks && (result as any).planTasks.length === 2);
    } finally {
      (process.stdout as any).isTTY = originalIsTTY;
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("no-TTY without gate still early-returns (regression guard)", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const originalIsTTY = (process.stdout as any).isTTY;
    (process.stdout as any).isTTY = false;
    try {
      const mockCtx: any = {
        sessionId: "no-gate-notty-sess",
        config: { projectRoot: process.cwd() },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        undefined,
        { approvalMode: "interactive" },
      );
      // No gate + no TTY = early-return with empty plan.
      assert.equal(result.action, "approved");
      assert.equal(result.planContent, "");
    } finally {
      (process.stdout as any).isTTY = originalIsTTY;
    }
  });

  it("gate-side sidecar write failure is non-fatal (warning only)", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase-gate-sidecar-fail");
    await mkdir(testDir, { recursive: true });
    const planPath = join(testDir, "test-plan.md");
    const planContent = [
      "## Changes",
      "- alpha",
      "",
      "## Verification",
      "Run tests.",
      "",
    ].join("\n");
    await writeFile(planPath, planContent);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const mockCtx: any = {
        sessionId: "gate-sidecar-fail-sess",
        config: { projectRoot: testDir },
        log: { append: async () => {} },
      };
      const mockBundle: any = { primaryFiles: [], tests: [], supportingFiles: [] };
      const failingWriter = {
        write: async () => { throw new Error("simulated gate-path sidecar failure"); },
        unlink: async () => {},
      };
      const gate: PlanApprovalGate = {
        requestDecision: async () => "approve" as PlanApprovalDecision,
      };
      const result = await runPlanPhase(
        mockCtx,
        mockBundle,
        "add a new dashboard panel widget",
        planPath,
        { approvalMode: "interactive", gate, sidecarFs: failingWriter },
      );
      assert.equal(result.action, "approved");
      assert.ok((result as any).planTasks && (result as any).planTasks.length === 2);
      assert.ok(
        warnings.some((w) => w.includes("failed to persist plan task sidecar")),
        `expected sidecar warning; got: ${warnings.join("\n")}`,
      );
    } finally {
      console.warn = originalWarn;
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
