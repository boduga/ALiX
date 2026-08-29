/**
 * M-Series — architectural sentinels (M0–M9, follow-up #3).
 *
 * The M-series platform roadmaps (`docs/roadmap/m-series-platform.md`) declare
 * capability milestones M0–M9. This sentinel pins DURABLE ANCHORS for each
 * milestone's canonical entry points so that:
 *
 *   1. If a milestone's key module is renamed or moved, the sentinel fails —
 *      forcing the roadmap/DOX path to be updated in lockstep (this is exactly
 *      what kept M1/M2/M8 path drift alive in `m-series-platform.md`).
 *   2. If a supposed-new milestone (or a claimed-complete one) loses its
 *      backing code, the sentinel fails before the drift is committed.
 *
 * Assertion style: static imports of the canonical entry points (compile-time
 * guard on existence + exported symbol via `satisfies`), plus a filesystem
 * existence check. M9 Distributed is EXPECTED ABSENT (verified in
 * `docs/architecture/checkpoints/2026-08-29-milestone-verification.md` §2) —
 * we assert the absence explicitly so a partial federated platform does not
 * silently land without updating the roadmap.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// M0 — Foundation
// ---------------------------------------------------------------------------
import type { TaskGraph } from "../src/kernel/task-graph.js";
import { GraphExecutor } from "../src/kernel/graph-executor.js";

// ---------------------------------------------------------------------------
// M1 — Agent Runtime
// ---------------------------------------------------------------------------
import { initAgent, type AgentContext } from "../src/agent/agent.js";
import { CoordinationScheduler } from "../src/kernel/coordination-scheduler.js";

// ---------------------------------------------------------------------------
// M2 — Memory Platform
// ---------------------------------------------------------------------------
import { MemoryStore } from "../src/utils/memory/store.js";

// ---------------------------------------------------------------------------
// M3 — Tool Platform
// ---------------------------------------------------------------------------
import { ToolRegistry } from "../src/tools/tool-registry.js";

// ---------------------------------------------------------------------------
// M4 — Planning
// ---------------------------------------------------------------------------
import { GraphPlanner } from "../src/kernel/graph-planner.js";

// ---------------------------------------------------------------------------
// M5 — Orchestration
// ---------------------------------------------------------------------------
import { DaemonManager } from "../src/daemon/daemon-manager.js";

// ---------------------------------------------------------------------------
// M6 — Intelligence
// ---------------------------------------------------------------------------
import { CircuitBreaker } from "../src/providers/circuit-breaker.js";

// ---------------------------------------------------------------------------
// M7 — Governance
// ---------------------------------------------------------------------------
import { PolicyGate } from "../src/policy/policy-gate.js";
import { AuditStore } from "../src/audit/audit-store.js";
import { ApprovalStore } from "../src/approvals/approval-store.js";

// ---------------------------------------------------------------------------
// M8 — Observability
// ---------------------------------------------------------------------------
import { MetricRegistry } from "../src/observability/metric-registry.js";

const ROOT = join(process.cwd());

describe("M-series entry-point anchors", () => {
  it("M0 Foundation — TaskGraph type and GraphExecutor export resolve", () => {
    const _g: TaskGraph | null = null;
    expect(typeof GraphExecutor).toBe("function");
    expect(_g).toBeNull();
  });

  it("M1 Agent Runtime — initAgent, AgentContext and CoordinationScheduler resolve", () => {
    expect(typeof initAgent).toBe("function");
    expect(typeof CoordinationScheduler).toBe("function");
    const _ctx: AgentContext | null = null;
    expect(_ctx).toBeNull();
  });

  it("M2 Memory Platform — MemoryStore resolves", () => {
    expect(typeof MemoryStore).toBe("function");
  });

  it("M3 Tool Platform — ToolRegistry resolves", () => {
    expect(typeof ToolRegistry).toBe("function");
  });

  it("M4 Planning — GraphPlanner resolves", () => {
    expect(typeof GraphPlanner).toBe("function");
  });

  it("M5 Orchestration — DaemonManager resolves", () => {
    expect(typeof DaemonManager).toBe("function");
  });

  it("M6 Intelligence — CircuitBreaker resolves", () => {
    expect(typeof CircuitBreaker).toBe("function");
  });

  it("M7 Governance — PolicyGate, AuditStore, ApprovalStore resolve", () => {
    expect(typeof PolicyGate).toBe("function");
    expect(typeof AuditStore).toBe("function");
    expect(typeof ApprovalStore).toBe("function");
  });

  it("M8 Observability — MetricRegistry resolves", () => {
    expect(typeof MetricRegistry).toBe("function");
  });
});

describe("M-series canonical module paths exist on disk", () => {
  const anchors: Array<{ milestone: string; path: string }> = [
    { milestone: "M0", path: "src/kernel/task-graph.ts" },
    { milestone: "M1", path: "src/agent/agent.ts" },
    { milestone: "M2", path: "src/utils/memory/store.ts" },
    { milestone: "M3", path: "src/tools/tool-registry.ts" },
    { milestone: "M4", path: "src/kernel/graph-planner.ts" },
    { milestone: "M5", path: "src/daemon/daemon-manager.ts" },
    { milestone: "M6", path: "src/providers/circuit-breaker.ts" },
    { milestone: "M7", path: "src/policy/policy-gate.ts" },
    { milestone: "M8", path: "src/observability/metric-registry.ts" },
  ];

  it.each(anchors)("$milestone — $path exists", ({ path }) => {
    expect(existsSync(join(ROOT, path)), `${path} must exist`).toBe(true);
  });
});

describe("M9 Distributed — expected ABSENT", () => {
  it("no distributed/clustering/federation platform module exists", () => {
    const candidates = [
      "src/kernel/federation.ts",
      "src/cluster.ts",
      "src/federation.ts",
      "src/remote-worker.ts",
      "src/runtime/remote-worker.ts",
      "src/daemon/federation.ts",
    ];
    const present = candidates.filter((p) => existsSync(join(ROOT, p)));
    expect(present, `M9 is an unimplemented milestone; these must not exist: ${present.join(", ")}`).toEqual([]);
  });
});
