# P10.7b — Recommendation Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--save` to `alix executive recommend` — persist each `recommend` run as a `RecommendationReport` via a new append-only `RecommendationReportStore` (mirrors `OutcomeReportStore`). Also rename P10.7a's `RecommendationDraft.confidence` → `signalConfidence` to self-document the signal/outcome split before P10.8 lands.

**Architecture:** Rename first (Task 1) so `ExecutiveRecommendation` inherits the renamed `signalConfidence`. Then a new atomic-write store (Task 2) mirroring `OutcomeReportStore` (contentHash, schemaVersion, integrity error, deterministic id from `generatedAt`). Then the CLI `--save` branch (Task 3) builds a `NewRecommendationReport` from the existing `RecommendationResult` + windowed outcome report ids and calls `store.save()`. Sentinel (Task 4) registers the store with one scoped fs-exception (mirroring `outcome-store.ts`). Read-only invariants preserved: `computeRecommendations` stays pure; the handler gains only the `store.save()` call.

**Tech Stack:** TypeScript, Node.js `fs` (store only), `crypto` (SHA-256), vitest, existing `OutcomeReportStore` pattern.

**Spec:** `docs/superpowers/specs/2026-06-26-p10-7b-recommendation-persistence-design.md`

## Global Constraints

| Constraint | Value |
|---|---|
| No proposals created | P10.7b must not invoke `ProposalStore` or `ApprovalGate` |
| No governance state updates | P10.7b must not mutate adaptation/governance stores |
| No outcome evaluation | P10.7b must not call `computeOutcomeEvaluation` or write to `OutcomeReportStore` |
| Reserved fields never populated | `proposalId`, `governanceStatus`, `disposition`, `outcomeConfidence`, `outcomeSummary` stay `undefined` in P10.7b |
| Domain separation | New store lives at `.alix/executive/recommendations/`; never touches `.alix/recommendations/` (adaptation domain) |
| Function purity | `computeRecommendations` stays pure (only the rename touches it); the store is the only writer |
| Store pattern | Mirrors `OutcomeReportStore`: atomic `.tmp` → `fsync` → `renameSync`; `contentHash` (SHA-256) verified on load; `list()` skips corrupt with `console.warn` |
| Schema version | Wrapper `schemaVersion: "p10.7b.0"` |
| Rename | `RecommendationDraft.confidence` → `signalConfidence` everywhere (type + classifier + tests + CLI renderer + CLI test); semantics unchanged |
| Sentinel | One new scoped fs-exception for `recommendation-report-store.ts` (the 6 fs functions), mirroring the `outcome-store.ts` block; engine + handler get no exception |
| CLI | `--save` is additive; without it, behavior is byte-identical to P10.7a; `--save` prints id to stderr (keeps JSON stdout clean) |

---

---

### Task 0: Branch + docs carry-forward

- [ ] Create the feature branch from `main` (P10.7a merged at `4b2665b4`)

```bash
git checkout main
git pull --ff-only
git checkout -b feature/p10-7b-recommendation-persistence
```

- [ ] Cherry-pick the P10.7b spec onto the branch (the spec was committed on `main` at `af09b861`; it is already on `main` because no implementation commits exist yet — nothing to cherry-pick). The plan file does NOT exist yet — it is written in this Task 0 step.

- [ ] Write and commit the plan document

The plan is being written by you (the implementer) in this step. After `git checkout -b feature/p10-7b-recommendation-persistence`, write `docs/superpowers/plans/2026-06-26-p10-7b-recommendation-persistence.md` (copy this file verbatim), then:

```bash
git add docs/superpowers/plans/2026-06-26-p10-7b-recommendation-persistence.md
git commit -m "docs(p10-7b): add implementation plan"
```

---

### Task 1: Rename `confidence` → `signalConfidence` in P10.7a files

**Files:**
- Modify: `src/executive/recommendation-engine.ts` (interface field + 4 classifier branch assignments)
- Modify: `src/cli/commands/executive-recommend-handler.ts` (renderer `r.confidence`)
- Modify: `tests/executive/recommendation-engine.vitest.ts` (assertion field name)
- Modify: `tests/cli/commands/executive-recommend-cli.vitest.ts` (`toHaveProperty("confidence")`)

**Interfaces:**
- Consumes: nothing new (mechanical rename)
- Produces: `RecommendationDraft.signalConfidence` (renamed from `confidence`); `computeRecommendations` returns recommendations with `signalConfidence`; CLI `--json` output emits `signalConfidence`

This task changes no semantics — the numeric values are identical, only the field name changes. The discipline is: rename source + tests together, verify the suite is green (no behavior change).

- [ ] **Step 1: Rename in `src/executive/recommendation-engine.ts`**

In the `RecommendationDraft` interface, change `confidence: number;` to `signalConfidence: number;`.

In `classifySubsystem`, change each of the four `confidence: round2(...)` field assignments to `signalConfidence: round2(...)` (there is one in the `low_confidence` branch and three in `degrading_trend` / `persistent_instability` / `improving_trend` branches).

Concretely, the four assignment sites are:

```ts
// low_confidence branch
confidence: round2(Math.min(CAP_LOW, occurrenceCount * 0.1)),

// degrading_trend branch
confidence: round2(Math.min(
  CAP_HIGH,
  Math.abs(averageDelta) * 0.15 + degradationRate * 0.4 + Math.min(occurrenceCount / 10, 0.2),
)),

// persistent_instability branch
confidence: round2(Math.min(
  CAP_INSTABILITY,
  mixedRate * 0.5 + Math.min(occurrenceCount / 10, 0.3),
)),

// improving_trend branch
confidence: round2(Math.min(
  CAP_HIGH,
  averageDelta * 0.1 + successRate * 0.4 + Math.min(occurrenceCount / 10, 0.2),
)),
```

Change each `confidence:` to `signalConfidence:`.

- [ ] **Step 2: Rename in `src/cli/commands/executive-recommend-handler.ts`**

In `renderTable`, change the row render line `r.confidence.toFixed(2).padEnd(6)` to `r.signalConfidence.toFixed(2).padEnd(6)`. There is exactly one occurrence (the table row builder).

- [ ] **Step 3: Rename in `tests/executive/recommendation-engine.vitest.ts`**

In every test, change the field assertion `confidence: 0.88` (etc.) to `signalConfidence: 0.88` (etc.). There are six `confidence:` assertions across the test file (one each in the four `signal detection` tests + the precedence test + the loadWarnings test, etc. — count them with `grep -c 'confidence:' tests/executive/recommendation-engine.vitest.ts` and verify the count matches the number of `signalConfidence:` replacements).

- [ ] **Step 4: Rename in `tests/cli/commands/executive-recommend-cli.vitest.ts`**

Change the JSON-shape assertion:

```ts
expect(parsed.subsystemRecommendations[0]).toHaveProperty("confidence");
```

to:

```ts
expect(parsed.subsystemRecommendations[0]).toHaveProperty("signalConfidence");
```

- [ ] **Step 5: Run the renamed engine tests**

Run: `npx vitest run tests/executive/recommendation-engine.vitest.ts`
Expected: PASS — all 12 tests green (the rename is a no-op semantically; only field name changed).

- [ ] **Step 6: Run the renamed CLI tests**

Run: `npx vitest run tests/cli/commands/executive-recommend-cli.vitest.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 7: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; full suite (2022 tests) green.

- [ ] **Step 8: Commit**

```bash
git add src/executive/recommendation-engine.ts src/cli/commands/executive-recommend-handler.ts tests/executive/recommendation-engine.vitest.ts tests/cli/commands/executive-recommend-cli.vitest.ts
git commit -m "refactor(p10-7b): rename RecommendationDraft.confidence → signalConfidence"
```

---

### Task 2: `RecommendationReportStore` + ID helper + unit tests

**Files:**
- Create: `src/executive/recommendation-report-id.ts` (helper: `buildRecommendationReportId`)
- Create: `src/executive/recommendation-report-store.ts` (types + store + integrity error)
- Create: `tests/executive/recommendation-report-store.vitest.ts` (unit tests)

**Interfaces:**
- Consumes: nothing new (no external dependencies — `RecommendationDraft` is imported from `./recommendation-engine.js` which now has the renamed `signalConfidence`)
- Produces: `ExecutiveRecommendation`, `NewRecommendationReport`, `RecommendationReport`, `RecommendationReportMeta`, `RecommendationReportIntegrityError`, `buildRecommendationReportId(generatedAt): string`, `RecommendationReportStore` class

- [ ] **Step 1: Write the failing test file**

`tests/executive/recommendation-report-store.vitest.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RecommendationReportStore,
  RecommendationReportIntegrityError,
  buildRecommendationReportId,
} from "../../src/executive/recommendation-report-store.js";
import type { NewRecommendationReport } from "../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../src/executive/recommendation-report-store.js";

function newPayload(over: Partial<NewRecommendationReport> = {}): NewRecommendationReport {
  return {
    generatedAt: "2026-06-26T00:00:00.000Z",
    requestedWindow: 10,
    recommendationStatus: "ok",
    inputReportCount: 3,
    analyzedReportCount: 3,
    skippedReportCount: 0,
    evidenceReportIds: ["outcome-a", "outcome-b", "outcome-c"],
    recommendations: [
      {
        subsystem: "workflow",
        signal: "degrading_trend",
        severity: "high",
        recommendation: "Investigate workflow regressions",
        signalConfidence: 0.88,
        occurrenceCount: 8,
        averageDelta: -3.2,
      },
    ],
    warnings: [],
    loadWarnings: [],
    ...over,
  };
}

let tempRoot: string;
let storeDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-7b-store-"));
  storeDir = join(tempRoot, ".alix", "executive", "recommendations");
  mkdirSync(storeDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("RecommendationReportStore.save", () => {
  it("round-trips all fields and contentHash on load", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    const loaded = store.load(id);

    expect(loaded).not.toBeNull();
    expect(loaded!.schemaVersion).toBe("p10.7b.0");
    expect(loaded!.id).toBe(id);
    expect(loaded!.recommendationStatus).toBe("ok");
    expect(loaded!.evidenceReportIds).toEqual(["outcome-a", "outcome-b", "outcome-c"]);
    expect(loaded!.recommendations[0].subsystem).toBe("workflow");
    expect(loaded!.recommendations[0].signalConfidence).toBe(0.88);
  });

  it("preserves reserved fields as undefined (never populated in P10.7b)", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    const loaded = store.load(id);
    const rec = loaded!.recommendations[0];

    expect(rec.proposalId).toBeUndefined();
    expect(rec.governanceStatus).toBeUndefined();
    expect(rec.disposition).toBeUndefined();
    expect(rec.outcomeConfidence).toBeUndefined();
    expect(rec.outcomeSummary).toBeUndefined();
  });
});

describe("RecommendationReportStore.load — integrity", () => {
  it("rejects tampered contentHash with RecommendationReportIntegrityError", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    // Tamper with the on-disk JSON without going through the store.
    const path = join(storeDir, `${id}.json`);
    const raw = JSON.parse(require("node:fs").readFileSync(path, "utf-8")) as any;
    raw.report.recommendations[0].signalConfidence = 0.99;
    writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");

    expect(() => store.load(id)).toThrow(RecommendationReportIntegrityError);
  });

  it("rejects unknown schemaVersion", () => {
    const store = new RecommendationReportStore(storeDir);
    const id = store.save(newPayload());
    const path = join(storeDir, `${id}.json`);
    const raw = JSON.parse(require("node:fs").readFileSync(path, "utf-8")) as any;
    raw.schemaVersion = "p10.99.0";
    writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");

    expect(() => store.load(id)).toThrow(RecommendationReportIntegrityError);
  });

  it("returns null for a missing report id", () => {
    const store = new RecommendationReportStore(storeDir);
    expect(store.load("recommendation-does-not-exist")).toBeNull();
  });
});

describe("RecommendationReportStore.list", () => {
  it("skips corrupt files and sorts newest-first", () => {
    const store = new RecommendationReportStore(storeDir);
    store.save(newPayload({ generatedAt: "2026-06-01T00:00:00.000Z" }));
    store.save(newPayload({ generatedAt: "2026-06-15T00:00:00.000Z" }));
    store.save(newPayload({ generatedAt: "2026-06-26T00:00:00.000Z" }));

    // Inject a corrupt file the store cannot parse.
    writeFileSync(join(storeDir, "recommendation-corrupt.json"), "not valid json", "utf-8");

    const metas = store.list();
    expect(metas).toHaveLength(3);
    expect(metas[0].generatedAt).toBe("2026-06-26T00:00:00.000Z");
    expect(metas[1].generatedAt).toBe("2026-06-15T00:00:00.000Z");
    expect(metas[2].generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(metas[0].recommendationStatus).toBe("ok");
    expect(metas[0].recommendationCount).toBe(1);
  });

  it("returns an empty list when the directory does not exist", () => {
    const store = new RecommendationReportStore(join(tempRoot, "does-not-exist"));
    expect(store.list()).toEqual([]);
  });
});

describe("buildRecommendationReportId", () => {
  it("is deterministic and filename-safe", () => {
    const a = buildRecommendationReportId("2026-06-26T00:00:00.000Z");
    const b = buildRecommendationReportId("2026-06-26T00:00:00.000Z");
    expect(a).toBe(b);
    expect(a).toMatch(/^recommendation-[0-9TZ:-]+$/);
    expect(a).not.toContain(":");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/executive/recommendation-report-store.vitest.ts`
Expected: FAIL — `recommendation-report-store.ts` module does not exist.

- [ ] **Step 3: Create the ID helper**

`src/executive/recommendation-report-id.ts`:

```ts
/**
 * P10.7b — Recommendation Report ID.
 *
 * Deterministic, filename-safe id derived from `generatedAt`. Mirrors the
 * pattern of buildOutcomeReportId.
 */

/**
 * Replace characters that are unsafe in filenames (Windows-forbidden `:`
 * and Unix-special `.`) with safe substitutes. The result is reversible
 * for our purposes (we never round-trip the id back to an ISO string;
 * the id is just a stable filename key).
 */
function isoToSafe(iso: string): string {
  return iso.replace(/:/g, "-").replace(/\./g, "");
}

export function buildRecommendationReportId(generatedAt: string): string {
  return `recommendation-${isoToSafe(generatedAt)}`;
}
```

- [ ] **Step 4: Create the store**

`src/executive/recommendation-report-store.ts`:

```ts
/**
 * P10.7b — Recommendation Report Store.
 *
 * Append-once immutable store for RecommendationReport artifacts. Mirrors
 * the OutcomeReportStore pattern: .tmp → fsync → renameSync atomic write,
 * contentHash verified on every load, list() filters corrupt files.
 *
 * Storage: .alix/executive/recommendations/recommendation-<id>.json
 *
 * The store is the ONLY writer in P10.7b. It must not invoke the proposal
 * store, the approval gate, or the outcome evaluation. Reserved fields
 * (proposalId, governanceStatus, disposition, outcomeConfidence,
 * outcomeSummary) live in the schema but are never populated in P10.7b —
 * population belongs to P10.7c and P10.8.
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
import type { RecommendationDraft } from "./recommendation-engine.js";
import { buildRecommendationReportId } from "./recommendation-report-id.js";

// Re-export the ID helper so callers have a single import surface.
export { buildRecommendationReportId };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A persisted executive recommendation. Extends the P10.7a draft with
 *  reserved fields for P10.7c (proposal bridge) and P10.8 (effectiveness).
 *  None of the reserved fields are populated in P10.7b. */
export interface ExecutiveRecommendation extends RecommendationDraft {
  // P10.7c bridge — reserved
  proposalId?: string;
  governanceStatus?:
    | "not_proposed"
    | "proposed"
    | "approved"
    | "rejected"
    | "applied";

  // P10.8 forward-compat — reserved
  disposition?:
    | "unreviewed"
    | "ignored"
    | "accepted"
    | "informally_acted_on"
    | "converted_to_proposal";
  outcomeConfidence?: number;
  outcomeSummary?: string;
}

export interface NewRecommendationReport {
  generatedAt: string;
  requestedWindow: number;
  recommendationStatus: "ok" | "insufficient_data";
  inputReportCount: number;
  analyzedReportCount: number;
  skippedReportCount: number;
  evidenceReportIds: string[];
  recommendations: ExecutiveRecommendation[];
  warnings: string[];
  loadWarnings: string[];
}

export interface RecommendationReport extends NewRecommendationReport {
  schemaVersion: "p10.7b.0";
  id: string;
  contentHash: string;
}

export interface RecommendationReportMeta {
  reportId: string;
  generatedAt: string;
  recommendationStatus: string;
  recommendationCount: number;
}

/**
 * Thrown by RecommendationReportStore.load() when the persisted report's
 * integrity cannot be verified: contentHash mismatch, malformed JSON, or
 * unknown schema version. Used by callers to detect and preserve corrupted
 * audit artifacts instead of overwriting them.
 */
export class RecommendationReportIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecommendationReportIntegrityError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class RecommendationReportStore {
  constructor(private readonly dir: string) {}

  save(payload: NewRecommendationReport): string {
    const id = buildRecommendationReportId(payload.generatedAt);
    const contentHash = sha256(JSON.stringify(payload));

    const wrapper: RecommendationReport = {
      schemaVersion: "p10.7b.0",
      id,
      contentHash,
      ...payload,
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

  load(reportId: string): RecommendationReport | null {
    const targetPath = join(this.dir, `${reportId}.json`);
    if (!existsSync(targetPath)) return null;

    const raw = readFileSync(targetPath, "utf-8");
    let parsed: RecommendationReport;
    try {
      parsed = JSON.parse(raw) as RecommendationReport;
    } catch {
      throw new RecommendationReportIntegrityError(
        `Recommendation report ${reportId}: invalid JSON`,
      );
    }

    if (parsed.schemaVersion !== "p10.7b.0") {
      throw new RecommendationReportIntegrityError(
        `Recommendation report ${reportId}: unknown schemaVersion "${parsed.schemaVersion}"`,
      );
    }

    const { schemaVersion, id, contentHash, ...payload } = parsed;
    const expectedHash = sha256(JSON.stringify(payload));
    if (contentHash !== expectedHash) {
      throw new RecommendationReportIntegrityError(
        `Recommendation report ${reportId}: contentHash mismatch — expected ${expectedHash}, got ${contentHash}`,
      );
    }

    return parsed;
  }

  list(): RecommendationReportMeta[] {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir).filter(
      (f) => f.startsWith("recommendation-") && f.endsWith(".json"),
    );
    const results: RecommendationReportMeta[] = [];

    for (const file of files) {
      const reportId = file.replace(/\.json$/, "");
      try {
        const report = this.load(reportId);
        if (!report) continue;
        results.push({
          reportId,
          generatedAt: report.generatedAt,
          recommendationStatus: report.recommendationStatus,
          recommendationCount: report.recommendations.length,
        });
      } catch (e: any) {
        console.warn(`Skipping corrupt recommendation report: ${file} — ${e.message}`);
      }
    }

    results.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return results;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/executive/recommendation-report-store.vitest.ts`
Expected: PASS — all 8 tests green (2 save + 3 load integrity + 2 list + 1 id helper).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/executive/recommendation-report-id.ts src/executive/recommendation-report-store.ts tests/executive/recommendation-report-store.vitest.ts
git commit -m "feat(p10-7b): RecommendationReportStore + types + integrity error"
```

---

### Task 3: CLI `--save` branch + integration tests

**Files:**
- Modify: `src/cli/commands/executive-recommend-handler.ts` (add `--save` parsing + store call)
- Modify: `tests/cli/commands/executive-recommend-cli.vitest.ts` (add `--save` tests)

**Interfaces:**
- Consumes: `RecommendationReportStore` from `../../executive/recommendation-report-store.js`; existing `RecommendationResult` from P10.7a
- Produces: `--save` flag accepted by `handleRecommendCommand`; prints `Recommendation report saved: <id>` to stderr on success; `--save --json` emits the full persisted `RecommendationReport`

**`--save` flow:**
1. Compute the result as today (P10.6 pipeline → `computeRecommendations(trends)`).
2. If `--save` is present, build a `NewRecommendationReport` from the `RecommendationResult` + the windowed outcome report ids collected during load.
3. Call `store.save(payload)` and capture the id.
4. Print `Recommendation report saved: <id>` to **stderr**.
5. If `--json` is present, emit the full persisted `RecommendationReport` (with `id`, `contentHash`, `evidenceReportIds`) as JSON to **stdout** (the id line was already printed to stderr, so it does not pollute the JSON stream).

- [ ] **Step 1: Append 4 failing `--save` tests to the CLI test file**

Append to `tests/cli/commands/executive-recommend-cli.vitest.ts` (inside the existing `describe("executive recommend CLI", () => { ... })` block, after the existing tests):

```ts
  // --save tests (P10.7b)
  it("--save persists the report and prints the id to stderr", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--save"]);

    // id line went to stderr (console.warn capture channel).
    expect(c.err().join("\n")).toMatch(/Recommendation report saved: recommendation-/);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("--json --save emits the full persisted RecommendationReport as JSON", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--save", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.schemaVersion).toBe("p10.7b.0");
    expect(parsed.id).toMatch(/^recommendation-/);
    expect(typeof parsed.contentHash).toBe("string");
    expect(parsed.evidenceReportIds.length).toBeGreaterThan(0);
    expect(parsed.recommendations.length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("--save populates evidenceReportIds with the windowed outcome report ids", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    const idA = store.save(makeDegradedReport("pA"));
    const idB = store.save(makeDegradedReport("pB"));
    store.save(makeDegradedReport("pC"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "2", "--save", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    // Newest-first: pC and pB are the first two; pA is excluded by the window.
    expect(parsed.evidenceReportIds).toContain(idB);
    expect(parsed.evidenceReportIds).not.toContain(idA);
    expect(parsed.evidenceReportIds).toHaveLength(2);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("without --save, no report file is created (byte-identical to P10.7a)", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10"]);

    // No recommendation report saved.
    const recsDir = join(execDir, "recommendations");
    const { existsSync } = await import("node:fs");
    expect(existsSync(recsDir)).toBe(false);
    expect(c.err().join("\n")).not.toMatch(/Recommendation report saved:/);

    cwdSpy.mockRestore();
    c.restore();
  });
```

- [ ] **Step 2: Run the tests to verify the new 4 fail**

Run: `npx vitest run tests/cli/commands/executive-recommend-cli.vitest.ts`
Expected: the 4 new tests FAIL (no `--save` handling); the 6 existing tests still PASS.

- [ ] **Step 3: Modify the handler to support `--save`**

Replace the top of `handleRecommendCommand` and the end-of-handler branch in `src/cli/commands/executive-recommend-handler.ts` so it tracks the loaded outcome report ids, accepts `--save`, and (when set) writes via `RecommendationReportStore`. The complete updated handler:

```ts
/**
 * P10.7a — Executive recommend CLI handler.
 * P10.7b — Adds --save (persists RecommendationReport via RecommendationReportStore).
 *
 * Composes the P10.6 learning pipeline (OutcomeReportStore →
 * computeLearningTrends) with the P10.7a recommendation engine
 * (computeRecommendations) and renders a terminal table or JSON.
 *
 * Read-only unless --save is passed: --save is the only path that writes.
 * The store writes; the handler owns no filesystem operations itself.
 *
 * @module
 */

import { join } from "node:path";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { computeLearningTrends } from "../../executive/learning-engine.js";
import { computeRecommendations } from "../../executive/recommendation-engine.js";
import type { RecommendationResult } from "../../executive/recommendation-engine.js";
import {
  RecommendationReportStore,
} from "../../executive/recommendation-report-store.js";
import type { NewRecommendationReport } from "../../executive/recommendation-report-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW = 10;

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleRecommendCommand(args: string[]): Promise<void> {
  const windowIndex = args.indexOf("--window");
  const windowN = windowIndex !== -1 && windowIndex + 1 < args.length
    ? Math.max(1, parseInt(args[windowIndex + 1], 10) || DEFAULT_WINDOW)
    : DEFAULT_WINDOW;
  const useJson = args.includes("--json");
  const saveMode = args.includes("--save");

  const execDir = join(process.cwd(), ".alix", "executive");
  const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));

  const metas = outcomeStore.list();
  const windowed = metas.slice(0, windowN);
  const reports: ExecutiveOutcomeEvaluationReport[] = [];
  const evidenceReportIds: string[] = [];

  for (const meta of windowed) {
    try {
      const report = outcomeStore.load(meta.reportId);
      if (report) {
        reports.push(report);
        evidenceReportIds.push(meta.reportId);
      }
    } catch (e: any) {
      console.warn(`Skipping report ${meta.reportId}: ${e.message}`);
    }
  }

  const trends = computeLearningTrends(reports, windowN);
  const result = computeRecommendations(trends);

  let persistedReportId: string | null = null;

  if (saveMode) {
    const recStore = new RecommendationReportStore(
      join(execDir, "recommendations"),
    );
    const payload: NewRecommendationReport = {
      generatedAt: result.generatedAt,
      requestedWindow: result.requestedWindow,
      recommendationStatus: result.recommendationStatus,
      inputReportCount: result.inputReportCount,
      analyzedReportCount: result.analyzedReportCount,
      skippedReportCount: result.skippedReportCount,
      evidenceReportIds,
      recommendations: result.subsystemRecommendations,
      warnings: result.warnings,
      loadWarnings: result.loadWarnings,
    };
    persistedReportId = recStore.save(payload);
    // stderr keeps the id line out of any --json stdout stream.
    console.warn(`Recommendation report saved: ${persistedReportId}`);
  }

  if (useJson) {
    if (persistedReportId !== null) {
      // Re-load the persisted wrapper to emit id + contentHash with the JSON.
      const recStore = new RecommendationReportStore(
        join(execDir, "recommendations"),
      );
      const persisted = recStore.load(persistedReportId);
      console.log(JSON.stringify(persisted, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    renderTable(result);
  }
}

// ---------------------------------------------------------------------------
// Terminal rendering
// ---------------------------------------------------------------------------

function renderTable(result: RecommendationResult): void {
  if (result.subsystemRecommendations.length === 0) {
    console.log("No recommendations generated.");
    console.log(`Recommendation status: ${result.recommendationStatus}`);
    console.log(`Analyzed reports: ${result.analyzedReportCount}`);
    return;
  }

  console.log(`\nExecutive Recommendations (last ${result.requestedWindow} plans)`);
  console.log(`Generated: ${result.generatedAt}\n`);

  console.log(
    `${"Subsystem".padEnd(18)} ${"Signal".padEnd(24)} ${"Severity".padEnd(9)} ` +
    `${"Conf".padEnd(6)} ${"Occurrences".padEnd(12)} ${"Avg Δ".padEnd(7)} Recommendation`,
  );
  console.log("-".repeat(96));
  for (const r of result.subsystemRecommendations) {
    console.log(
      `${r.subsystem.padEnd(18)} ${r.signal.padEnd(24)} ${r.severity.padEnd(9)} ` +
      `${r.signalConfidence.toFixed(2).padEnd(6)} ${String(r.occurrenceCount).padEnd(12)} ` +
      `${fmtDelta(r.averageDelta).padEnd(7)} ${r.recommendation}`,
    );
  }

  console.log(
    `\nInput: ${result.inputReportCount} reports | Skipped: ${result.skippedReportCount}`,
  );
  for (const w of result.warnings) console.error(`Warning: ${w}`);
  for (const w of result.loadWarnings) console.error(`Load warning: ${w}`);
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
}
```

- [ ] **Step 4: Run the integration tests**

Run: `npx vitest run tests/cli/commands/executive-recommend-cli.vitest.ts`
Expected: PASS — all 10 tests green (6 existing + 4 new).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/executive-recommend-handler.ts tests/cli/commands/executive-recommend-cli.vitest.ts
git commit -m "feat(p10-7b): --save persists RecommendationReport with evidence ids"
```

---

### Task 4: Sentinel registration + scoped fs-exception + full suite

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` (add `recommendation-report-store.ts` to `EXECUTIVE_FILES` + one scoped fs-exception mirroring the `outcome-store.ts` block)

**Goal:** Register the new store as an approved write path. The handler and engine need NO exception (the handler calls `store.save()` which uses `RecommendationReportStore.save`, not any forbidden substring).

- [ ] **Step 1: Add the new file to `EXECUTIVE_FILES`**

In `tests/executive/executive-sentinels.vitest.ts`, find the `EXECUTIVE_FILES` array's P10.7a group:

```ts
  // P10.7a files
  "src/executive/recommendation-engine.ts",
  "src/cli/commands/executive-recommend-handler.ts",
];
```

Append a P10.7b group before the closing `];`:

```ts
  // P10.7a files
  "src/executive/recommendation-engine.ts",
  "src/cli/commands/executive-recommend-handler.ts",
  // P10.7b files
  "src/executive/recommendation-report-store.ts",
];
```

- [ ] **Step 2: Add the scoped fs-exception**

Find the existing `outcome-store.ts` exception block in the sentinel test loop (around line 207-214):

```ts
            // Scoped exception: plan-store.ts, execution-state-store.ts,
            // and outcome-store.ts are approved write paths
            if ((file === "src/executive/plan-store.ts" ||
                 file === "src/executive/execution-state-store.ts" ||
                 file === "src/executive/outcome-store.ts") &&
                (forbidden === "writeFileSync" || forbidden === "mkdirSync" ||
                 forbidden === "renameSync" || forbidden === "openSync" ||
                 forbidden === "fsyncSync" || forbidden === "closeSync")) {
              continue;
            }
```

Update it to also include `recommendation-report-store.ts`:

```ts
            // Scoped exception: plan-store.ts, execution-state-store.ts,
            // outcome-store.ts, and recommendation-report-store.ts are
            // approved write paths.
            if ((file === "src/executive/plan-store.ts" ||
                 file === "src/executive/execution-state-store.ts" ||
                 file === "src/executive/outcome-store.ts" ||
                 file === "src/executive/recommendation-report-store.ts") &&
                (forbidden === "writeFileSync" || forbidden === "mkdirSync" ||
                 forbidden === "renameSync" || forbidden === "openSync" ||
                 forbidden === "fsyncSync" || forbidden === "closeSync")) {
              continue;
            }
```

- [ ] **Step 3: Run the sentinel**

Run: `npx vitest run tests/executive/executive-sentinels.vitest.ts`
Expected: PASS — the new file scans cleanly with its scoped fs-exception. The test count increases by 1 (32 → 33).

- [ ] **Step 4: Run the full test suite + type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: full suite green (was 2022 at P10.7a; now 2022 + 8 store + 4 CLI = 2034); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts
git commit -m "test(p10-7b): register RecommendationReportStore in executive purity sentinel"
```

---

### Task 5: Final whole-branch review + PR + tag

- [ ] Dispatch the whole-branch code review (8-angle `code-review` skill, recall-biased) against the branch diff from the P10.7a merge base.
- [ ] Triage findings: dispatch ONE fix subagent with the complete findings list if any correctness findings surface; defer cleanup-only findings to the ledger.
- [ ] Run final `npx vitest run` + `npx tsc --noEmit`.
- [ ] Push branch, open PR against `main`, merge (squash), tag `alix-p10-7b-complete`, push tag.
- [ ] Update the progress ledger and write/append the memory entry.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| Architecture / data flow | Tasks 0–3 |
| Hard governance boundary (no proposals/governance/outcomes) | Implicit: only `RecommendationReportStore.save()` and `outcomeStore.load()` are called; no `ProposalStore`, `ApprovalGate`, or outcome evaluation. Tested via the `--save populates evidenceReportIds` test (proves we read outcome IDs) and the no-`--save` byte-identity test (proves we never write by default). |
| Reserved fields never populated | Task 2 store unit test "preserves reserved fields as undefined" |
| Domain separation | Task 2 storage path `.alix/executive/recommendations/` |
| Types (ExecutiveRecommendation, NewRecommendationReport, RecommendationReport, Meta, IntegrityError) | Task 2 |
| Rename confidence → signalConfidence | Task 1 |
| RecommendationReportStore (atomic, contentHash, schemaVersion, deterministic id, integrity error, list) | Task 2 (8 unit tests) |
| CLI `--save` flow | Task 3 (4 CLI tests: persist + id to stderr, --json --save full report, evidenceReportIds correct, no-regression) |
| Sentinel (one scoped exception) | Task 4 |
| File structure | Tasks 1–4 match the spec exactly |

**2. Placeholder scan:** none — every step has complete code or an exact command with expected output. No "TBD", "TODO", "similar to", or "fill in".

**3. Type consistency:**
- `RecommendationDraft.signalConfidence` (renamed in Task 1) → `ExecutiveRecommendation extends RecommendationDraft` inherits `signalConfidence` (Task 2). ✅
- `NewRecommendationReport` fields map 1:1 from `RecommendationResult` + `evidenceReportIds` (Task 3 payload builder). ✅
- `RecommendationReport = NewRecommendationReport + { schemaVersion, id, contentHash }` (Task 2). ✅
- Store `save(payload: NewRecommendationReport)` returns `string` (id); CLI captures `persistedReportId` and re-loads for `--json --save` (Task 3). ✅
- `buildRecommendationReportId(generatedAt)` used by both store (id derivation) and tests (Task 2). ✅

**Confidence:** the P10.7a whole-branch review returned MERGEABLE `[]` for the same code shape; the additions here are a mechanical rename, a mirror of an existing store pattern, and a `--save` CLI branch. Plan is internally consistent and spec-faithful.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-p10-7b-recommendation-persistence.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — Fresh implementer subagent per task (1–4), review between tasks, then final 8-angle whole-branch review before PR + tag.
2. **Inline Execution** — Tasks 1–4 in this session with checkpoints.

**Which approach?**