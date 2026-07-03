# P10.9.2a — Proposal State Machine & Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make proposal lifecycle state queryable by deriving operational readiness from stored `ProposalStatus` + action + target + payload — without touching protected adaptation types.

**Architecture:** One pure function `computeProposalReadiness(proposal)` that returns `ProposalReadinessInfo` (derived state). Three CLI surfaces consume it: `list` adds readiness columns, `show` adds readiness block, `apply` gates on readiness. One new `bridge status` subcommand aggregates readiness across executive bridge proposals. Nothing is persisted.

**Tech Stack:** TypeScript, filesystem proposal store (no new persistence), existing CLI handler pattern.

**Spec:** `docs/architecture/specs/p10-9-2a-proposal-readiness-design.md`

## Global Constraints

- **No ADR-0004 protected type changes.** Do not modify `adaptation-types.ts`, `proposal-store.ts`, `approval-gate.ts`, or any file that triggers snapshot-equal verification.
- **Pure derivation only.** Readiness is computed on read, never cached or persisted. No new store, no new JSONL file, no new database table.
- **Follow existing patterns.** The `selectApplier` switch, `MANUAL_KINDS` set, and `isManualKind` helper in `adaptation.ts` are the established routing pattern. The `handleBridgeCommand` function in `executive-bridge-handler.ts` is the established CLI handler pattern.
- **Bridge status scoping.** `bridge status` defaults to executive bridge-related proposals only: those with `sourceRecommendationType === "executive_remediation"` or `payload.source === "executive_bridge"`. No `--all` flag in this slice.
- **Test coverage.** Every row of the readiness decision table must have a test. Every apply gate branch must have a test.

---

### Task 1: Pure types + `computeProposalReadiness` + `getApplySupport` + unit tests

**Files:**
- Create: `src/adaptation/proposal-readiness.ts`
- Create: `tests/adaptation/proposal-readiness.vitest.ts`

**Interfaces:**
- Consumes: `AdaptationProposal` from `src/adaptation/adaptation-types.ts`, `ProposalTarget` kinds, `ProposalStatus`, `ProposalAction`
- Produces: `ProposalReadiness`, `ApplySupport`, `ProposalReadinessInfo`, `computeProposalReadiness()`, `getApplySupport()`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/adaptation/proposal-readiness.vitest.ts`. The test file should import `ProposalTarget` from `../../src/adaptation/adaptation-types.js` but define its own minimal `AdaptationProposal` factory inline (avoids importing the full type with all fields). Tests for every row of the decision table:

```typescript
import { describe, it, expect } from "vitest";
import { computeProposalReadiness, getApplySupport } from "../../src/adaptation/proposal-readiness.js";
import type { AdaptationProposal, ProposalTarget } from "../../src/adaptation/adaptation-types.js";

function makeProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "test-prop",
    createdAt: "2026-06-29T12:00:00.000Z",
    status: "pending",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "agent-x" },
    payload: {},
    sourceRecommendationType: "test",
    sourceConfidence: 0.8,
    evidenceFingerprints: [],
    reason: "test",
    ...overrides,
  } as AdaptationProposal;
}
```

Test cases (at minimum — group logically):

**Decision table tests:**

1. `pending + agent_card → readiness: "needs_approval", applyable: false`
2. `approved + agent_card → readiness: "ready_to_apply", applyable: true`
3. `approved + executive_remediation + requiresHumanSpecification → readiness: "needs_specification", applyable: false, support.nextCommand: "alix executive remediate ..."`
4. `approved + capability → readiness: "manual_action", applyable: false, support.kind: "manual_kind"`
5. `approved + learning → readiness: "blocked", applyable: false, support.kind: "unsupported"`
6. `applied → readiness: "completed", applyable: false, nextAction includes "effectiveness"`
7. `rejected → readiness: "completed", applyable: false, nextAction includes "No further action"`
8. `failed → readiness: "completed", applyable: false, nextAction includes "Inspect failure"`

**Edge case tests:**

9. `pending + executive_remediation + requiresHumanSpecification: true → readiness: "needs_approval"` (approval gate comes first, not needs_specification)
10. `approved + executive_remediation + no requiresHumanSpecification → readiness: "blocked"` (shouldn't happen in practice, but safe default)
11. `approved + issue → readiness: "manual_action"` (manual kind even though no applier)
12. `getApplySupport returns kind for registered_applier targets (agent_card, skill, revert, governance)`
13. `getApplySupport returns unsupported for executive_remediation with nextCommand`
14. `getApplySupport returns unsupported for learning with deferred reason`

Each test should assert the full `ProposalReadinessInfo` shape.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/adaptation/proposal-readiness.vitest.ts --reporter=verbose 2>&1 | head -30
```

Expected: All tests FAIL with "module not found" or "function not defined" errors.

- [ ] **Step 3: Write minimal implementation**

Create `src/adaptation/proposal-readiness.ts`:

```typescript
/**
 * P10.9.2a — Proposal State Machine & Readiness.
 *
 * Pure derivation layer: computes operational readiness from stored
 * proposal fields. Never persisted — derived on every read.
 *
 * @module
 */

import type {
  AdaptationProposal,
  ProposalAction,
  ProposalTarget,
} from "./adaptation-types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProposalReadiness =
  | "needs_approval"
  | "needs_specification"
  | "ready_to_apply"
  | "manual_action"
  | "blocked"
  | "completed";

export type ApplySupportKind =
  | "registered_applier"
  | "manual_kind"
  | "unsupported";

export interface ApplySupport {
  supported: boolean;
  kind: ApplySupportKind;
  reason?: string;
  nextCommand?: string;
}

export interface ProposalReadinessInfo {
  /** The canonical stored status — always reflects what's on disk. */
  status: string;
  /** Derived operational readiness. What can the operator do next? */
  readiness: ProposalReadiness;
  /** Whether `alix adaptation apply` will succeed on this proposal. */
  applyable: boolean;
  /** Human-readable guidance for the operator's next step. */
  nextAction: string;
  /** Why the proposal is not applyable (when readiness !== ready_to_apply). */
  blocker?: string;
  /** Applier support classification, for routing decisions. */
  support: ApplySupport;
}

// ---------------------------------------------------------------------------
// Applier support classification
// ---------------------------------------------------------------------------

const REGISTERED_APPLIER_KINDS = new Set<string>([
  "agent_card", "skill", "revert", "governance",
]);
const MANUAL_KINDS = new Set<string>(["capability", "issue", "routing_weight"]);

/**
 * Pure classification of applier support for a proposal's target kind.
 * Maps to the same routing table as `selectApplier` in adaptation.ts,
 * but never throws — returns a structured result instead.
 */
export function getApplySupport(proposal: AdaptationProposal): ApplySupport {
  const kind = proposal.target.kind;

  if (REGISTERED_APPLIER_KINDS.has(kind)) {
    return { supported: true, kind: "registered_applier" };
  }

  if (MANUAL_KINDS.has(kind)) {
    return { supported: false, kind: "manual_kind" };
  }

  // Unsupported kinds
  if (kind === "executive_remediation") {
    return {
      supported: false,
      kind: "unsupported",
      reason: "requires human specification",
      nextCommand: `alix executive remediate ${proposal.id}`,
    };
  }

  if (kind === "learning") {
    return {
      supported: false,
      kind: "unsupported",
      reason: "learning proposal application deferred to P8.9/P9",
    };
  }

  // Fallback for unknown kinds
  return {
    supported: false,
    kind: "unsupported",
    reason: `unknown target kind: "${kind}"`,
  };
}

// ---------------------------------------------------------------------------
// Readiness derivation
// ---------------------------------------------------------------------------

function deriveReadiness(
  status: string,
  support: ApplySupport,
  proposal: AdaptationProposal,
): {
  readiness: ProposalReadiness;
  applyable: boolean;
  nextAction: string;
  blocker?: string;
} {
  // Terminal statuses
  if (status === "applied") {
    return {
      readiness: "completed",
      applyable: false,
      nextAction: `Assess effectiveness with: alix adaptation effectiveness ${proposal.id}`,
    };
  }
  if (status === "rejected") {
    return {
      readiness: "completed",
      applyable: false,
      nextAction: "No further action required.",
    };
  }
  if (status === "failed") {
    return {
      readiness: "completed",
      applyable: false,
      nextAction: `Inspect failure with: alix adaptation show ${proposal.id}`,
    };
  }

  // Pending: always needs approval first
  if (status === "pending") {
    return {
      readiness: "needs_approval",
      applyable: false,
      nextAction: `Run: alix adaptation approve ${proposal.id}`,
    };
  }

  // Approved — derive readiness from support + payload
  if (status === "approved") {
    // ready_to_apply: has a registered applier
    if (support.supported && support.kind === "registered_applier") {
      return {
        readiness: "ready_to_apply",
        applyable: true,
        nextAction: `Run: alix adaptation apply ${proposal.id}`,
      };
    }

    // needs_specification: unsupported but has specification hint
    if (
      !support.supported &&
      support.kind === "unsupported" &&
      proposal.payload?.requiresHumanSpecification === true
    ) {
      const cmd = support.nextCommand
        ? `Run: ${support.nextCommand}`
        : `Proposal ${proposal.id} requires human specification.`;
      return {
        readiness: "needs_specification",
        applyable: false,
        nextAction: cmd,
        blocker: support.reason ?? "requires human specification",
      };
    }

    // manual_action: intentional non-applyable workflow
    if (!support.supported && support.kind === "manual_kind") {
      return {
        readiness: "manual_action",
        applyable: false,
        nextAction: `This is a manual action. See: alix adaptation show ${proposal.id}`,
        blocker: "manual action — no automated applier",
      };
    }

    // blocked: unsupported with no specification path
    return {
      readiness: "blocked",
      applyable: false,
      nextAction: `Proposal ${proposal.id} is blocked: ${support.reason ?? "no applier available"}.`,
      blocker: support.reason ?? "no applier available",
    };
  }

  // Defensive: unknown status
  return {
    readiness: "blocked",
    applyable: false,
    nextAction: `Unknown proposal status: "${status}".`,
    blocker: `unknown status: "${status}"`,
  };
}

/**
 * Compute operational readiness for a proposal from its stored fields.
 *
 * Pure function — no I/O, no side effects. Derives readiness from:
 *   proposal.status + proposal.action + proposal.target.kind + proposal.payload
 */
export function computeProposalReadiness(
  proposal: AdaptationProposal,
): ProposalReadinessInfo {
  const support = getApplySupport(proposal);
  const { readiness, applyable, nextAction, blocker } = deriveReadiness(
    proposal.status,
    support,
    proposal,
  );

  return {
    status: proposal.status,
    readiness,
    applyable,
    nextAction,
    blocker,
    support,
  };
}

// ---------------------------------------------------------------------------
// Convenience: filter bridge-relevant proposals
// ---------------------------------------------------------------------------

/**
 * Check whether a proposal is executive-bridge-relevant for `bridge status`.
 * Matches if sourceRecommendationType is executive_remediation or
 * payload.source is executive_bridge.
 */
export function isExecutiveBridgeProposal(proposal: AdaptationProposal): boolean {
  return (
    proposal.sourceRecommendationType === "executive_remediation" ||
    (proposal.payload as Record<string, unknown>)?.source === "executive_bridge"
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/adaptation/proposal-readiness.vitest.ts --reporter=verbose 2>&1
```

Expected: All tests PASS.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/adaptation/proposal-readiness.ts tests/adaptation/proposal-readiness.vitest.ts
git commit -m "P10.9.2a-T1: pure readiness types + computeProposalReadiness + getApplySupport

- ProposalReadiness type (6 values: needs_approval through completed)
- ApplySupport interface with kind classification
- ProposalReadinessInfo with readiness + applyable + nextAction + blocker
- getApplySupport(): safe classification, never throws
- computeProposalReadiness(): full derivation from status + kind + payload
- isExecutiveBridgeProposal(): filter for bridge status scoping
- 14 unit tests covering every decision table row + edge cases

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Wire readiness into `adaptation.ts` — list columns, show block, apply gate

**Files:**
- Modify: `src/cli/commands/adaptation.ts`
- Create: `tests/cli/commands/adaptation-readiness.vitest.ts`

**Interfaces:**
- Consumes: `computeProposalReadiness`, `ProposalReadinessInfo` from `src/adaptation/proposal-readiness.ts`
- Modifies: `runList()` (lines ~162-191), `runShow()` (lines ~194-208), `runApply()` (lines ~330-371)

- [ ] **Step 1: Write the failing CLI integration tests**

Create `tests/cli/commands/adaptation-readiness.vitest.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeProposalReadiness } from "../../../src/adaptation/proposal-readiness.js";
// ... test helpers for CLI output capture
```

Test cases:

1. **list output includes Readiness column** — run `alix adaptation list`, verify output contains "Readiness" header and values like "needs_approval", "ready_to_apply"
2. **list output includes Applyable column** — verify "Applyable" header and "yes"/"no" values
3. **show output includes readiness block** — run `alix adaptation show <id>`, verify output contains "Readiness:", "Applyable:", "Next action:"
4. **apply ready_to_apply succeeds** — verify the existing apply path still works for proposals with readiness ready_to_apply
5. **apply needs_approval refused** — verify friendly refusal message for pending proposal
6. **apply needs_specification refused** — verify friendly refusal with remediate hint
7. **apply manual_action routed to printManualAction** — verify existing manual action guidance
8. **apply completed refused** — verify friendly refusal for applied/rejected/failed
9. **apply blocked refused** — verify blocked proposal shows blocker reason

The test file should use the same pattern as existing CLI tests in `tests/cli/commands/` (spawn CLI process or mock proposal store and call handler functions directly). Follow the pattern of `tests/cli/commands/adaptation.vitest.ts` for test setup.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/commands/adaptation-readiness.vitest.ts --reporter=verbose 2>&1 | head -40
```

Expected: Tests FAIL with output not matching expected readiness columns/messages.

- [ ] **Step 3: Modify `runList()` in `src/cli/commands/adaptation.ts`**

Replace the current header and row format (lines ~181-189):

**Current:**
```typescript
console.log(
  `${"ID".padEnd(26)} ${"Status".padEnd(10)} ${"Action".padEnd(26)} Target`,
);
console.log("-".repeat(90));
for (const p of proposals) {
  console.log(
    `${p.id.padEnd(26)} ${p.status.padEnd(10)} ${p.action.padEnd(26)} ${describeTarget(p)}`,
  );
}
```

**New (add import for `computeProposalReadiness` at top of file):**
```typescript
import { computeProposalReadiness } from "../../adaptation/proposal-readiness.js";
```

**New list format:**
```typescript
console.log(
  `${"ID".padEnd(26)} ${"Status".padEnd(10)} ${"Readiness".padEnd(20)} ${"Applyable".padEnd(10)} ${"Action".padEnd(26)} Target`,
);
console.log("-".repeat(110));
for (const p of proposals) {
  const info = computeProposalReadiness(p);
  console.log(
    `${p.id.padEnd(26)} ${p.status.padEnd(10)} ${info.readiness.padEnd(20)} ${(info.applyable ? "yes" : "no").padEnd(10)} ${p.action.padEnd(26)} ${describeTarget(p)}`,
  );
}
```

- [ ] **Step 4: Modify `runShow()` to include readiness block**

After the existing `printProposal(proposal)` call, add:

```typescript
// P10.9.2a — derived readiness block
const info = computeProposalReadiness(proposal);
console.log(`Readiness:      ${info.readiness}`);
console.log(`Applyable:      ${info.applyable ? "yes" : "no"}`);
if (info.blocker) {
  console.log(`Blocker:        ${info.blocker}`);
}
console.log(`Next action:    ${info.nextAction}`);
```

- [ ] **Step 5: Modify `runApply()` to add readiness gate**

In `runApply()`, insert a readiness check **before** the `selectApplier()` call (after the existing manual-kind intercept at line ~358):

```typescript
// P10.9.2a — readiness gate: route/refuse before calling selectApplier
const readinessInfo = computeProposalReadiness(proposal);

switch (readinessInfo.readiness) {
  case "ready_to_apply":
    // Proceed to selectApplier below
    break;

  case "needs_approval":
    console.error(
      `Proposal ${id} is not yet approved. Run \`alix adaptation approve ${id}\` first.`,
    );
    process.exit(1);

  case "needs_specification":
    console.error(
      `Proposal ${id} requires human specification. Run \`${readinessInfo.support.nextCommand ?? `alix executive remediate ${id}`}\` to fill in details.`,
    );
    process.exit(1);

  case "manual_action":
    printManualAction(proposal);
    return; // clean exit, no mutation

  case "blocked":
    console.error(
      `Proposal ${id} is blocked: ${readinessInfo.blocker ?? "unknown reason"}.`,
    );
    process.exit(1);

  case "completed":
    console.error(
      `Proposal ${id} has already been ${proposal.status}.`,
    );
    process.exit(1);
}
```

Note: The existing `isManualKind` intercept (lines ~358-361) should be **removed** since the readiness gate now handles manual_action routing. This avoids duplicate routing logic.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/adaptation-readiness.vitest.ts --reporter=verbose 2>&1
```

Expected: All tests PASS.

- [ ] **Step 7: Run full suite to verify no regressions**

```bash
npx vitest run 2>&1 | tail -15
```

Expected: All existing tests still pass (the new readiness gate replaces the manual_kind intercept but doesn't change behavior for manual kinds).

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/adaptation.ts tests/cli/commands/adaptation-readiness.vitest.ts
git commit -m "P10.9.2a-T2: wire readiness into adaptation list, show, and apply

- list: adds Readiness (20-char) and Applyable (10-char) columns
- show: appends Readiness/Applyable/Blocker/NextAction block
- apply: readiness gate before selectApplier — friendly refusal messages
- manual_action routes through readiness gate instead of isManualKind intercept
- 9 CLI integration tests for all apply-gate branches

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add `alix executive bridge status` read-only subcommand

**Files:**
- Modify: `src/cli/commands/executive-bridge-handler.ts`
- Modify: `src/cli/commands/executive.ts` (routing)
- Create: `tests/cli/commands/executive-bridge-status.vitest.ts`

**Interfaces:**
- Consumes: `ProposalStore` from `src/adaptation/proposal-store.ts`, `computeProposalReadiness`, `ProposalReadiness`, `isExecutiveBridgeProposal` from `src/adaptation/proposal-readiness.ts`
- Modifies: `handleBridgeCommand()` to route to `handleBridgeStatus()` when `args[0] === "status"`

- [ ] **Step 1: Write failing tests**

Create `tests/cli/commands/executive-bridge-status.vitest.ts`:

Test cases:
1. **empty store → "No bridge proposals"**
2. **one needs_specification + one ready_to_apply → correct counts**
3. **filters by planId via payload.planId**
4. **--json output is valid JSON with correct structure**
5. **non-bridge proposals excluded from summary**
6. **detail section lists proposal id + readiness + subsystem**

The test should seed a temporary `.alix/adaptation/proposals/` directory with fixture proposals, then invoke the handler.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/cli/commands/executive-bridge-status.vitest.ts --reporter=verbose 2>&1 | head -30
```

Expected: All tests FAIL.

- [ ] **Step 3: Add `handleBridgeStatus()` to `executive-bridge-handler.ts`**

Add a new exported function:

```typescript
// Import at top:
import { ProposalStore } from "../../adaptation/proposal-store.js";
import {
  computeProposalReadiness,
  isExecutiveBridgeProposal,
} from "../../adaptation/proposal-readiness.js";
import type { ProposalReadiness } from "../../adaptation/proposal-readiness.js";

// New function:
export async function handleBridgeStatus(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const useJson = args.includes("--json");
  const planIdx = args.indexOf("--plan");
  const planFilter =
    planIdx !== -1 && planIdx + 1 < args.length ? args[planIdx + 1] : undefined;

  const proposalStore = new ProposalStore(
    join(cwd, ".alix", "adaptation", "proposals"),
  );
  const allProposals = await proposalStore.list();

  // Filter to executive-bridge-relevant proposals
  const bridgeProposals = allProposals.filter(isExecutiveBridgeProposal);

  // Compute readiness for each
  const withReadiness = bridgeProposals.map((p) => ({
    proposal: p,
    readiness: computeProposalReadiness(p),
  }));

  // Optional planId filter (via payload.planId)
  const filtered = planFilter
    ? withReadiness.filter((r) => {
        const payload = r.proposal.payload as Record<string, unknown>;
        return (
          payload?.planId === planFilter ||
          // Fallback: check target for executive_remediation target kind
          (r.proposal.target.kind === "executive_remediation" &&
            (r.proposal.target as { planId?: unknown }).planId === planFilter)
        );
      })
    : withReadiness;

  if (filtered.length === 0) {
    if (useJson) {
      console.log(JSON.stringify({
        needsSpecification: 0,
        readyToApply: 0,
        manualAction: 0,
        blocked: 0,
        details: [],
      }));
    } else {
      console.log("No bridge proposals found.");
    }
    return;
  }

  // Aggregate by readiness
  const groups: Record<string, typeof filtered> = {};
  for (const item of filtered) {
    const key = item.readiness.readiness;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  if (useJson) {
    console.log(JSON.stringify({
      needsSpecification: (groups["needs_specification"] ?? []).length,
      readyToApply: (groups["ready_to_apply"] ?? []).length,
      manualAction: (groups["manual_action"] ?? []).length,
      blocked: (groups["blocked"] ?? []).length,
      details: filtered.map((r) => ({
        id: r.proposal.id,
        readiness: r.readiness.readiness,
        subsystem: (r.proposal.target as Record<string, string>).subsystem ?? "unknown",
        nextCommand: r.readiness.support.nextCommand ?? null,
      })),
    }));
  } else {
    console.log("Bridge Summary");
    console.log("──────────────");
    console.log(`Needs specification:  ${(groups["needs_specification"] ?? []).length}`);
    console.log(`Ready to apply:       ${(groups["ready_to_apply"] ?? []).length}`);
    console.log(`Manual action:        ${(groups["manual_action"] ?? []).length}`);
    console.log(`Blocked:              ${(groups["blocked"] ?? []).length}`);
    console.log("");
    console.log("Detail:");
    for (const item of filtered) {
      const target = item.proposal.target as Record<string, string>;
      const subsystem = target.subsystem ?? "unknown";
      const cmd = item.readiness.support.nextCommand
        ? `  ${item.readiness.support.nextCommand}`
        : "";
      console.log(
        `  ${item.proposal.id}  ${item.readiness.readiness}  ${subsystem}${cmd ? `\n${cmd}` : ""}`,
      );
    }
  }
}
```

- [ ] **Step 4: Update `handleBridgeCommand()` to route `status` subcommand**

At the top of `handleBridgeCommand`, add:

```typescript
export async function handleBridgeCommand(args: string[]): Promise<void> {
  // Route subcommands
  if (args[0] === "status") {
    return handleBridgeStatus(args.slice(1));
  }
  // ... rest of existing bridge logic
}
```

- [ ] **Step 5: Verify no routing change needed in `executive.ts`**

The existing `executive.ts` routing (lines 119-124) dispatches `bridge` to `handleBridgeCommand`. Since we handle subcommand routing inside that function, no change to `executive.ts`.

Actually — verify: does `executive.ts` pass `rest` which includes the subcommand? Check line 123: `return handleBridgeCommand(rest);` where `rest` is the remaining args after `bridge`. So when user types `alix executive bridge status`, `rest = ["status"]`, and `handleBridgeCommand(["status"])` routes to `handleBridgeStatus([])`. This is correct without modifying `executive.ts`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/cli/commands/executive-bridge-status.vitest.ts --reporter=verbose 2>&1
```

Expected: All tests PASS.

- [ ] **Step 7: Run full suite + type-check**

```bash
npx vitest run 2>&1 | tail -10
npx tsc --noEmit 2>&1
```

Expected: All tests pass. tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/executive-bridge-handler.ts tests/cli/commands/executive-bridge-status.vitest.ts
git commit -m "P10.9.2a-T3: add alix executive bridge status subcommand

- handleBridgeStatus(): read-only aggregation of bridge proposal readiness
- Default scope: executive-bridge proposals only (sourceRecommendationType or payload.source)
- Supports --json (machine-readable) and --plan <planId> (filter by payload.planId)
- Summary counts: needs_specification, ready_to_apply, manual_action, blocked
- Detail section: proposal id, readiness, subsystem, nextCommand hint
- 6 integration tests covering empty, mixed, filtered, JSON, and scope

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Sentinel registration + full suite verification + final review

**Files:**
- Modify: `tests/executive/executive-sentinels.vitest.ts` (if `proposal-readiness.ts` needs allowlist entry)
- No other source changes

**Note:** `proposal-readiness.ts` is a pure function with no I/O, no file system access, no mutation. It should NOT need a sentinel allowlist entry. The executive purity sentinel covers `src/executive/` files — `proposal-readiness.ts` lives in `src/adaptation/`, which is outside the executive sentinel scope. Verify this in Step 2.

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: All tests pass (including all new + all existing). No regressions from:
- `runList` column changes
- `runShow` readiness block addition
- `runApply` readiness gate replacing `isManualKind` intercept
- New `bridge status` handler

Record the final count (e.g., "2274 tests across 210 files").

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 3: Verify sentinel**

Run the sentinel tests to ensure no new file triggers a purity violation:

```bash
npx vitest run tests/executive/executive-sentinels.vitest.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All 44 (or current count) sentinel checks pass. If `proposal-readiness.ts` is flagged, add it to the executive files allowlist — but it shouldn't be, since it's under `src/adaptation/` not `src/executive/`.

- [ ] **Step 4: Verify no ADR-0004 protected files were modified**

```bash
# Check protected baselines (if they exist)
ls docs/architecture/adrs/baselines/ 2>/dev/null
# Verify key files haven't changed
git diff --name-only HEAD -- src/adaptation/adaptation-types.ts src/adaptation/proposal-store.ts src/adaptation/approval-gate.ts
```

Expected: No output (no changes to protected files).

- [ ] **Step 5: Final self-review checklist**

- [ ] No ADR-0004 protected types modified
- [ ] No new persistence (no store, no JSONL, no cache)
- [ ] All readiness decision table rows have test coverage
- [ ] All apply gate branches have test coverage
- [ ] Bridge status defaults to executive-bridge proposals only
- [ ] Bridge status supports `--json` and `--plan <planId>`
- [ ] `list` shows Readiness + Applyable columns
- [ ] `show` includes readiness block
- [ ] `apply` gates on readiness before calling selectApplier
- [ ] `manual_action` routing preserved (existing `printManualAction` still works)
- [ ] Full suite green, tsc clean, sentinel green

- [ ] **Step 6: Commit**

```bash
git add tests/executive/executive-sentinels.vitest.ts  # if changed
git commit -m "P10.9.2a-T4: sentinel verification + full suite green

- Full suite: N tests across M files, all green
- tsc —noEmit: clean
- Sentinel: N checks, all green
- No ADR-0004 protected files modified
- No new persistence added

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Summary of files changed

| File | Action | Purpose |
|---|---|---|
| `src/adaptation/proposal-readiness.ts` | **Create** | Pure types + `computeProposalReadiness()` + `getApplySupport()` + `isExecutiveBridgeProposal()` |
| `tests/adaptation/proposal-readiness.vitest.ts` | **Create** | 14 unit tests for all decision table rows + edge cases |
| `src/cli/commands/adaptation.ts` | **Modify** | `list` columns, `show` readiness block, `apply` readiness gate |
| `tests/cli/commands/adaptation-readiness.vitest.ts` | **Create** | 9 CLI integration tests for apply gate + list/show rendering |
| `src/cli/commands/executive-bridge-handler.ts` | **Modify** | Add `handleBridgeStatus()` + routing in `handleBridgeCommand()` |
| `tests/cli/commands/executive-bridge-status.vitest.ts` | **Create** | 6 tests for bridge status aggregation + filtering + JSON |
| `tests/executive/executive-sentinels.vitest.ts` | **Maybe modify** | If sentinel flags `proposal-readiness.ts` (unlikely — it's outside executive scope) |

**Not modified:** `adaptation-types.ts`, `proposal-store.ts`, `approval-gate.ts`, `executive-plan-types.ts`, or any ADR-0004 protected file.

## Execution options

**Plan complete and saved to `docs/architecture/plans/2026-06-29-p10-9-2a-proposal-readiness.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
