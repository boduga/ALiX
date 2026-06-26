# P10.5b — Outcome Report Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `ExecutiveOutcomeEvaluationReport` as versioned JSON files, add `--save` flag on `evaluate`, and add `outcomes list/show` CLI subcommands.

**Architecture:** PlanStore-like storage: one file per report under `.alix/executive/outcomes/`. OutcomeReportStore with atomic write + contentHash integrity. No index — listing reads and verifies every file. The pure evaluator is untouched.

**Tech Stack:** TypeScript, Vitest, existing atomic-write pattern from PlanStore.

## Global Constraints

- `evaluatePlanOutcome()` is NOT modified — the pure function stays pure
- No new evidence types
- No ExecutionEngine hooks
- No automatic evaluation
- `--save` is opt-in — existing `evaluate` without `--save` works identically
- Save before render: if save fails, error propagates before any output
- Save persists all evaluation statuses: `completed`, `insufficient_data`, `plan_not_executed`, `plan_not_found`
- Wrapper schema version: `"p10.5b.0"`
- Filename pattern: `outcome-<planId>-<sanitizedTimestamp>.json` (timestamp sanitized: remove `-` `:` `.`)
- Missing file on load → null. Hash mismatch / parse failure → throw.
- `list()` sorts by `generatedAt` descending; skips corrupt files with stderr warning
- `list --json` includes only valid reports; corruption warnings to stderr
- OutcomeStore follows the same atomic-write pattern as PlanStore (`.tmp` → `fsync` → `renameSync`)
- Purity sentinel: `outcome-store.ts` added to `EXECUTIVE_FILES` + scoped write-exception group

---

### Task 0: Create feature branch

- [ ] **Step 1: Create and push the feature branch**

```bash
git checkout -b feature/p10-5b-outcome-report-persistence
git push -u origin feature/p10-5b-outcome-report-persistence
```

---

### Task 1: OutcomeReportStore + sentinel updates + unit tests

**Files:**
- Create: `src/executive/outcome-store.ts`
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add to EXECUTIVE_FILES + write-exception group)
- Create: `tests/executive/outcome-store.vitest.ts`

**Interfaces:**
- Produces: `OutcomeReportStore(save, load, list)`, `PersistedOutcomeReport`, `OutcomeReportMeta`

- [ ] **Step 1: Check existing PlanStore atomic-write pattern**

Run: `cat src/executive/plan-store.ts | head -95`

Verify the atomic write pattern (openSync → writeFileSync → fsyncSync → closeSync → renameSync). The same pattern is used for OutcomeReportStore.

- [ ] **Step 2: Write the failing store tests**

Create `tests/executive/outcome-store.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../src/executive/outcome-evaluator.js";

function makeReport(overrides: Partial<ExecutiveOutcomeEvaluationReport> = {}): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: "2026-06-25T12:00:00.000Z",
    planId: "plan-abc",
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow"],
    objectives: [],
    overallDelta: 40,
    warnings: [],
    ...overrides,
  };
}

describe("OutcomeReportStore", () => {
  let tmpDir: string;
  let store: OutcomeReportStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "outcome-test-"));
    store = new OutcomeReportStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves a report and returns the reportId", () => {
    const report = makeReport();
    const id = store.save(report);
    expect(id).toMatch(/^outcome-plan-abc-\d+T\d+Z$/);
  });

  it("loads a saved report by reportId", () => {
    const report = makeReport();
    const id = store.save(report);
    const loaded = store.load(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.planId).toBe("plan-abc");
    expect(loaded!.overallDelta).toBe(40);
  });

  it("returns null when loading a non-existent report", () => {
    const result = store.load("nonexistent");
    expect(result).toBeNull();
  });

  it("throws on hash mismatch (tampered file)", () => {
    const report = makeReport();
    const id = store.save(report);
    const path = join(tmpDir, `${id}.json`);
    const raw = readFileSync(path, "utf-8");
    const tampered = raw.replace("plan-abc", "plan-TAMPERED");
    writeFileSync(path, tampered, "utf-8");
    expect(() => store.load(id)).toThrow(/contentHash|integrity|mismatch/i);
  });

  it("throws on invalid JSON (corrupt file)", () => {
    const report = makeReport();
    const id = store.save(report);
    const path = join(tmpDir, `${id}.json`);
    writeFileSync(path, "not-json{", "utf-8");
    expect(() => store.load(id)).toThrow();
  });

  it("lists saved reports sorted by generatedAt descending", () => {
    const r1 = makeReport({ generatedAt: "2026-06-25T10:00:00.000Z", planId: "plan-first" });
    const r2 = makeReport({ generatedAt: "2026-06-26T10:00:00.000Z", planId: "plan-second" });
    store.save(r1);
    store.save(r2);
    const list = store.list();
    expect(list.length).toBe(2);
    expect(list[0].planId).toBe("plan-second");
    expect(list[1].planId).toBe("plan-first");
  });

  it("list returns empty array when directory is missing", () => {
    const emptyStore = new OutcomeReportStore(join(tmpDir, "nonexistent"));
    const list = emptyStore.list();
    expect(list).toEqual([]);
  });

  it("list skips corrupt files and warns on stderr", () => {
    const report = makeReport();
    store.save(report);
    writeFileSync(join(tmpDir, "outcome-corrupt-20260625T120000000Z.json"), "bad{json", "utf-8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = store.list();
    expect(list.length).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("save creates directory if missing", () => {
    const deepDir = join(tmpDir, "a", "b", "c");
    const deepStore = new OutcomeReportStore(deepDir);
    const report = makeReport();
    const id = deepStore.save(report);
    const loaded = deepStore.load(id);
    expect(loaded!.planId).toBe("plan-abc");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/executive/outcome-store.vitest.ts
```

Expected: All tests fail with "Cannot find module" for OutcomeReportStore.

- [ ] **Step 4: Implement OutcomeReportStore**

Create `src/executive/outcome-store.ts`:

```ts
/**
 * P10.5b — Outcome Report Store.
 *
 * Append-once immutable store for evaluation outcome reports. Uses the
 * same atomic-write pattern as PlanStore: .tmp → fsync → renameSync.
 * ContentHash is verified on every load.
 *
 * The store is disposable — deleting the outcomes directory loses
 * nothing from the execution layer.
 *
 * @module
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ExecutiveOutcomeEvaluationReport } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PersistedOutcomeReport {
  schemaVersion: "p10.5b.0";
  id: string;
  contentHash: string;
  report: ExecutiveOutcomeEvaluationReport;
}

export interface OutcomeReportMeta {
  reportId: string;
  planId: string;
  evaluationStatus: string;
  overallDelta: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}

function buildReportId(planId: string, generatedAt: string): string {
  return `outcome-${planId}-${sanitizeTimestamp(generatedAt)}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class OutcomeReportStore {
  constructor(private readonly dir: string) {}

  save(report: ExecutiveOutcomeEvaluationReport): string {
    const id = buildReportId(report.planId, report.generatedAt);
    const contentHash = sha256(JSON.stringify(report));

    const wrapper: PersistedOutcomeReport = {
      schemaVersion: "p10.5b.0",
      id,
      contentHash,
      report,
    };

    const targetPath = join(this.dir, `${id}.json`);
    const tmpPath = targetPath + ".tmp";

    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const fd = openSync(tmpPath, "w");
    try {
      writeFileSync(fd, JSON.stringify(wrapper, null, 2), "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);

    return id;
  }

  load(reportId: string): ExecutiveOutcomeEvaluationReport | null {
    const targetPath = join(this.dir, `${reportId}.json`);
    if (!existsSync(targetPath)) return null;

    const raw = readFileSync(targetPath, "utf-8");
    let parsed: PersistedOutcomeReport;
    try {
      parsed = JSON.parse(raw) as PersistedOutcomeReport;
    } catch {
      throw new Error(`Outcome report ${reportId}: invalid JSON`);
    }

    if (parsed.schemaVersion !== "p10.5b.0") {
      throw new Error(`Outcome report ${reportId}: unknown schemaVersion "${parsed.schemaVersion}"`);
    }

    const expectedHash = sha256(JSON.stringify(parsed.report));
    if (parsed.contentHash !== expectedHash) {
      throw new Error(
        `Outcome report ${reportId}: contentHash mismatch — expected ${expectedHash}, got ${parsed.contentHash}`,
      );
    }

    return parsed.report;
  }

  list(): OutcomeReportMeta[] {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir).filter(f => f.startsWith("outcome-") && f.endsWith(".json"));
    const results: OutcomeReportMeta[] = [];

    for (const file of files) {
      const reportId = file.replace(/\.json$/, "");
      try {
        const report = this.load(reportId);
        if (!report) continue;
        results.push({
          reportId,
          planId: report.planId,
          evaluationStatus: report.evaluationStatus,
          overallDelta: report.overallDelta,
          generatedAt: report.generatedAt,
        });
      } catch (e: any) {
        console.warn(`Skipping corrupt outcome report: ${file} — ${e.message}`);
      }
    }

    results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return results;
  }
}
```

- [ ] **Step 5: Update sentinel to allowlist outcome-store.ts**

Modify `tests/executive/executive-sentinels.vitest.ts`:

Add `"src/executive/outcome-store.ts"` to the `EXECUTIVE_FILES` array (after the P10.4c entry, before the P10.5a comment):

```ts
  // P10.4c files
  "src/executive/executive-apply-reconciler.ts",
  // P10.5b files
  "src/executive/outcome-store.ts",
  // P10.5a files
  "src/executive/outcome-evaluator.ts",
```

Modify the scoped write-exception to include `outcome-store.ts`:

```ts
            // Scoped exception: plan-store.ts, execution-state-store.ts, and
            // outcome-store.ts are approved write paths
            if ((file === "src/executive/plan-store.ts" ||
                 file === "src/executive/execution-state-store.ts" ||
                 file === "src/executive/outcome-store.ts") &&
                (forbidden === "writeFileSync" || forbidden === "mkdirSync" ||
                 forbidden === "renameSync" || forbidden === "openSync" ||
                 forbidden === "fsyncSync" || forbidden === "closeSync")) {
              continue;
            }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/executive/outcome-store.vitest.ts
npx vitest run tests/executive/executive-sentinels.vitest.ts
```

Expected: All tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/executive/outcome-store.ts tests/executive/outcome-store.vitest.ts tests/executive/executive-sentinels.vitest.ts
git commit -m "feat(p10-5b): add OutcomeReportStore with save/load/list + sentinel allowlist"
```

---

### Task 2: --save flag on evaluate CLI

**Files:**
- Modify: `src/cli/commands/executive-evaluate-handler.ts`
- Modify: `tests/cli/commands/executive-evaluate-cli.vitest.ts`

**Interfaces:**
- Consumes: `OutcomeReportStore.save(report)` from Task 1
- Relevant `ExecutiveOutcomeEvaluationReport` path: `outcome-evaluator.ts` (unchanged)

- [ ] **Step 1: Write failing --save integration tests**

Append to `tests/cli/commands/executive-evaluate-cli.vitest.ts` (before the closing `});` of the outer describe, after the last existing test):

```ts
  it("saves report when --save flag is passed", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    const outcomesDir = join(execDir, "outcomes");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("save-me"));
    writeState(plansDir, makeCompletedState());
    writeTrends(execDir, [{ id: "s1", generatedAt: "2026-06-01T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } }]);

    const c = captureConsole();
    await handleExecutiveCommand(["evaluate", "save-me", "--save"]);
    const output = c.out().join("\n");
    expect(output).toContain("Report saved:");
    expect(output).toContain("outcome-save-me-");
    const files = readdirSync(outcomesDir).filter(f => f.startsWith("outcome-save-me-"));
    expect(files.length).toBe(1);
    c.restore();
  });

  it("--save with --json returns wrapper object with savedReportId", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("save-json"));
    writeState(plansDir, makeCompletedState());
    writeTrends(execDir, [{ id: "s1", generatedAt: "2026-06-01T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } }]);

    const c = captureConsole();
    await handleExecutiveCommand(["evaluate", "save-json", "--json", "--save"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.report).toBeDefined();
    expect(parsed.report.evaluationStatus).toBe("completed");
    expect(parsed.report.planId).toBe("save-json");
    expect(parsed.savedReportId).toMatch(/^outcome-save-json-/);
    c.restore();
  });

  it("--save persists plan_not_executed reports", async () => {
    const execDir = join(tempRoot, ".alix", "executive");
    const plansDir = join(execDir, "plans");
    const outcomesDir = join(execDir, "outcomes");
    mkdirSync(plansDir, { recursive: true });

    writePlan(plansDir, makeCompletedPlan("blocked-plan"));
    writeState(plansDir, { planId: "blocked-plan", status: "blocked", approval: { status: "pending" }, stepStates: {}, planTransitions: [], timestamps: { createdAt: "2026-06-10T00:00:00.000Z" } });
    writeTrends(execDir, [{ id: "s1", generatedAt: "2026-06-01T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 50 } }]);

    const c = captureConsole();
    await handleExecutiveCommand(["evaluate", "blocked-plan", "--save", "--json"]);
    const output = c.out().join("\n");
    const jsonStart = output.indexOf("{");
    const parsed = JSON.parse(output.slice(jsonStart));
    expect(parsed.evaluationStatus).toBe("plan_not_executed");
    expect(output).toContain("Report saved:");
    const files = readdirSync(outcomesDir).filter(f => f.startsWith("outcome-blocked-plan-"));
    expect(files.length).toBe(1);
    c.restore();
  });
```

Also add `readdirSync` to the existing `from "node:fs"` import if it's not already there.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/cli/commands/executive-evaluate-cli.vitest.ts
```

Expected: New tests fail — the handler doesn't handle `--save` yet.

- [ ] **Step 3: Modify evaluate handler for --save**

Add to `executive-evaluate-handler.ts`:

1. Import `OutcomeReportStore` at the top:
```ts
import { OutcomeReportStore } from "../../executive/outcome-store.js";
```

2. Add the OUTCOMES_DIR constant after EXECUTIVE_DIR:
```ts
const OUTCOMES_DIR = join(".alix", "executive", "outcomes");
```

3. After the `evaluatePlanOutcome(...)` call and before the render block, add the save logic:
```ts
  // ── Save (before render) ──────────────────────────────────────────
  const saveMode = args.includes("--save");
  let savedId: string | undefined;
  if (saveMode) {
    const outcomeStore = new OutcomeReportStore(join(cwd, OUTCOMES_DIR));
    savedId = outcomeStore.save(report);
  }

  // ── Render ────────────────────────────────────────────────────────
  if (jsonMode) {
    // Wrap report + savedReportId so --json --save remains valid JSON
    const output: Record<string, unknown> = { report };
    if (savedId) output.savedReportId = savedId;
    console.log(JSON.stringify(output, null, 2));
  } else {
    renderEvaluationTable(report);
    if (savedId) console.log(`Report saved: ${savedId}`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-evaluate-cli.vitest.ts
```

Expected: All tests pass (including new --save tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/executive-evaluate-handler.ts tests/cli/commands/executive-evaluate-cli.vitest.ts
git commit -m "feat(p10-5b): add --save flag to evaluate CLI"
```

---

### Task 3: outcomes list/show CLI subcommands

**Files:**
- Create: `src/cli/commands/executive-outcomes-handler.ts`
- Modify: `src/cli/commands/executive.ts`
- Create: `tests/cli/commands/executive-outcomes-cli.vitest.ts`

**Interfaces:**
- Consumes: `OutcomeReportStore.list()`, `OutcomeReportStore.load(reportId)` from Task 1
- Uses same `renderEvaluationTable` output format but as a standalone renderer in the handler

- [ ] **Step 1: Write failing outcomes CLI tests**

Create `tests/cli/commands/executive-outcomes-cli.vitest.ts`:

```ts
/**
 * P10.5b — Executive outcomes CLI integration tests.
 * Tests `alix executive outcomes list` and `alix executive outcomes show`.
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleExecutiveCommand } from "../../../src/cli/commands/executive.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); errSpy.mockRestore(); } };
}

function mockExit() {
  const spy = vi.spyOn(process, "exit").mockImplementation((_code?: any) => {
    throw new Error(`process.exit(${_code})`);
  });
  return { spy, restore: () => spy.mockRestore() };
}

function makeReport(planId: string, generatedAt: string, delta: number, status: string) {
  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId,
    planStatus: "completed" as const,
    evaluationStatus: status as any,
    evaluatedSubsystems: ["workflow"],
    objectives: [],
    overallDelta: delta,
    warnings: [],
  };
}

describe("executive outcomes CLI", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "outcomes-cli-"));
    vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("outcomes list shows saved reports", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    store.save(makeReport("plan-a", "2026-06-26T10:00:00.000Z", 40, "completed") as any);
    store.save(makeReport("plan-b", "2026-06-25T10:00:00.000Z", -10, "degraded") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "list"]);
    const output = c.out().join("\n");
    expect(output).toContain("plan-a");
    expect(output).toContain("plan-b");
    expect(output).toContain("+40");
    expect(output).toContain("-10");
    c.restore();
  });

  it("outcomes list empty", async () => {
    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "list"]);
    expect(c.out().join("")).toContain("No outcome reports");
    c.restore();
  });

  it("outcomes list --json returns structured data", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    store.save(makeReport("plan-a", "2026-06-26T10:00:00.000Z", 40, "completed") as any);
    store.save(makeReport("plan-b", "2026-06-25T10:00:00.000Z", 0, "plan_not_executed") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "list", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].planId).toBe("plan-a");
    expect(parsed[1].evaluationStatus).toBe("plan_not_executed");
    c.restore();
  });

  it("outcomes show loads and renders a report", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    const id = store.save(makeReport("show-me", "2026-06-26T10:00:00.000Z", 50, "completed") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "show", id]);
    const output = c.out().join("\n");
    expect(output).toContain("show-me");
    expect(output).toContain("+50");
    c.restore();
  });

  it("outcomes show --json returns full report", async () => {
    const store = new OutcomeReportStore(join(tmpRoot, ".alix", "executive", "outcomes"));
    const id = store.save(makeReport("json-show", "2026-06-26T10:00:00.000Z", 30, "completed") as any);

    const c = captureConsole();
    await handleExecutiveCommand(["outcomes", "show", id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.planId).toBe("json-show");
    expect(parsed.overallDelta).toBe(30);
    c.restore();
  });

  it("outcomes show missing report exits with error", async () => {
    const exit = mockExit();
    const c = captureConsole();
    await expect(handleExecutiveCommand(["outcomes", "show", "nonexistent"])).rejects.toThrow("process.exit");
    expect(c.err().join("")).toContain("not found");
    exit.restore();
    c.restore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/cli/commands/executive-outcomes-cli.vitest.ts
```

Expected: Tests fail — no handler yet.

- [ ] **Step 3: Create outcomes handler**

Create `src/cli/commands/executive-outcomes-handler.ts`:

```ts
/**
 * P10.5b — Executive outcomes CLI handler.
 * Handles `alix executive outcomes list [--json]` and
 * `alix executive outcomes show <reportId> [--json]`.
 * @module
 */

import { join } from "node:path";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";

const OUTCOMES_DIR = join(".alix", "executive", "outcomes");

export async function handleOutcomesCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const store = new OutcomeReportStore(join(process.cwd(), OUTCOMES_DIR));

  switch (subcommand) {
    case "list":
      return handleList(store, rest);
    case "show":
      return handleShow(store, rest);
    default:
      console.error(`Unknown outcomes subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: list, show");
      process.exit(1);
  }
}

function handleList(store: OutcomeReportStore, args: string[]): void {
  const jsonMode = args.includes("--json");
  const reports = store.list();

  if (jsonMode) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  if (reports.length === 0) {
    console.log("No outcome reports found.");
    return;
  }

  const header = "Report ID".padEnd(48) + "| Plan ID".padEnd(14) + "| Eval Status".padEnd(20) + "| Δ".padEnd(6) + "| Generated At";
  console.log(header);
  console.log("─".repeat(header.length));
  for (const r of reports) {
    const deltaStr = r.overallDelta >= 0 ? `+${r.overallDelta}` : `${r.overallDelta}`;
    console.log(`${r.reportId.padEnd(48)}| ${r.planId.padEnd(12)}| ${r.evaluationStatus.padEnd(18)}| ${deltaStr.padEnd(4)}| ${r.generatedAt}`);
  }
}

function handleShow(store: OutcomeReportStore, args: string[]): void {
  const jsonMode = args.includes("--json");
  const reportId = args.find(a => !a.startsWith("--"));

  if (!reportId) {
    console.error("Usage: alix executive outcomes show <reportId> [--json]");
    process.exit(1);
  }

  const report = store.load(reportId);
  if (!report) {
    console.error(`Report not found: ${reportId}`);
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderOutcomeReport(report);
  }
}

function renderOutcomeReport(report: ExecutiveOutcomeEvaluationReport): void {
  console.log(`Plan: ${report.planId}`);
  console.log(`Status: ${report.planStatus}`);
  console.log(`Evaluation: ${report.evaluationStatus}`);
  console.log(`Baseline: ${report.baselineGeneratedAt ?? "—"}`);
  console.log(`Current: ${report.currentGeneratedAt ?? "—"}`);
  console.log("");

  if (report.evaluationStatus !== "completed") {
    for (const w of report.warnings) console.log(`  Warning: ${w}`);
    return;
  }

  const header = "Objective".padEnd(24) + "| Type".padEnd(16) + "| Subsystem".padEnd(14) + "| Before".padEnd(8) + "| After".padEnd(7) + "| Δ".padEnd(5) + "| Outcome";
  console.log(header);
  console.log("─".repeat(header.length));
  for (const obj of report.objectives) {
    for (let i = 0; i < obj.subsystemDeltas.length; i++) {
      const d = obj.subsystemDeltas[i];
      const label = i === 0 ? obj.objectiveId.slice(0, 23) : "";
      const typeLabel = i === 0 ? obj.objectiveType.slice(0, 14) : "";
      const deltaStr = d.delta >= 0 ? `+${d.delta}` : `${d.delta}`;
      console.log(`${label.padEnd(24)}| ${typeLabel.padEnd(14)}| ${d.subsystem.padEnd(12)}| ${String(d.baselineScore).padEnd(6)}| ${String(d.currentScore).padEnd(5)}| ${deltaStr.padEnd(3)}| ${obj.outcome}`);
    }
  }
  console.log("");
  console.log(`Overall Δ: ${report.overallDelta >= 0 ? "+" : ""}${report.overallDelta} (${report.objectives.length} objectives, ${report.evaluatedSubsystems.length} subsystems evaluated)`);
}
```

- [ ] **Step 4: Wire outcomes into executive.ts dispatcher**

Modify `executive.ts`:

Add import:
```ts
import { handleOutcomesCommand } from "./executive-outcomes-handler.js";
```

Add case before default:
```ts
    case "outcomes":
      return handleOutcomesCommand(rest);
```

Update the "Available" line:
```ts
console.error("Available: dashboard, plan, evaluate, outcomes");
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-outcomes-cli.vitest.ts
```

Expected: All tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-outcomes-handler.ts src/cli/commands/executive.ts tests/cli/commands/executive-outcomes-cli.vitest.ts
git commit -m "feat(p10-5b): add outcomes list + show CLI subcommands"
```

---

### Task 4: Final verification + PR

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests passing.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run GitNexus detect-changes**

```bash
npx gitnexus detect_changes --repo ALiX
```

Expected: Low risk, no affected processes.

- [ ] **Step 4: Push and create PR**

```bash
git push
gh pr create --base main --head feature/p10-5b-outcome-report-persistence --title "P10.5b Outcome Report Persistence" --body "..."
```
