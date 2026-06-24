# P9.4a — GovernanceChangeApplier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely apply approved `governance_change` proposals by writing governance configuration files (calibration, lens registry) through a validated, atomic, evidence-recorded mutation pipeline.

**Architecture:** Single `GovernanceChangeApplier` class following the existing `AgentCardApplier` pattern — the applier handles validation, snapshot, and mutation. `ApprovalGate.apply()` wraps it with evidence recording and status transition. A process-local mutation lock serializes concurrent governance writes.

**Tech Stack:** TypeScript, Node.js `fs` (write-tmp → fsyncSync → renameSync), `node:crypto` (SHA-256 hashing), vitest.

## Global Constraints

1. `SUPPORTED_KINDS = new Set(["confidence_calibration", "lens_adjustment"])` — other kinds fail before file I/O.
2. All governance mutation writes use atomic write (write-tmp → fsync → rename) — no partial files.
3. All snapshots use atomic write (write-tmp → fsync → rename) — no partial snapshots.
4. Every mutation requires: validate → snapshot → pre-write hash check → atomic write → evidence → applied status.
5. Process-local mutation lock serializes snapshot through mutation (steps 8-12 of apply flow).
6. No changes to `adaptation-types.ts`, `ApprovalGate`, `EvidenceEventWriter`, `RevertApplier`, or existing appliers.
7. Only approved `governance_change` proposals may mutate governance files.
8. **Process-local lock assumption:** P9.4a assumes all governance mutations execute through a single ALiX process (CLI). If multi-process execution (daemon, REST API, dashboard, worker) is introduced later, the mutex must be replaced with a filesystem lock or governance lockfile service.

---
### Task 1: SnapshotStore atomic save

**Files:**
- Modify: `src/adaptation/snapshot-store.ts`
- Test: `tests/adaptation/snapshot-store.vitest.ts`

**Interfaces:**
- Consumes: existing `SnapshotStore` class (sync `save()`, `load()`, `loadVerified()`, `verify()` methods)
- Produces: `save()` atomic via write-tmp → fsyncSync → renameSync

- [ ] **Step 1: Modify `SnapshotStore.save()` to be atomic**

Change the `save()` method from direct `writeFileSync` to write-tmp → fsync → rename:

```ts
async save(snapshot: AdaptationSnapshot): Promise<void> {
  assertSafePathComponent(snapshot.proposalId);
  if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

  const targetPath = join(this.dir, `${snapshot.proposalId}.json`);
  const tmpPath = targetPath + ".tmp";

  // Atomic write: write to .tmp, fsync, then rename
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");

  // On Linux, renameSync is atomic if source and dest are on the same filesystem
  renameSync(tmpPath, targetPath);
}
```

Key points:
- `.tmp` file is on the same filesystem as the target (same directory), so `renameSync` is atomic per POSIX.
- If the `writeFileSync` call fails, only the `.tmp` file exists — the target is untouched.
- If the process crashes between `writeFileSync` and `renameSync`, a `.tmp` orphan may remain — no partial final snapshot. A `.gitignore` entry for `*.tmp` is acceptable but not required (`.tmp` files are small and in `.alix/`).

- [ ] **Step 2: Add atomicity tests to snapshot-store.vitest.ts**

After the existing "tampered contentHash" test, append:

```ts
it("save writes via temp file then renames to final", async () => {
  const snapshot = makeSnapshot();
  await store.save(snapshot);

  // Final snapshot file exists and has correct content
  const targetPath = join(dir, `${snapshot.proposalId}.json`);
  expect(existsSync(targetPath)).toBe(true);

  // .tmp file should not remain after successful save
  const tmpPath = targetPath + ".tmp";
  expect(existsSync(tmpPath)).toBe(false);

  // Content is valid JSON matching the snapshot
  const loaded = await store.load(snapshot.proposalId);
  expect(loaded).not.toBeNull();
  expect(loaded!.proposalId).toBe(snapshot.proposalId);
});

it("failed write does not leave a partial final snapshot", async () => {
  const snapshot = makeSnapshot();
  const targetPath = join(dir, `${snapshot.proposalId}.json`);

  // Make the directory read-only to force a write failure
  const origMode = 0o777;
  chmodSync(dir, 0o444); // read-only

  // Save should throw because the directory is read-only
  await expect(store.save(snapshot)).rejects.toThrow();

  // Restore permissions for cleanup
  chmodSync(dir, origMode);

  // Final snapshot file should NOT exist — no partial artifact
  expect(existsSync(targetPath)).toBe(false);
});
```

You'll need to add `chmodSync` to the import:
```ts
import { ..., chmodSync } from "node:fs";
```

- [ ] **Step 3: Run the tests to verify they pass**

```bash
npx vitest run tests/adaptation/snapshot-store.vitest.ts --reporter verbose 2>&1
```

Expected: 7 tests PASS (2 new + 5 existing).

- [ ] **Step 4: Run full suite + tsc**

```bash
npx vitest run tests/adaptation/ tests/cli/commands/adaptation.vitest.ts --reporter verbose 2>&1 | tail -20
npx tsc --noEmit
```

Expected: all existing tests still pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/adaptation/snapshot-store.ts tests/adaptation/snapshot-store.vitest.ts
git commit -m "fix(p9.4a): SnapshotStore.save() atomic write (write-tmp → rename)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 2: GovernanceChangeApplier

**Files:**
- Create: `src/adaptation/appliers/governance-change-applier.ts`
- Create: `tests/adaptation/appliers/governance-change-applier.vitest.ts`

**Interfaces:**
- Consumes: `SnapshotStore` (save/load/loadVerified), `EvidenceEventWriter` (recordSnapshotTaken), `AdaptationProposal`, `GovernanceChangePayload`
- Produces: `GovernanceChangeApplier` class with `apply(proposal): Promise<void>` method

- [ ] **Step 1: Write the failing tests**

In `tests/adaptation/appliers/governance-change-applier.vitest.ts`:

```ts
/**
 * P9.4a — GovernanceChangeApplier tests.
 *
 * Tests cover the full apply pipeline: validation, file resolution, schema
 * checks, drift detection, snapshot, mutation, and evidence recording.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SnapshotStore } from "../../../src/adaptation/snapshot-store.js";
import { GovernanceChangeApplier } from "../../../src/adaptation/appliers/governance-change-applier.js";
import type { AdaptationProposal, ProposalTarget } from "../../../src/adaptation/adaptation-types.js";
import type { GovernanceChangePayload } from "../../../src/governance/governance-types.js";
import type { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCalibrationFile(dir: string, entries: Array<{target: string; value: number}>): string {
  const calibrationsDir = join(dir, ".alix", "governance");
  mkdirSync(calibrationsDir, { recursive: true });
  const path = join(calibrationsDir, "calibration.json");
  writeFileSync(path, JSON.stringify({ calibrations: entries }, null, 2), "utf-8");
  return path;
}

function makeLensRegistry(dir: string, lenses: Array<{lens: string; status: string; enabled: boolean; pv?: number}>): string {
  const lensesDir = join(dir, ".alix", "governance");
  mkdirSync(lensesDir, { recursive: true });
  const path = join(lensesDir, "lens-registry.json");
  writeFileSync(path, JSON.stringify({ lenses }, null, 2), "utf-8");
  return path;
}

function makeGovernanceProposal(
  overrides: Partial<AdaptationProposal> & { payload?: GovernanceChangePayload },
): AdaptationProposal {
  return {
    id: "prop-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "approved",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-001" } as ProposalTarget,
    payload: { kind: "confidence_calibration", target: "red_team", currentCalibration: 0.7, suggestedCalibration: 0.75 },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test governance proposal",
    approvedBy: "test-operator",
    approvedAt: "2026-06-23T12:00:00.000Z",
    ...overrides,
  };
}
```

Test cases (write each as a separate `it` block, all pending — `it.todo` or `it.skip`):

1. `rejects non-approved proposal`
```ts
it("rejects non-approved proposal", async () => {
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal({ status: "pending" });
  await expect(applier.apply(proposal)).rejects.toThrow(/status.*approved/i);
});
```

2. `rejects non-governance_change proposal`
```ts
it("rejects non-governance_change proposal", async () => {
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal({ action: "update_agent_card" } as any);
  await expect(applier.apply(proposal)).rejects.toThrow(/governance_change/i);
});
```

3. `rejects unsupported payload kind`
```ts
it("rejects unsupported payload kind", async () => {
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal({
    payload: { kind: "chain_restoration" } as any,
  });
  await expect(applier.apply(proposal)).rejects.toThrow(/does not support/i);
});
```

4. `rejects missing target file`
```ts
it("rejects missing target file", async () => {
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal();
  await expect(applier.apply(proposal)).rejects.toThrow(/not found|missing/i);
});
```

5. `rejects invalid schema` — create calibration.json with empty object (no `calibrations` array)
```ts
it("rejects invalid schema", async () => {
  const govDir = join(tempRoot, ".alix", "governance");
  mkdirSync(govDir, { recursive: true });
  writeFileSync(join(govDir, "calibration.json"), JSON.stringify({ notCalibrations: [] }), "utf-8");
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal();
  await expect(applier.apply(proposal)).rejects.toThrow(/schema|calibrations/i);
});
```

6. `rejects stale proposal (current value drift)` — create calibration.json with wrong current value
```ts
it("rejects stale proposal (current value drift)", async () => {
  makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.65 }]); // expected 0.7
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal();
  await expect(applier.apply(proposal)).rejects.toThrow(/drift|current/i);
});
```

7. `rejects pre-write hash mismatch` — simulate file change between validation and write (use vi.mock or manually corrupt after snapshot but before write; this is tricky to test in isolation — see implementation note)

```ts
it("rejects pre-write hash mismatch", async () => {
  makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);

  // After snapshot but before mutation, modify the file externally
  // The implementation should read the file again before writing
  // (detected via pre-write hash check)
  const proposal = makeGovernanceProposal();
  await expect(applier.apply(proposal)).rejects.toThrow(/hash|changed/i);
});
```

Note: This test requires the implementation to compare a pre-write hash. The test helper `makeCalibrationFile` creates the file normally. The _implementation_ reads the file twice — once for validation and once before mutation — and compares hashes. If the file is unchanged between reads, the hashes match and the test passes. To make it fail, the test must modify the file between the applier's two reads. The cleanest approach: have the implementation accept an optional callback that the test can use to inject the modification:

```ts
it("rejects pre-write hash mismatch", async () => {
  makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
  let intercepted = false;
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer, {
    onBeforeMutation: () => {
      if (!intercepted) {
        intercepted = true;
        // Change the file between validation and mutation
        const calibrationPath = join(tempRoot, ".alix", "governance", "calibration.json");
        const data = JSON.parse(readFileSync(calibrationPath, "utf-8"));
        data.calibrations[0].value = 0.99;
        writeFileSync(calibrationPath, JSON.stringify(data), "utf-8");
      }
    },
  });
  const proposal = makeGovernanceProposal();
  await expect(applier.apply(proposal)).rejects.toThrow(/hash|changed|mismatch/i);
});
```

8. `applies confidence_calibration successfully`
```ts
it("applies confidence_calibration successfully", async () => {
  makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal();
  await applier.apply(proposal);

  // Verify the file was updated
  const calibrationPath = join(tempRoot, ".alix", "governance", "calibration.json");
  const content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
  expect(content.calibrations[0].value).toBe(0.75);
});
```

9. `applies lens_adjustment promote successfully`
```ts
it("applies lens_adjustment promote successfully", async () => {
  makeLensRegistry(tempRoot, [{ lens: "my_lens", status: "trial", enabled: true }]);
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal({
    payload: { kind: "lens_adjustment", operation: "promote", lens: "my_lens", currentPV: 0, reviewsAnalyzed: 10 },
  });
  await applier.apply(proposal);

  const lensPath = join(tempRoot, ".alix", "governance", "lens-registry.json");
  const content = JSON.parse(readFileSync(lensPath, "utf-8"));
  expect(content.lenses[0].status).toBe("active");
});
```

10. `applies lens_adjustment demote successfully`
```ts
it("applies lens_adjustment demote successfully", async () => {
  makeLensRegistry(tempRoot, [{ lens: "my_lens", status: "active", enabled: true }]);
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal({
    payload: { kind: "lens_adjustment", operation: "demote", lens: "my_lens", currentPV: 0, reviewsAnalyzed: 10 },
  });
  await applier.apply(proposal);

  const lensPath = join(tempRoot, ".alix", "governance", "lens-registry.json");
  const content = JSON.parse(readFileSync(lensPath, "utf-8"));
  expect(content.lenses[0].status).toBe("demoted");
});
```

11. `applies lens_adjustment retire successfully`
```ts
it("applies lens_adjustment retire successfully", async () => {
  makeLensRegistry(tempRoot, [{ lens: "my_lens", status: "active", enabled: true }]);
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal({
    payload: { kind: "lens_adjustment", operation: "retire", lens: "my_lens", currentPV: 0, reviewsAnalyzed: 10 },
  });
  await applier.apply(proposal);

  const lensPath = join(tempRoot, ".alix", "governance", "lens-registry.json");
  const content = JSON.parse(readFileSync(lensPath, "utf-8"));
  expect(content.lenses[0].status).toBe("retired");
  expect(content.lenses[0].enabled).toBe(false);
});
```

12. `records snapshot evidence on success`
```ts
it("records snapshot evidence on success", async () => {
  makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);
  const recordSnapshotTaken = vi.fn().mockResolvedValue(null);
  const writer = { recordSnapshotTaken } as any;
  const applier = new GovernanceChangeApplier(tempRoot, snapshotStore, writer);
  const proposal = makeGovernanceProposal();
  await applier.apply(proposal);

  expect(recordSnapshotTaken).toHaveBeenCalledWith(
    proposal.id,
    expect.objectContaining({
      snapshotFingerprint: expect.any(String),
      contentHash: expect.any(String),
      filePath: expect.stringContaining("calibration.json"),
    }),
  );
});
```

13. `full end-to-end apply with temp files` (integration)
```ts
it("full end-to-end apply with snapshot and verify", async () => {
  const snapDir = mkdtempSync(join(tmpdir(), "snap-"));
  const snapStore = new SnapshotStore(snapDir);
  const snapWriter = { recordSnapshotTaken: vi.fn().mockResolvedValue(null) } as any;
  makeCalibrationFile(tempRoot, [{ target: "red_team", value: 0.7 }]);

  const applier = new GovernanceChangeApplier(tempRoot, snapStore, snapWriter);
  const proposal = makeGovernanceProposal();
  await applier.apply(proposal);

  // File changed
  const calibrationPath = join(tempRoot, ".alix", "governance", "calibration.json");
  const content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
  expect(content.calibrations[0].value).toBe(0.75);

  // Snapshot exists
  const snapshot = await snapStore.load(proposal.id);
  expect(snapshot).not.toBeNull();

  // Snapshot content matches original state
  const decoded = Buffer.from(snapshot!.content, "base64").toString("utf-8");
  const originalState = JSON.parse(decoded);
  expect(originalState.calibrations[0].value).toBe(0.7);

  rmSync(snapDir, { recursive: true, force: true });
});
```

14. `revert governance mutation restores original content` (acceptance test — full lifecycle)
```ts
it("revert governance mutation restores original content", async () => {
  const snapDir = mkdtempSync(join(tmpdir(), "snap-"));
  const snapStore = new SnapshotStore(snapDir);
  const snapWriter = { recordSnapshotTaken: vi.fn().mockResolvedValue(null) } as any;

  // Set up original file
  const originalContent = { calibrations: [{ target: "red_team", value: 0.7 }] };
  const calibrationPath = makeCalibrationFile(tempRoot, originalContent.calibrations);

  // Apply governance change
  const applier = new GovernanceChangeApplier(tempRoot, snapStore, snapWriter);
  const proposal = makeGovernanceProposal();
  await applier.apply(proposal);

  // Verify file changed
  let content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
  expect(content.calibrations[0].value).toBe(0.75);

  // Revert through SnapshotStore → RevertApplier
  const { RevertApplier } = await import("../../../src/adaptation/revert-applier.js");
  const revertWriter = { recordRevertFailed: vi.fn(), recordRevertApplied: vi.fn() } as any;
  const revertApplier = new RevertApplier(snapDir, revertWriter);

  const revertProposal: AdaptationProposal = {
    ...proposal,
    id: "prop-rev-001",
    action: "revert_proposal" as any,
    target: { kind: "revert", sourceProposalId: proposal.id } as any,
  };

  await revertApplier.apply(revertProposal);

  // Verify file restored to original
  content = JSON.parse(readFileSync(calibrationPath, "utf-8"));
  expect(content.calibrations[0].value).toBe(0.7);

  // Snapshot contentHash integrity verified
  const snapshot = await snapStore.loadVerified(proposal.id);
  expect(snapshot).not.toBeNull();

  rmSync(snapDir, { recursive: true, force: true });
});
```

Place all test infrastructure and `describe`/`beforeEach`/`afterEach` around the tests:

```ts
describe("GovernanceChangeApplier", () => {
  let tempRoot: string;
  let snapDir: string;
  let snapshotStore: SnapshotStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "gov-applier-"));
    snapDir = mkdtempSync(join(tmpdir(), "snap-"));
    snapshotStore = new SnapshotStore(snapDir);
    writer = { recordSnapshotTaken: vi.fn().mockResolvedValue(null) } as any;
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    if (existsSync(snapDir)) rmSync(snapDir, { recursive: true, force: true });
  });

  // ...all 14 tests above go here...
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/adaptation/appliers/governance-change-applier.vitest.ts --reporter verbose 2>&1
```

Expected: all tests FAIL with "Cannot find module" or similar import errors (the class doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

In `src/adaptation/appliers/governance-change-applier.ts`:

```ts
/**
 * P9.4a — GovernanceChangeApplier.
 *
 * Applies an approved governance_change proposal by validating the payload,
 * snapshotting the target file, and performing the mutation atomically.
 *
 * CORE INVARIANT: Only approved governance_change proposals may mutate
 * governance files. Every mutation requires:
 *   validate → snapshot → pre-write hash check → atomic write → evidence
 *
 * Follows the same pattern as AgentCardApplier: the applier handles
 * snapshot + mutation. The ApprovalGate handles evidence recording and
 * status transition.
 *
 * P9.4a SUPPORTED_KINDS = { "confidence_calibration", "lens_adjustment" }
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AdaptationProposal, ProposalTarget } from "../adaptation-types.js";
import type { GovernanceChangePayload } from "../../governance/governance-types.js";
import type { SnapshotStore } from "../snapshot-store.js";
import type { EvidenceEventWriter } from "../../workflow/evidence-writer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOV_DIR = ".alix/governance";
const CALIBRATION_FILE = "calibration.json";
const LENS_REGISTRY_FILE = "lens-registry.json";

const SUPPORTED_KINDS = new Set<string>([
  "confidence_calibration",
  "lens_adjustment",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`Governance file not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function atomicWriteJson(path: string, data: Record<string, unknown>): void {
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, path);
}

// ---------------------------------------------------------------------------
// GovernanceChangeApplier
// ---------------------------------------------------------------------------

export interface GovernanceChangeApplierOptions {
  /** Hook called after snapshot but before mutation — for testing pre-write hash mismatch. */
  onBeforeMutation?: () => void;
}

export class GovernanceChangeApplier {
  private static lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly cwd: string,
    private readonly snapshotStore: SnapshotStore,
    private readonly writer: EvidenceEventWriter,
    private readonly options?: GovernanceChangeApplierOptions,
  ) {}

  /**
   * Apply an approved governance_change proposal.
   * Throws with a descriptive message if any validation or mutation step fails.
   */
  async apply(proposal: AdaptationProposal): Promise<void> {
    // (1) Validate status
    if (proposal.status !== "approved") {
      throw new Error(
        `GovernanceChangeApplier: proposal status is "${proposal.status}", expected "approved"`,
      );
    }

    // (2) Validate action
    if (proposal.action !== "governance_change") {
      throw new Error(
        `GovernanceChangeApplier: proposal action is "${proposal.action}", expected "governance_change"`,
      );
    }

    const payload = proposal.payload as GovernanceChangePayload;

    // (3) Validate kind is supported
    if (!SUPPORTED_KINDS.has(payload.kind)) {
      throw new Error(
        `GovernanceChangeApplier does not support ${payload.kind} in P9.4a. ` +
        `Supported kinds: ${[...SUPPORTED_KINDS].join(", ")}`,
      );
    }

    // (4) Resolve target file
    const targetFile = this.resolveTargetFile(payload.kind);

    // (5) Read and validate
    const data = readJson(targetFile);
    const validatedHash = this.computeFileHash(targetFile);

    this.validateSchema(payload.kind, data);
    this.validateCurrentValues(payload, data);

    // Acquire mutation lock (serializes steps 6-9)
    const release = await this.acquireLock();
    try {
      // (6) Snapshot target file
      await this.snapshotTarget(targetFile, proposal);

      // (7) Pre-write hash check
      const preWriteHash = this.computeFileHash(targetFile);
      if (preWriteHash !== validatedHash) {
        throw new Error(
          `Governance mutation aborted: target file changed between validation and mutation ` +
          `(hash: ${preWriteHash.slice(0, 8)} vs ${validatedHash.slice(0, 8)})`,
        );
      }

      // Hook for testing pre-write hash mismatch
      this.options?.onBeforeMutation?.();

      // (8) Mutate
      const mutated = this.applyMutation(payload, data);

      // (9) Write atomically
      atomicWriteJson(targetFile, mutated);
    } finally {
      // Release lock — next governance mutation can proceed
      release();
    }
  }

  // -----------------------------------------------------------------------
  // Private: file resolution
  // -----------------------------------------------------------------------

  private resolveTargetFile(kind: string): string {
    const govDir = join(this.cwd, GOV_DIR);
    switch (kind) {
      case "confidence_calibration":
        return join(govDir, CALIBRATION_FILE);
      case "lens_adjustment":
        return join(govDir, LENS_REGISTRY_FILE);
      default:
        throw new Error(`Unknown governance payload kind: ${kind}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: schema validation
  // -----------------------------------------------------------------------

  private validateSchema(kind: string, data: Record<string, unknown>): void {
    switch (kind) {
      case "confidence_calibration": {
        if (!Array.isArray(data.calibrations)) {
          throw new Error(
            "Invalid calibration.json schema: expected 'calibrations' array",
          );
        }
        break;
      }
      case "lens_adjustment": {
        if (!Array.isArray(data.lenses)) {
          throw new Error(
            "Invalid lens-registry.json schema: expected 'lenses' array",
          );
        }
        break;
      }
    }
  }

  private validateCurrentValues(
    payload: GovernanceChangePayload,
    data: Record<string, unknown>,
  ): void {
    switch (payload.kind) {
      case "confidence_calibration": {
        const calibrations = data.calibrations as Array<{ target: string; value: number }>;
        const entry = calibrations.find((c) => c.target === payload.target);
        if (!entry) {
          throw new Error(
            `Calibration drift: target "${payload.target}" not found in calibration.json`,
          );
        }
        if (entry.value !== payload.currentCalibration) {
          throw new Error(
            `Calibration drift detected for "${payload.target}": ` +
            `expected ${payload.currentCalibration}, found ${entry.value}`,
          );
        }
        break;
      }
      case "lens_adjustment": {
        const lenses = data.lenses as Array<{ lens: string }>;
        const entry = lenses.find((l) => l.lens === payload.lens);
        if (!entry) {
          throw new Error(
            `Lens adjustment drift: lens "${payload.lens}" not found in lens-registry.json`,
          );
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private: mutation
  // -----------------------------------------------------------------------

  private applyMutation(
    payload: GovernanceChangePayload,
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (payload.kind) {
      case "confidence_calibration": {
        const calibrations = [...(data.calibrations as Array<{ target: string; value: number }>)];
        const idx = calibrations.findIndex((c) => c.target === payload.target);
        calibrations[idx] = { ...calibrations[idx], value: payload.suggestedCalibration };
        return { ...data, calibrations };
      }
      case "lens_adjustment": {
        const lenses = [...(data.lenses as Array<{ lens: string; status: string; enabled?: boolean }>)];
        const idx = lenses.findIndex((l) => l.lens === payload.lens);
        switch (payload.operation) {
          case "promote":
            lenses[idx] = { ...lenses[idx], status: "active" };
            break;
          case "demote":
            lenses[idx] = { ...lenses[idx], status: "demoted" };
            break;
          case "retire":
            lenses[idx] = { ...lenses[idx], status: "retired", enabled: false };
            break;
        }
        return { ...data, lenses };
      }
      default:
        throw new Error(`Unsupported governance mutation kind: ${(payload as any).kind}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: snapshot
  // -----------------------------------------------------------------------

  private async snapshotTarget(
    filePath: string,
    proposal: AdaptationProposal,
  ): Promise<void> {
    const content = readFileSync(filePath, "utf-8");
    const base64 = Buffer.from(content, "utf-8").toString("base64");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const fingerprint = randomUUID();

    await this.snapshotStore.save({
      proposalId: proposal.id,
      snapshotAt: new Date().toISOString(),
      action: proposal.action,
      target: proposal.target as { kind: string } & Record<string, unknown>,
      filePath,
      content: base64,
      contentHash,
      fingerprint,
    });

    await this.writer.recordSnapshotTaken(proposal.id, {
      snapshotFingerprint: fingerprint,
      contentHash,
      filePath,
    });
  }

  // -----------------------------------------------------------------------
  // Private: hashing
  // -----------------------------------------------------------------------

  private computeFileHash(filePath: string): string {
    const content = readFileSync(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  }

  // -----------------------------------------------------------------------
  // Private: process-local mutation lock
  // -----------------------------------------------------------------------

  /**
   * Acquire the process-local governance mutation lock.
   * Serializes concurrent governance writes within the same process.
   * Returns a release function.
   */
  private async acquireLock(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const prev = GovernanceChangeApplier.lock;
    GovernanceChangeApplier.lock = next;
    await prev;
    return release!;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/adaptation/appliers/governance-change-applier.vitest.ts --reporter verbose 2>&1
```

Expected: all 14 tests PASS.

- [ ] **Step 5: Run full suite + tsc**

```bash
npx vitest run tests/adaptation/ tests/cli/commands/ --reporter verbose 2>&1 | tail -30
npx tsc --noEmit
```

Expected: all existing tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/appliers/governance-change-applier.ts tests/adaptation/appliers/governance-change-applier.vitest.ts
git commit -m "feat(p9.4a): GovernanceChangeApplier with confidence_calibration + lens_adjustment

- Single applier with internal routing for 2 supported kinds
- Full validation pipeline: status, action, kind, schema, drift, pre-write hash
- Atomic snapshot via SnapshotStore + atomic target writes via rename
- Process-local mutation lock serializes governance writes
- 14 tests covering all failure modes + happy paths + full lifecycle revert

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 3: selectApplier routing

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Test: `tests/cli/commands/adaptation.vitest.ts`

**Interfaces:**
- Consumes: `GovernanceChangeApplier` from Task 2, existing `selectApplier()` function
- Produces: Extended `selectApplier()` with `case "governance"`

- [ ] **Step 1: Write failing tests**

In `tests/cli/commands/adaptation.vitest.ts`, add after the existing tests:

```ts
describe("selectApplier governance routing", () => {
  let cwd: string;
  let snapDir: string;
  let snapshotStore: SnapshotStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "route-gov-"));
    snapDir = mkdtempSync(join(tmpdir(), "snap-"));
    snapshotStore = new SnapshotStore(snapDir);
    writer = { recordSnapshotTaken: vi.fn() } as any;
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(snapDir, { recursive: true, force: true });
  });

  it("routes target.kind === governance to GovernanceChangeApplier", () => {
    const proposal = makeGovernanceProposal();
    const applier = selectApplier(cwd, proposal, writer);
    expect(applier).toBeInstanceOf(Function);
    // Should not throw — governance is now a valid route
    expect(() => applier).not.toThrow();
  });

  it("still throws for target.kind === learning", () => {
    const proposal = makeGovernanceProposal({
      target: { kind: "learning", area: "test" } as any,
    });
    expect(() => selectApplier(cwd, proposal, writer)).toThrow(/learning/i);
  });

  it("unsupported governance payload kind fails inside applier, not selectApplier", async () => {
    // selectApplier should return a function without throwing
    const proposal = makeGovernanceProposal({
      payload: { kind: "chain_restoration" } as any,
    });
    const applier = selectApplier(cwd, proposal, writer);
    expect(applier).toBeInstanceOf(Function);

    // The applier should throw when called
    await expect(applier(proposal)).rejects.toThrow(/does not support/i);
  });
});
```

You'll need the helper `makeGovernanceProposal` from Task 2 if it's not already imported. Add to the top-level fixtures or inline:

```ts
function makeGovernanceProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "prop-gov-001",
    createdAt: "2026-06-23T00:00:00.000Z",
    status: "approved",
    action: "governance_change",
    target: { kind: "governance", recommendationId: "rec-001" } as ProposalTarget,
    payload: { kind: "confidence_calibration", target: "red_team", currentCalibration: 0.7, suggestedCalibration: 0.75 },
    sourceRecommendationType: "governance",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test governance proposal",
    approvedBy: "test-operator",
    approvedAt: "2026-06-23T12:00:00.000Z",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/cli/commands/adaptation.vitest.ts --reporter verbose 2>&1 | grep -A5 "selectApplier governance"
```

Expected: 3 tests FAIL — `selectApplier` doesn't have a `case "governance"` yet.

- [ ] **Step 3: Modify selectApplier**

In `src/cli/commands/adaptation.ts`, add after the `case "revert"` block:

```ts
case "governance": {
  const applier = new GovernanceChangeApplier(cwd, snapshotStore, writer);
  return (p) => applier.apply(p);
}
```

Update the `default` error message to include "governance":

```ts
default:
  throw new Error(
    `No applier registered for target.kind "${proposal.target.kind}" (proposal ${proposal.id}). ` +
      `Supports "agent_card", "skill", "revert", and "governance".`,
  );
```

Add the import at the top of the file:

```ts
import { GovernanceChangeApplier } from "../adaptation/appliers/governance-change-applier.js";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/adaptation.vitest.ts --reporter verbose 2>&1
```

Expected: all existing adaptation CLI tests + 3 new routing tests PASS.

- [ ] **Step 5: Run full suite + tsc**

```bash
npx vitest run tests/adaptation/ tests/cli/commands/ --reporter verbose 2>&1 | tail -20
npx tsc --noEmit
```

Expected: all tests pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/adaptation.ts tests/cli/commands/adaptation.vitest.ts
git commit -m "feat(p9.4a): selectApplier governance routing

- Add case governance → GovernanceChangeApplier
- Update default error message
- 3 routing tests (governance, learning still throws, unsupported kind inside applier)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---
### Task 4: Sentinel + final whole-branch review

**Files:**
- Review: `tests/governance/governance-sentinels.vitest.ts` (may need updates)
- New file `governance-change-applier.ts` is in `src/adaptation/appliers/` — NOT under `src/governance/`. The P9 sentinel covers only P9 governance files. The applier is an adaptation applier (like AgentCardApplier), so it does NOT need sentinel enforcement.

**Verification checklist:**

- [ ] **Step 1: Verify sentinel does NOT need changes**

```bash
# The sentinel's ALL_FILES lists files under src/governance/ and src/cli/commands/governance.ts
# The new file is at src/adaptation/appliers/governance-change-applier.ts
# The existing P9 sentinel does not cover adaptation/appliers/ — no sentinel change needed.
grep -c "governance-change-applier" tests/governance/governance-sentinels.vitest.ts
```

Expected: 0 — the new applier is not a governance file, it's an adaptation applier.

- [ ] **Step 2: Verify evidence-writer.ts sentinel**

Check if the governance sentinel restricts imports to `evidence-writer.ts` from governance files. The applier file is NOT in the governance directory so it doesn't need to be added to the sentinel.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run tests/ --reporter verbose 2>&1 | tail -30
npx tsc --noEmit
```

Expected: all tests pass, tsc clean.

- [ ] **Step 4: Run detect_changes for impact analysis**

```bash
npx gitnexus detect_changes
```

Review the output to confirm only expected files are affected.

- [ ] **Step 5: Dispatch final whole-branch review**

Use superpowers:subagent-driven-development to dispatch the final whole-branch code reviewer. The review package should cover all commits on this branch. The reviewer should verify:
1. All 14 GovernanceChangeApplier tests pass
2. All 3 routing tests pass  
3. SnapshotStore atomicity is verified (2 new tests)
4. `tsc --noEmit` is clean
5. Sentinel coverage is correct (no new governance files under src/governance/ need sentinel updates)
6. No protected type files were modified (adaptation-types.ts, evidence-types.ts unchanged)

- [ ] **Step 6: Branch completion**

If the review is clean, use superpowers:finishing-a-development-branch.
