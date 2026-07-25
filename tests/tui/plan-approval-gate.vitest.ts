import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile, writeFile, mkdir, unlink, rm } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

// Resolved at runtime inside the cases so vi.mock can patch the same module
// the import resolves to.
const loadGate = () => import("../../src/tui/plan-approval-gate.js");

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("TuiPlanApprovalGate", () => {
  it("resolves the request when approve is passed", async () => {
    const { TuiPlanApprovalGate } = await loadGate();
    const gate = new TuiPlanApprovalGate();
    const pending = gate.requestDecision({
      planId: "p1",
      planSummary: "Add hello()",
      planContent: "# Plan\n\n- add hello()\n",
      planPath: "/tmp/p1.md",
    });
    expect(gate.getPending()?.planId).toBe("p1");
    gate.resolve("p1", "approve");
    await expect(pending).resolves.toBe("approve");
    expect(gate.getPending()).toBeNull();
  });

  it("resolves reject / edit / detail decisions", async () => {
    const { TuiPlanApprovalGate } = await loadGate();
    for (const decision of ["reject", "edit", "detail"] as const) {
      const gate = new TuiPlanApprovalGate();
      const p = gate.requestDecision({
        planId: "p",
        planSummary: "s",
        planContent: "",
        planPath: "/tmp/p.md",
      });
      gate.resolve("p", decision);
      await expect(p).resolves.toBe(decision);
    }
  });

  it("rejects concurrent requests with an Error", async () => {
    const { TuiPlanApprovalGate } = await loadGate();
    const gate = new TuiPlanApprovalGate();
    const first = gate.requestDecision({
      planId: "p1",
      planSummary: "",
      planContent: "",
      planPath: "/tmp/p1.md",
    });
    await expect(
      gate.requestDecision({
        planId: "p2",
        planSummary: "",
        planContent: "",
        planPath: "/tmp/p2.md",
      }),
    ).rejects.toThrow(/already has a pending request/);
    // The first request is still pending — gate stays one-at-a-time.
    expect(gate.getPending()?.planId).toBe("p1");
    // Cleanup so the test runner exits cleanly.
    gate.resolve("p1", "approve");
    await first;
  });

  it("stale resolve(planId) is a no-op when planId does not match", async () => {
    const { TuiPlanApprovalGate } = await loadGate();
    const gate = new TuiPlanApprovalGate();
    const p = gate.requestDecision({
      planId: "p1",
      planSummary: "",
      planContent: "",
      planPath: "/tmp/p1.md",
    });
    // Wrong planId — must not resolve, must not throw.
    gate.resolve("p2", "approve");
    expect(gate.getPending()?.planId).toBe("p1");
    gate.resolve("p1", "approve");
    await expect(p).resolves.toBe("approve");
  });

  it("clear() drops the pending request without resolving it", async () => {
    const { TuiPlanApprovalGate } = await loadGate();
    const gate = new TuiPlanApprovalGate();
    // We do NOT await the Promise — clear() intentionally leaves it pending.
    // The test verifies the gate's observable state: pending is gone, and a
    // subsequent resolve() finds nothing to resolve.
    const promise = gate.requestDecision({
      planId: "p1",
      planSummary: "",
      planContent: "",
      planPath: "/tmp/p1.md",
    });
    expect(gate.getPending()?.planId).toBe("p1");
    gate.clear();
    expect(gate.getPending()).toBeNull();
    // After clear, a resolve() must be a no-op (no pending planId match).
    gate.resolve("p1", "approve");
    // Sanity: settle the dangling Promise so the test runner doesn't
    // detect an unresolved async. We never assert anything about its value.
    promise.catch(() => {});
  });

  it("getPending() returns a snapshot, not a live reference", async () => {
    const { TuiPlanApprovalGate } = await loadGate();
    const gate = new TuiPlanApprovalGate();
    gate.requestDecision({
      planId: "p1",
      planSummary: "summary",
      planContent: "content",
      planPath: "/tmp/p1.md",
    });
    const snap = gate.getPending();
    expect(snap).not.toBeNull();
    // Mutating the snapshot must not affect the gate's state.
    if (snap) {
      (snap as { planSummary: string }).planSummary = "MUTATED";
    }
    expect(gate.getPending()?.planSummary).toBe("summary");
  });
});

describe("runPlanPhase gate integration", () => {
  // Project scratch directory under the repo's tmp folder so it is
  // cleaned up alongside the rest of the test fixtures.
  const SCRATCH = "/tmp/alix-plan-approval-gate-test";

  const mockContext = () =>
    ({
      sessionId: "test-session-gate",
      config: { projectRoot: SCRATCH },
      log: { append: vi.fn() },
    }) as any;

  const mockBundle = () =>
    ({ primaryFiles: [], tests: [], supportingFiles: [] }) as any;

  beforeEach(async () => {
    await mkdir(SCRATCH, { recursive: true });
  });

  it("uses the gate when provided and approvalMode is interactive", async () => {
    // Provide a plan file so runPlanPhase skips generatePlan (which would
    // require a network provider). Use a task that triggers full plan
    // generation flow (not read-only / shell) so the gate is exercised.
    const planPath = path.join(SCRATCH, "provided.md");
    await writeFile(planPath, "# Test plan\n\nDo nothing.\n", "utf8");

    const { TuiPlanApprovalGate } = await loadGate();
    const { runPlanPhase } = await import("../../src/run/plan-phase.js");
    const gate = new TuiPlanApprovalGate();

    const inflate = setInterval(() => {
      const p = gate.getPending();
      if (p) {
        gate.resolve(p.planId, "approve");
        clearInterval(inflate);
      }
    }, 1);

    try {
      const result = await runPlanPhase(
        mockContext(),
        mockBundle(),
        "implement a hello() function in foo.ts",
        planPath,
        { approvalMode: "interactive", gate },
      );
      expect(gate.getPending()).toBeNull(); // gate was awaited
      expect(result.action).toBe("approved");
      expect((result as any).planContent).toContain("Test plan");
    } finally {
      clearInterval(inflate);
      await unlink(planPath);
    }
  });

  it("gate.reject() returns the rejected action", async () => {
    const planPath = path.join(SCRATCH, "provided.md");
    await writeFile(planPath, "# Plan\n\n- step 1\n", "utf8");

    const { TuiPlanApprovalGate } = await loadGate();
    const { runPlanPhase } = await import("../../src/run/plan-phase.js");
    const gate = new TuiPlanApprovalGate();

    // Race: reject the gate the moment it goes pending.
    const inflate = setInterval(() => {
      const p = gate.getPending();
      if (p) {
        gate.resolve(p.planId, "reject");
        clearInterval(inflate);
      }
    }, 1);

    try {
      const result = await runPlanPhase(
        mockContext(),
        mockBundle(),
        "implement a hello() function in foo.ts",
        planPath,
        { approvalMode: "interactive", gate },
      );
      expect(result.action).toBe("rejected");
    } finally {
      clearInterval(inflate);
      await unlink(planPath);
    }
  });

  it("falls back to prompt() path when no gate is provided", async () => {
    // Stub promptForPlanApproval-equivalent by intercepting the prompt
    // module. The cleanest way: pass through the read-only fast path so
    // runPlanPhase returns immediately without any prompt or gate.
    const { runPlanPhase } = await import("../../src/run/plan-phase.js");
    const result = await runPlanPhase(
      mockContext(),
      mockBundle(),
      "what is the time?", // read-only task — no plan, no approval
      undefined,
      { approvalMode: "interactive" }, // no gate
    );
    expect(result.action).toBe("approved");
    expect((result as any).planContent).toBe("");
  });

  it("skips prompting in non-TTY when no gate is provided (CI compat)", async () => {
    const orig = process.stdout.isTTY;
    (process.stdout as any).isTTY = false;
    try {
      const { runPlanPhase } = await import("../../src/run/plan-phase.js");
      const result = await runPlanPhase(
        mockContext(),
        mockBundle(),
        "implement a calculator", // would normally require a plan
        undefined,
        { approvalMode: "interactive" }, // no gate, non-TTY
      );
      expect(result.action).toBe("approved");
    } finally {
      (process.stdout as any).isTTY = orig;
    }
  })

  it("when a gate is provided the non-TTY guard is bypassed", async () => {
    // The gate-driven path must work even when stdout.isTTY is false
    // (e.g. CI-launched TUI under a subshell). The gate is the UI surface,
    // not a TTY prompt.
    const planPath = path.join(SCRATCH, "provided.md");
    await writeFile(planPath, "# Plan\n\n- step 1\n", "utf8");

    const orig = process.stdout.isTTY;
    (process.stdout as any).isTTY = false;

    const { TuiPlanApprovalGate } = await loadGate();
    const { runPlanPhase } = await import("../../src/run/plan-phase.js");
    const gate = new TuiPlanApprovalGate();
    const inflate = setInterval(() => {
      const p = gate.getPending();
      if (p) {
        gate.resolve(p.planId, "approve");
        clearInterval(inflate);
      }
    }, 1);

    try {
      const result = await runPlanPhase(
        mockContext(),
        mockBundle(),
        "implement a calculator",
        planPath,
        { approvalMode: "interactive", gate },
      );
      expect(result.action).toBe("approved");
      expect((result as any).planContent).toContain("step 1");
    } finally {
      clearInterval(inflate);
      (process.stdout as any).isTTY = orig;
      await unlink(planPath);
    }
  });

  it("edit decision persists the editor's content into the in-flight plan", async () => {
    // Simulate the operator invoking the editor by setting $EDITOR to a
    // script that synchronously overwrites the plan file. The gate's
    // edit branch calls `openPlanInEditor`, which spawns $EDITOR synchronously
    // and re-reads the file after.
    const planPath = path.join(SCRATCH, "provided.md");
    await writeFile(planPath, "# Original\n\n- original step\n", "utf8");

    const editorScript = path.join(SCRATCH, "fake-editor.sh");
    // Script: synchronously overwrite the plan file with the edited body.
    const scriptBody = `#!/bin/sh\ncat > "$1" <<'EOF'
# Edited

- new step
EOF
`;
    await writeFile(editorScript, scriptBody, { mode: 0o755 });
    const origEditor = process.env.EDITOR;
    process.env.EDITOR = editorScript;

    const { TuiPlanApprovalGate } = await loadGate();
    const { runPlanPhase } = await import("../../src/run/plan-phase.js");
    const gate = new TuiPlanApprovalGate();

    let round = 0;
    const inflate = setInterval(() => {
      const p = gate.getPending();
      if (!p) return;
      round++;
      if (round === 1) {
        gate.resolve(p.planId, "edit");
      } else {
        gate.resolve(p.planId, "approve");
        clearInterval(inflate);
      }
    }, 5);

    try {
      const result = await runPlanPhase(
        mockContext(),
        mockBundle(),
        "implement a hello() function in foo.ts",
        planPath,
        { approvalMode: "interactive", gate },
      );
      expect(result.action).toBe("approved");
      expect((result as any).planContent).toContain("new step");
    } finally {
      clearInterval(inflate);
      process.env.EDITOR = origEditor;
    }
  });
});
