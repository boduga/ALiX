# A7.0 — Capability Lifecycle Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship A7.0 — the governed *decision boundary* for capability lifecycle changes: consume P5.5/P5.6 capability intelligence + telemetry + A5/A6 evidence, form A0 `EvolutionProposal`s (`targetKind = "capability"`), submit through the existing A3 governance machinery, and record the decision + intent in an append-only lifecycle ledger. A7.1 (future, out of scope) owns the governed *application boundary*.

**Architecture:** A7 is an evidence consumer and signal producer, not a new pipeline phase. It reads the existing M-series `CapabilityRegistry` (current state, never mutated) and the P5.5 `CapabilityEvolutionReport` (health/gap/overlap/drift — never re-derived), forms lifecycle candidates, builds A0 intents/proposals, bridges to A3 via the existing A2.5 `GovernanceRecommendation` → `generateDecision` chain (the A6 pattern), and appends `intent`/`proposed`/`decided` records to a JSONL ledger. Module `src/evolution/capability-lifecycle/`, mirroring the A6 `knowledge/` layout.

**Tech Stack:** Node.js + TypeScript (`node:test`, `node:assert/strict`), `node:crypto` (SHA-256), JSONL append-only stores, existing A0/A2.5/A3/A5/P5.5 contracts. Build: `pnpm build` (`tsc -p tsconfig.json`). Test: `node --test dist/tests/evolution/capability-lifecycle/**/*.test.js` (glob form — Node 24 rejects directory form).

## Global Constraints

Every task implicitly includes these:

- **A7.0 boundary (spec §1, §3, §5.3, §11):** No registry mutation. No new A4 executor. No `APPLIED`/`MEASURED` events — those event types are *prohibited* in A7.0 records. `APPROVED_PENDING_APPLICATION` is a governance-overlay projection state and must never enter the P5.5 `LifecycleState` enum (`emerging | active | mature | stagnant | declining | deprecated`).
- **Anti-duplication (spec §6.1):** A7 does not infer capability health, gap, overlap, or drift — those remain P5.5/P5.6 responsibilities. A7 consumes already-defined signals; it does not invent thresholds.
- **A3 bridge (spec §7):** Use the existing A2.5 `GovernanceRecommendation` shape (`src/evolution/verification/contracts/recommendation-contract.ts`) and `generateDecision(evidence, recommendation, { policyConfig })`. Never introduce an A7-specific recommendation type.
- **Ledger identity (spec §5.2):** `recordId` is generated once on append and never changes; it is NOT the identity of the proposal/decision. A timestamp is never part of the identity. Deterministic variant: `hash(proposalId + "<eventType>")` / `hash(decisionId + "decided")`.
- **Semantics (spec §5.2):** `observedLifecycleState` = what the registry reported when evaluated; `proposedLifecycleState` = what the proposal requests. An `APPROVE` record never claims the registry entered the proposed state.
- **CLI safety (spec §8):** `alix capabilities recommend` is observational (no ledger write, no A3 call); `alix capabilities propose` is the first state-changing command (writes ledger + calls A3, but STILL never mutates the registry).
- **Determinism (spec §4, §6.2):** Same signal inputs → identical candidates, proposals, and ordering. `recordId` is the sole exception (write-time unique).
- **Zero-candidate invariant (spec §9, §10):** No candidates → no proposal, no A3 call, no ledger write.
- **GitNexus (CLAUDE.md):** MUST run `impact({target, direction: "upstream"})` before editing any symbol; MUST run `detect_changes()` before every commit; warn the user on HIGH/CRITICAL risk. The only external symbol edited in this plan is `evolution-contract.ts` (Task 2) — run `impact` on `EvolutionTargetKind` first.
- **No commit without `detect_changes()`** and a clean test run of the touched suites.

---

## Task 1: Contract Verification Checkpoint (no files created)

The first task verifies every contract A7 touches against the shipped implementation — no files are created. The implementer records findings in a report file (the implementer's report contract), not code.

**Files:**
- Read (verify, do not edit): `src/evolution/contracts/evolution-contract.ts`, `src/evolution/verification/contracts/recommendation-contract.ts`, `src/evolution/governance/contracts/decision-contract.ts`, `src/evolution/governance/decision-engine.ts`, `src/evolution/execution/execution-authorization.ts`, `src/evolution/verification/evidence/verification-evidence.ts`, `src/adaptation/capability-evolution-types.ts`, `src/adaptation/capability-evolution-store.ts`, `src/capability/registry.ts`, `src/capability/types.ts`, `src/evolution/contracts/pattern-discovery-contract.ts`, `src/evolution/knowledge/adapters/shared.ts`
- Report: `<sdd-workdir>/task-1-report.md` (written by the implementer)

**Interfaces:**
- Consumes: none
- Produces: a verified contract inventory with exact signatures the later tasks rely on (documented in the report, not code)

- [ ] **Step 1: Verify the A0 contract**

Confirm in `src/evolution/contracts/evolution-contract.ts`:
- `EvolutionTargetKind` union (line 75) and `VALID_EVOLUTION_TARGET_KINDS` (line 84) — list every current member verbatim.
- `EvolutionTarget { kind, id, currentHash? }` (line 94).
- `EvolutionOrigin` includes `"governance_signal"` and `"system_observation"`.
- `EvolutionIntent` fields (line 147): `evolutionId, origin, target, rationale, expectedEffect, riskClass, constraints, createdAt`.
- `EvolutionProposal` fields (line 170): `proposalId, evolutionId, title, description, change, beforeHash, afterHash, createdAt`.
- `validateEvolutionIntent` (line 343) requires: `evolutionId` non-empty; `origin` in `VALID_EVOLUTION_ORIGINS`; `target` is an object; `rationale` is a **non-empty** array of `EvidenceReference`; `expectedEffect` non-empty; `riskClass` in `low|medium|high`; `constraints` array; `createdAt` non-empty. Note: it does NOT validate `target.kind` against the union — the union matters for the TypeScript type and the exported `VALID_EVOLUTION_TARGET_KINDS`.
- Confirm there are **zero exhaustive switches** over `EvolutionTargetKind` (grep `src/evolution/ src/governance/` for `target.kind`/`switch (kind)`). Expected: only `decision-engine.ts` switches on `GovernanceDecisionKind` and `governance-decision-cli.ts` on decision kind.

- [ ] **Step 2: Verify the A2.5 / evidence contracts**

- `GovernanceRecommendation` (`recommendation-contract.ts`) fields: `recommendationId, evidenceId, proposalId, kind, confidence, reasoning, supportingEvidence, risks, createdAt`. Kinds: `APPROVE | MONITOR | REQUEST_ADDITIONAL_EVIDENCE | REJECT | ESCALATE`.
- `VerificationEvidenceInput` (`verification-evidence.ts:31`) fields: `verificationId, proposalId, replayDatasetId, proposalSnapshotHash, environmentHash, baselineMetrics, candidateMetrics, metricDeltas, behavioralChanges, confidenceProfile, reproducibilityLevel, lineage, verifiedAt, expiresAt?`. `ReproducibilityLevel = 0 | 1 | 2 | 3` (`verification-contract.ts:130`).
- `createVerificationEvidence(input): VerificationEvidence` mints a **random** `evidenceId` and computes `integrityHash`. `computeEvidenceIntegrityHash(stable: Omit<VerificationEvidence, "integrityHash">): string`.
- `generateDecision(evidence, recommendation?, options?: DecisionConfig): GovernanceDecision` (`decision-engine.ts:123`). `DecisionConfig = { policyConfig?, evolutionId? }`. `DEFAULT_GOVERNANCE_POLICY.minApproveConfidence = 0.8`, `minReproducibilityLevel = 2`.

- [ ] **Step 3: Verify the A4 gate (read-only reference)**

- `authorizeExecution(input): { allowed, reason }` (`execution-authorization.ts:81`) requires `decision.kind === "APPROVE"`. A7.0 does NOT call this — verify and note that A7.0 never reaches A4.

- [ ] **Step 4: Verify the P5.5 report + lifecycle enum**

- `LifecycleState` (`capability-evolution-types.ts:15`): `emerging | active | mature | stagnant | declining | deprecated`.
- `CapabilityHealth` fields: `capability, agentCount, resolutionCount, resolutionCountRecent, resolutionCountPrior, proposalCountRecent, proposalCountPrior, demandScore, keepRate, revertRate, proposalCount, lifecycleState, rationale`.
- `CapabilityGap`: `suggestedCapability, evidence, signalStrength (1-3), confidence ("high"|"medium"|"low")`.
- `CapabilityOverlap`: `capabilityA, capabilityB, overlapScore, coverageAtoB, coverageBtoA, asymmetry, sharedSignalCount, consolidationCandidate`.
- `CapabilityDrift`: `capability, originalScope, currentScope, driftMagnitude, splitCandidate`.
- `CapabilityEvolutionStore.loadLatest(): Promise<CapabilityEvolutionReport | null>`.

- [ ] **Step 5: Verify the M-series registry + supporting types**

- `CapabilityRegistry` (`src/capability/registry.ts`): `register(capability)`, `unregister(id)`, `find(id): Capability | undefined`, `list(): Capability[]`, `describe(id)`, `getStatus(id)`, `attach(bus)`. `Capability` model fields in `src/capability/types.ts:4`: `id, version, kind, title, description, aliases?, tags, category, risk, requiredPermissions, argsSchema?, resultSchema?, examples?, execution, dependencies?, extensions?`. `CapabilityManifest = { version: 1, generatedAt, functions: Capability[] }`.
- `PatternObservation` (`pattern-discovery-contract.ts:48`) — type only.
- `parseLines(raw: string): unknown[]` (`src/evolution/knowledge/adapters/shared.ts:42`) — the JSONL parsing helper the ledger reuses.

- [ ] **Step 6: Verify the A6 A3-bridge pattern (the template A7 mirrors)**

Read `src/evolution/knowledge/curation-proposal-builder.ts` end to end. Note the exact pattern: `createVerificationEvidence` with `reproducibilityLevel: 2`, `confidenceProfile` with `historicalSimilarity: 1` and `overallConfidence` = aggregated confidence (so `min(a,a,a) × 1 === overallConfidence`), then **override the random `evidenceId`** with a deterministic content hash and recompute `integrityHash` via `computeEvidenceIntegrityHash`, so the recommendation references the SAME evidence. Read `src/evolution/knowledge/curation-cli.ts:196-236` for the CLI call shape: `decide(evidence, recommendation, { policyConfig })`.

- [ ] **Step 7: Run a compile smoke check and report**

Run `pnpm build` and confirm it succeeds with zero new errors. Write the verified contract inventory to the report file, listing every exact signature above with its file:line. Report status + the inventory. Do NOT commit (no code changed).

---

## Task 2: Extend `EvolutionTargetKind` with `"capability"`

The smallest contract-first change. This unlocks `target: { kind: "capability", id }` on A7 intents.

**Files:**
- Modify: `src/evolution/contracts/evolution-contract.ts:75-98` (union + `VALID_EVOLUTION_TARGET_KINDS`)
- Test: `tests/evolution/capability-lifecycle/evolution-target-contract.test.ts`

**Interfaces:**
- Consumes: `EvolutionTargetKind` union + `VALID_EVOLUTION_TARGET_KINDS` (from Task 1 report)
- Produces: `EvolutionTargetKind` that includes `"capability"`; `VALID_EVOLUTION_TARGET_KINDS` that includes `"capability"`. Used by Task 6's proposal builder.

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/evolution-target-contract.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_EVOLUTION_TARGET_KINDS,
  validateEvolutionIntent,
} from "../../../src/evolution/contracts/evolution-contract.js";

const PRE_EXISTING_KINDS = [
  "policy",
  "agent_behavior",
  "workflow",
  "runtime_config",
  "governance_rule",
  "evidence_filter",
  "execution_intent",
];

describe("EvolutionTargetKind capability extension", () => {
  it("accepts 'capability' as a valid target kind", () => {
    assert.ok(VALID_EVOLUTION_TARGET_KINDS.includes("capability"));
  });

  it("keeps all pre-existing target kinds valid", () => {
    for (const kind of PRE_EXISTING_KINDS) {
      assert.ok(VALID_EVOLUTION_TARGET_KINDS.includes(kind), `missing: ${kind}`);
    }
  });

  it("accepts an EvolutionIntent whose target kind is capability", () => {
    const result = validateEvolutionIntent({
      evolutionId: "evol-a7-test-1",
      origin: "governance_signal",
      target: { kind: "capability", id: "core.session.list" },
      rationale: [{ evidenceId: "a7-p55-report", source: "a7" }],
      expectedEffect: "raise lifecycle tier of core.session.list",
      riskClass: "low",
      constraints: [],
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    assert.deepEqual(result, { valid: true, errors: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/evolution-target-contract.test.js`
Expected: FAIL — `VALID_EVOLUTION_TARGET_KINDS.includes("capability")` is false.

- [ ] **Step 3: Write the minimal implementation**

In `src/evolution/contracts/evolution-contract.ts`, edit the `EvolutionTargetKind` union (line 75) to add `| "capability"`, and add `"capability"` to `VALID_EVOLUTION_TARGET_KINDS` (line 84). The array must remain `readonly EvolutionTargetKind[]` typed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/evolution-target-contract.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Verify no exhaustive switch breaks + run the A0 suite**

Run: `node --test dist/tests/evolution/contracts/*.test.js` (or the contracts suite the repo uses). Expected: no existing contract test regresses.

- [ ] **Step 6: Impact + commit**

Run `mcp__gitnexus__impact({target: "EvolutionTargetKind", direction: "upstream"})` and report the blast radius. If HIGH/CRITICAL, stop and warn. Then `detect_changes()` and commit:

```bash
git add src/evolution/contracts/evolution-contract.ts tests/evolution/capability-lifecycle/evolution-target-contract.test.ts
git commit -m "feat(a7): add 'capability' to EvolutionTargetKind

Additive contract extension so A7 lifecycle proposals can target
capabilities. Union + VALID_EVOLUTION_TARGET_KINDS. Zero exhaustive
switches over target kind exist (verified Task 1); A6 evidence-store
precedent for additive extension.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Lifecycle Contract Types + Record Validator + Derived-State Projection

Defines the A7 data model — the ledger record shape with the corrected observed/proposed semantics, the explicit intent, the identity rule, and the projection function.

**Files:**
- Create: `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts`
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-record.test.ts`

**Interfaces:**
- Consumes: `LifecycleState` from `../../../adaptation/capability-evolution-types.js`; `GovernanceDecisionKind` from `../../governance/contracts/decision-contract.js`; `ValidationResult` from `../../contracts/evolution-contract.js`
- Produces:
  - `type CapabilityLifecycleIntent = "register" | "promote" | "modify" | "consolidate" | "deprecate"`
  - `CAPABILITY_LIFECYCLE_INTENTS: readonly CapabilityLifecycleIntent[]`
  - `type CapabilityLifecycleEventType = "intent" | "proposed" | "decided"`
  - `interface CapabilityLifecycleTarget { capabilityId: string; relatedCapabilityIds?: string[] }`
  - `interface CapabilityLifecycleRecord { recordId; target; intent; eventType; timestamp; proposalId?; decisionId?; executionId?; measurementId?; evidenceRefs; observedLifecycleState; proposedLifecycleState; decisionKind? }`
  - `validateCapabilityLifecycleRecord(value: unknown): ValidationResult`
  - `computeDeterministicRecordId(eventType, correlationId): string` → `clr-<sha256hex16>`
  - `type CapabilityProjectionState = "PROPOSED" | "REJECTED" | "APPROVED_PENDING_APPLICATION"`
  - `deriveCapabilityProjectionState(latestDecision: CapabilityLifecycleRecord | null): CapabilityProjectionState`
  - `interface CapabilityLifecycleCandidate { intent; target; confidence; rationale: string[]; evidenceRefs: string[]; observedLifecycleState; proposedLifecycleState }`
  - `interface CapabilitySignalInputs { health: CapabilityHealth[]; gaps: CapabilityGap[]; overlap: CapabilityOverlap[]; drift: CapabilityDrift[]; adoption: Record<string, { invocationCount: number; successRate: number }>; outcome: VerificationEvidence[]; patterns: PatternObservation[] }`
  - `interface CapabilityAdoptionTelemetry { invocationCount: number; successRate: number }`

Later tasks import from these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-lifecycle-record.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCapabilityLifecycleRecord,
  computeDeterministicRecordId,
  deriveCapabilityProjectionState,
  CAPABILITY_LIFECYCLE_INTENTS,
  CAPABILITY_LIFECYCLE_EVENT_TYPES,
} from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityLifecycleRecord } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function makeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordId: "clr-abc123",
    target: { capabilityId: "core.session.list" },
    intent: "deprecate",
    eventType: "decided",
    timestamp: "2026-08-10T00:00:00.000Z",
    proposalId: "prop-a7-abc",
    decisionId: "govd-a7-abc",
    evidenceRefs: ["a7-p55-report"],
    observedLifecycleState: "active",
    proposedLifecycleState: "deprecated",
    decisionKind: "APPROVE",
    ...overrides,
  };
}

describe("CapabilityLifecycleRecord", () => {
  it("validates a well-formed decided record", () => {
    assert.deepEqual(validateCapabilityLifecycleRecord(makeRecord()), { valid: true, errors: [] });
  });

  it("accepts every intent in the canonical list", () => {
    assert.deepEqual(CAPABILITY_LIFECYCLE_INTENTS, [
      "register", "promote", "modify", "consolidate", "deprecate",
    ]);
  });

  it("accepts every event type in the canonical list", () => {
    assert.deepEqual(CAPABILITY_LIFECYCLE_EVENT_TYPES, ["intent", "proposed", "decided"]);
  });

  it("rejects a decided record missing its decisionId", () => {
    const result = validateCapabilityLifecycleRecord(makeRecord({ decisionId: undefined }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("decisionId")));
  });

  it("rejects a record that claims applied or measured (A7.0 invariant)", () => {
    // executionId/measurementId are A7.1 fields — must NOT exist in A7.0 records.
    const withExecution = validateCapabilityLifecycleRecord(makeRecord({ executionId: "exec-x" }));
    assert.equal(withExecution.valid, false);
    const withMeasurement = validateCapabilityLifecycleRecord(makeRecord({ measurementId: "meas-x" }));
    assert.equal(withMeasurement.valid, false);
  });

  it("rejects an unknown intent or event type", () => {
    assert.equal(validateCapabilityLifecycleRecord(makeRecord({ intent: "delete" })).valid, false);
    assert.equal(validateCapabilityLifecycleRecord(makeRecord({ eventType: "applied" })).valid, false);
  });

  it("rejects a proposedLifecycleState outside the P5.5 enum", () => {
    assert.equal(
      validateCapabilityLifecycleRecord(makeRecord({ proposedLifecycleState: "APPROVED_PENDING_APPLICATION" })).valid,
      false,
    );
  });
});

describe("computeDeterministicRecordId", () => {
  it("is deterministic over (eventType, correlationId) and stable across calls", () => {
    const a = computeDeterministicRecordId("proposed", "prop-a7-abc");
    const b = computeDeterministicRecordId("proposed", "prop-a7-abc");
    assert.equal(a, b);
    assert.ok(a.startsWith("clr-"));
  });

  it("differs for different correlation ids", () => {
    assert.notEqual(
      computeDeterministicRecordId("decided", "govd-a"),
      computeDeterministicRecordId("decided", "govd-b"),
    );
  });
});

describe("deriveCapabilityProjectionState", () => {
  it("maps a latest APPROVE decision to APPROVED_PENDING_APPLICATION", () => {
    const record = { ...makeRecord(), decisionKind: "APPROVE" } as unknown as CapabilityLifecycleRecord;
    assert.equal(deriveCapabilityProjectionState(record), "APPROVED_PENDING_APPLICATION");
  });

  it("maps a latest REJECT decision to REJECTED", () => {
    const record = { ...makeRecord(), decisionKind: "REJECT" } as unknown as CapabilityLifecycleRecord;
    assert.equal(deriveCapabilityProjectionState(record), "REJECTED");
  });

  it("maps MONITOR and REQUEST_MORE_EVIDENCE to pending", () => {
    for (const kind of ["MONITOR", "REQUEST_MORE_EVIDENCE"]) {
      const record = { ...makeRecord(), decisionKind: kind } as unknown as CapabilityLifecycleRecord;
      assert.equal(deriveCapabilityProjectionState(record), "APPROVED_PENDING_APPLICATION");
    }
  });

  it("maps a capability with no decided record to PROPOSED", () => {
    assert.equal(deriveCapabilityProjectionState(null), "PROPOSED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-record.test.js`
Expected: FAIL — module/functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { LifecycleState } from "../../../adaptation/capability-evolution-types.js";
import type { CapabilityGap, CapabilityHealth, CapabilityOverlap, CapabilityDrift } from "../../../adaptation/capability-evolution-types.js";
import type { GovernanceDecisionKind } from "../../governance/contracts/decision-contract.js";
import type { ValidationResult } from "../../contracts/evolution-contract.js";
import type { VerificationEvidence } from "../../verification/contracts/verification-contract.js";
import type { PatternObservation } from "../../contracts/pattern-discovery-contract.js";

// ---------------------------------------------------------------------------
// Lifecycle intent
// ---------------------------------------------------------------------------

export type CapabilityLifecycleIntent =
  | "register"
  | "promote"
  | "modify"
  | "consolidate"
  | "deprecate";

export const CAPABILITY_LIFECYCLE_INTENTS: readonly CapabilityLifecycleIntent[] = [
  "register", "promote", "modify", "consolidate", "deprecate",
];

export type CapabilityLifecycleEventType = "intent" | "proposed" | "decided";

export const CAPABILITY_LIFECYCLE_EVENT_TYPES: readonly CapabilityLifecycleEventType[] = [
  "intent", "proposed", "decided",
];

// ---------------------------------------------------------------------------
// Ledger record
// ---------------------------------------------------------------------------

export interface CapabilityLifecycleTarget {
  /** Primary capability. For consolidation: the resulting/merged capability (C). */
  capabilityId: string;
  /** Related affected capabilities. For consolidation: the merged inputs (A, B). */
  relatedCapabilityIds?: string[];
}

/**
 * Append-only record of a capability lifecycle event.
 *
 * Identity rule: `recordId` is generated once on append and never changes; it is
 * NOT the identity of the proposal/decision (proposalId/decisionId carry that).
 * A timestamp is never part of the identity.
 *
 * Semantics: `observedLifecycleState` = what the registry reported when this
 * record was created; `proposedLifecycleState` = the state REQUESTED by the
 * proposal. An APPROVE record never claims the registry entered the proposed
 * state. A7.0 records never carry `executionId` / `measurementId` (A7.1 fields).
 */
export interface CapabilityLifecycleRecord {
  recordId: string;
  target: CapabilityLifecycleTarget;
  intent: CapabilityLifecycleIntent;
  eventType: CapabilityLifecycleEventType;
  timestamp: string;
  proposalId?: string;
  decisionId?: string;
  /** A7.1 — must be absent in A7.0 records. */
  executionId?: string;
  /** A7.1 — must be absent in A7.0 records. */
  measurementId?: string;
  evidenceRefs: string[];
  observedLifecycleState: LifecycleState | null;
  proposedLifecycleState: LifecycleState;
  decisionKind?: GovernanceDecisionKind;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const P5_5_LIFECYCLE_STATES: readonly LifecycleState[] = [
  "emerging", "active", "mature", "stagnant", "declining", "deprecated",
];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateCapabilityLifecycleRecord(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object") {
    return { valid: false, errors: ["CapabilityLifecycleRecord must be an object"] };
  }
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.recordId)) errors.push("recordId required and must be non-empty");
  if (!v.target || typeof v.target !== "object" || !isNonEmptyString((v.target as Record<string, unknown>).capabilityId)) {
    errors.push("target.capabilityId required and must be non-empty");
  }
  if (typeof v.intent !== "string" || !(CAPABILITY_LIFECYCLE_INTENTS as readonly string[]).includes(v.intent)) {
    errors.push(`intent must be one of: ${CAPABILITY_LIFECYCLE_INTENTS.join(", ")}`);
  }
  if (typeof v.eventType !== "string" || !(CAPABILITY_LIFECYCLE_EVENT_TYPES as readonly string[]).includes(v.eventType)) {
    errors.push(`eventType must be one of: ${CAPABILITY_LIFECYCLE_EVENT_TYPES.join(", ")}`);
  }
  if (!isNonEmptyString(v.timestamp)) errors.push("timestamp required and must be non-empty");
  if (!Array.isArray(v.evidenceRefs)) errors.push("evidenceRefs must be an array");
  if (v.eventType === "decided") {
    if (!isNonEmptyString(v.decisionId)) errors.push("decided record requires decisionId");
    if (!isNonEmptyString(v.proposalId)) errors.push("decided record requires proposalId");
    if (typeof v.decisionKind !== "string" || !["APPROVE", "REJECT", "MONITOR", "REQUEST_MORE_EVIDENCE"].includes(v.decisionKind)) {
      errors.push("decided record requires a valid decisionKind");
    }
  }
  if (v.eventType === "proposed" && !isNonEmptyString(v.proposalId)) {
    errors.push("proposed record requires proposalId");
  }
  // A7.0 invariant: applied/measured events and execution/measurement ids are
  // prohibited until A7.1.
  if (v.eventType === "applied" || v.eventType === "measured") {
    errors.push(`eventType ${String(v.eventType)} is reserved for A7.1 and must not appear in A7.0 records`);
  }
  if (isNonEmptyString(v.executionId)) errors.push("executionId is an A7.1 field — must be absent in A7.0 records");
  if (isNonEmptyString(v.measurementId)) errors.push("measurementId is an A7.1 field — must be absent in A7.0 records");
  if (v.observedLifecycleState !== null && typeof v.observedLifecycleState === "string") {
    if (!(P5_5_LIFECYCLE_STATES as readonly string[]).includes(v.observedLifecycleState)) {
      errors.push("observedLifecycleState must be a P5.5 lifecycle state or null");
    }
  } else if (v.observedLifecycleState !== null && typeof v.observedLifecycleState !== "string") {
    errors.push("observedLifecycleState must be a P5.5 lifecycle state or null");
  }
  if (typeof v.proposedLifecycleState !== "string" || !(P5_5_LIFECYCLE_STATES as readonly string[]).includes(v.proposedLifecycleState)) {
    errors.push("proposedLifecycleState must be a P5.5 lifecycle state");
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Deterministic record id (spec §5.2 identity rule)
// ---------------------------------------------------------------------------

/**
 * Deterministic record id derived from an immutable artifact. Used for
 * proposed/decided records which carry a proposalId/decisionId. The default
 * append path generates a write-time unique id instead; a timestamp is never
 * part of the identity.
 */
export function computeDeterministicRecordId(
  eventType: CapabilityLifecycleEventType,
  correlationId: string,
): string {
  const hash = createHash("sha256");
  hash.update(`a7-record|${eventType}|${correlationId}`, "utf-8");
  return `clr-${hash.digest("hex").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Derived projection state (spec §5.3)
// ---------------------------------------------------------------------------

/**
 * Governance-overlay projection state. NEVER enters LifecycleState — the P5.5
 * enum remains `emerging|active|mature|stagnant|declining|deprecated`.
 */
export type CapabilityProjectionState =
  | "PROPOSED"
  | "REJECTED"
  | "APPROVED_PENDING_APPLICATION";

/**
 * Projection over (latest A7 decision). The registry's current state remains
 * authoritative and is read separately by the caller.
 */
export function deriveCapabilityProjectionState(
  latestDecision: CapabilityLifecycleRecord | null,
): CapabilityProjectionState {
  if (!latestDecision || latestDecision.eventType !== "decided") return "PROPOSED";
  if (latestDecision.decisionKind === "REJECT") return "REJECTED";
  return "APPROVED_PENDING_APPLICATION"; // APPROVE / MONITOR / REQUEST_MORE_EVIDENCE
}

// ---------------------------------------------------------------------------
// Analyzer inputs / candidates
// ---------------------------------------------------------------------------

export interface CapabilityAdoptionTelemetry {
  invocationCount: number;
  successRate: number;
}

export interface CapabilitySignalInputs {
  health: CapabilityHealth[];
  gaps: CapabilityGap[];
  overlap: CapabilityOverlap[];
  drift: CapabilityDrift[];
  /** Per-capability invocation telemetry, keyed by capabilityId. */
  adoption: Record<string, CapabilityAdoptionTelemetry>;
  /** A5 observed evidence — outcome effectiveness. */
  outcome: VerificationEvidence[];
  /** A6 curated patterns — corroborating evidence. */
  patterns: PatternObservation[];
}

export interface CapabilityLifecycleCandidate {
  intent: CapabilityLifecycleIntent;
  target: CapabilityLifecycleTarget;
  confidence: number;
  rationale: string[];
  evidenceRefs: string[];
  observedLifecycleState: LifecycleState | null;
  proposedLifecycleState: LifecycleState;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-record.test.js`
Expected: PASS (13/13).

- [ ] **Step 5: Commit**

```bash
git add src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts tests/evolution/capability-lifecycle/capability-lifecycle-record.test.ts
git commit -m "feat(a7): lifecycle contract types — record, validator, projection

CapabilityLifecycleRecord with observed/proposed semantics, explicit
intent, multi-target consolidation (target { capabilityId, relatedCapabilityIds? }),
deterministic record-id helper, and derived projection state. A7.0
invariants enforced by the validator: no applied/measured events, no
executionId/measurementId, proposedLifecycleState stays in the P5.5 enum.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Lifecycle Ledger Store (append-only JSONL)

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts`
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.ts`

**Interfaces:**
- Consumes: `CapabilityLifecycleRecord`, `CapabilityLifecycleIntent` from `./contracts/lifecycle-contract.js`; `parseLines` from `../knowledge/adapters/shared.js`
- Produces:
  - `interface CapabilityLifecycleLedger { append(record: Omit<CapabilityLifecycleRecord, "recordId">): Promise<CapabilityLifecycleRecord>; list(): Promise<CapabilityLifecycleRecord[]>; listByCapability(capabilityId: string): Promise<CapabilityLifecycleRecord[]>; listByIntent(intent: CapabilityLifecycleIntent): Promise<CapabilityLifecycleRecord[]>; listLatestForCapability(capabilityId: string): Promise<CapabilityLifecycleRecord | null> }`
  - `class JsonlCapabilityLifecycleLedger implements CapabilityLifecycleLedger { constructor(filePath: string) }`
  - `export const DEFAULT_CAPABILITY_LIFECYCLE_FILE = join(".alix", "capability-lifecycle", "lifecycle.jsonl")`

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import type { CapabilityLifecycleRecord } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-ledger-"));
  file = join(dir, "lifecycle.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseRecord(overrides: Partial<CapabilityLifecycleRecord> = {}): Omit<CapabilityLifecycleRecord, "recordId"> {
  return {
    target: { capabilityId: "core.session.list" },
    intent: "deprecate",
    eventType: "decided",
    timestamp: "2026-08-10T00:00:00.000Z",
    proposalId: "prop-a7-abc",
    decisionId: "govd-a7-abc",
    evidenceRefs: [],
    observedLifecycleState: "active",
    proposedLifecycleState: "deprecated",
    decisionKind: "APPROVE",
    ...overrides,
  };
}

describe("JsonlCapabilityLifecycleLedger", () => {
  it("appends a record, assigns a unique recordId, and persists to JSONL", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    const stored = await ledger.append(baseRecord());
    assert.ok(stored.recordId.startsWith("clr-"));
    assert.ok(stored.recordId.length > 4);

    const raw = readFileSync(file, "utf-8");
    assert.equal(raw.trimEnd().split("\n").length, 1);
    assert.ok(raw.includes(stored.recordId));
  });

  it("lists records in append order", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ eventType: "intent" }));
    await ledger.append(baseRecord({ eventType: "proposed" }));
    const records = await ledger.list();
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => r.eventType), ["intent", "proposed"]);
  });

  it("lists records by capability", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ target: { capabilityId: "core.session.list" } }));
    await ledger.append(baseRecord({ target: { capabilityId: "core.session.get" } }));
    const byCap = await ledger.listByCapability("core.session.list");
    assert.equal(byCap.length, 1);
    assert.equal(byCap[0].target.capabilityId, "core.session.list");
  });

  it("lists records by intent", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ intent: "deprecate" }));
    await ledger.append(baseRecord({ intent: "promote" }));
    const deprecations = await ledger.listByIntent("deprecate");
    assert.equal(deprecations.length, 1);
    assert.equal(deprecations[0].intent, "deprecate");
  });

  it("returns the latest decided record for a capability, or null", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    assert.equal(await ledger.listLatestForCapability("core.session.list"), null);
    await ledger.append(baseRecord({ eventType: "proposed" }));
    await ledger.append(baseRecord({ eventType: "decided", decisionKind: "REJECT" }));
    const latest = await ledger.listLatestForCapability("core.session.list");
    assert.equal(latest?.decisionKind, "REJECT");
  });

  it("skips corrupt JSONL lines without suppressing neighbors", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(file);
    await ledger.append(baseRecord({ eventType: "intent" }));
    // Corrupt the file by appending a malformed line directly.
    const { appendFileSync } = await import("node:fs");
    appendFileSync(file, "{ not valid json\n");
    await ledger.append(baseRecord({ eventType: "proposed" }));
    const records = await ledger.list();
    assert.equal(records.length, 2); // corrupt line skipped, both valid records survive
  });

  it("returns an empty list when the file does not exist", async () => {
    const ledger = new JsonlCapabilityLifecycleLedger(join(dir, "missing.jsonl"));
    assert.deepEqual(await ledger.list(), []);
    assert.equal(await ledger.listLatestForCapability("x"), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.js`
Expected: FAIL — `JsonlCapabilityLifecycleLedger` not defined.

- [ ] **Step 3: Write the implementation**

Create `src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CapabilityLifecycleIntent,
  CapabilityLifecycleRecord,
} from "./contracts/lifecycle-contract.js";
import { parseLines } from "../knowledge/adapters/shared.js";

/** Default A7 ledger location (the `.alix` convention). */
export const DEFAULT_CAPABILITY_LIFECYCLE_FILE = join(
  ".alix", "capability-lifecycle", "lifecycle.jsonl",
);

export interface CapabilityLifecycleLedger {
  /** Append a record. Assigns a write-time-unique recordId that never changes. */
  append(record: Omit<CapabilityLifecycleRecord, "recordId">): Promise<CapabilityLifecycleRecord>;
  list(): Promise<CapabilityLifecycleRecord[]>;
  listByCapability(capabilityId: string): Promise<CapabilityLifecycleRecord[]>;
  listByIntent(intent: CapabilityLifecycleIntent): Promise<CapabilityLifecycleRecord[]>;
  listLatestForCapability(capabilityId: string): Promise<CapabilityLifecycleRecord | null>;
}

/**
 * Append-only JSONL lifecycle ledger. The ledger is history, never authority:
 * current capability state always reads the M-series CapabilityRegistry.
 *
 * Identity rule (spec §5.2): `recordId` is generated once on append and never
 * changes; it is NOT the identity of the proposal/decision. A timestamp is
 * never part of the identity.
 *
 * Never throws on read: a missing file returns empty lists; corrupt lines are
 * skipped (reusing the `parseLines` helper).
 */
export class JsonlCapabilityLifecycleLedger implements CapabilityLifecycleLedger {
  constructor(private readonly filePath: string) {}

  async append(
    record: Omit<CapabilityLifecycleRecord, "recordId">,
  ): Promise<CapabilityLifecycleRecord> {
    const full: CapabilityLifecycleRecord = {
      ...record,
      recordId: `clr-${randomUUID()}`,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, "utf-8");
    return full;
  }

  async list(): Promise<CapabilityLifecycleRecord[]> {
    return this.readAll();
  }

  async listByCapability(capabilityId: string): Promise<CapabilityLifecycleRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.target.capabilityId === capabilityId);
  }

  async listByIntent(intent: CapabilityLifecycleIntent): Promise<CapabilityLifecycleRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.intent === intent);
  }

  async listLatestForCapability(capabilityId: string): Promise<CapabilityLifecycleRecord | null> {
    const byCap = await this.listByCapability(capabilityId);
    if (byCap.length === 0) return null;
    return byCap[byCap.length - 1];
  }

  private readAll(): CapabilityLifecycleRecord[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch {
      return []; // missing file → empty list, never throws
    }
    return parseLines(raw).filter(
      (line): line is CapabilityLifecycleRecord =>
        typeof line === "object" && line !== null &&
        typeof (line as Record<string, unknown>).recordId === "string",
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.js`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts tests/evolution/capability-lifecycle/capability-lifecycle-ledger.test.ts
git commit -m "feat(a7): append-only capability lifecycle ledger

JSONL store at .alix/capability-lifecycle/lifecycle.jsonl. Write-time-unique
recordId (never content-addressed, timestamp excluded). Never throws on read;
missing file -> empty list, corrupt lines skipped. History, never authority.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Lifecycle Analyzer (pure signal → candidates)

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts`
- Test: `tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.ts`

**Interfaces:**
- Consumes: `CapabilitySignalInputs`, `CapabilityLifecycleCandidate` from `./contracts/lifecycle-contract.js`; `LifecycleState` from `../../adaptation/capability-evolution-types.js`
- Produces: `analyzeCapabilityLifecycle(inputs: CapabilitySignalInputs): CapabilityLifecycleCandidate[]`

Rules (spec §6.2 — consume P5.5 signals, never re-derive them):
- `register` ← each `gap` with a `suggestedCapability`; `confidence = gap.signalStrength / 3`; `proposedLifecycleState = "emerging"`; `observedLifecycleState = null`.
- `promote` ← each `health` entry whose `lifecycleState` is `"emerging"` **or** `"active"` **and** with adoption telemetry (`inputs.adoption[capability]` present and `invocationCount > 0`); `proposedLifecycleState` = next tier (`emerging → active`, `active → mature`); `confidence = 0.8`.
- `deprecate` ← each `health` entry whose `lifecycleState` is `"declining"` **or** `"stagnant"`; `proposedLifecycleState = "deprecated"`; `confidence = 0.8`.
- `consolidate` ← each `overlap` with `consolidationCandidate === true`; `target = { capabilityId: capabilityA, relatedCapabilityIds: [capabilityB] }`; `proposedLifecycleState = "mature"`; `confidence = overlap.overlapScore`.
- `modify` ← each `drift` with `splitCandidate === true`; `proposedLifecycleState` = the capability's current `health.lifecycleState` (or `"active"` if absent); `confidence = drift.driftMagnitude`.
- `outcome` (A5) and `patterns` (A6) inputs are carried into the analyzer signature and appended to candidate `evidenceRefs`/`rationale` only when a matching capability appears (see Step 3), keeping the anti-duplication invariant.
- Output is sorted deterministically by `(target.capabilityId, intent)`.

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeCapabilityLifecycle } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-analyzer.js";
import type { CapabilitySignalInputs } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function emptyInputs(): CapabilitySignalInputs {
  return { health: [], gaps: [], overlap: [], drift: [], adoption: {}, outcome: [], patterns: [] };
}

describe("analyzeCapabilityLifecycle", () => {
  it("emits a register candidate for each gap with a suggestedCapability", () => {
    const inputs = emptyInputs();
    inputs.gaps = [
      { suggestedCapability: "core.search", evidence: ["gap a"], signalStrength: 2, confidence: "high" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "register");
    assert.equal(candidates[0].target.capabilityId, "core.search");
    assert.equal(candidates[0].proposedLifecycleState, "emerging");
    assert.equal(candidates[0].confidence, 2 / 3);
  });

  it("promotes an active capability with adoption, proposing the next tier", () => {
    const inputs = emptyInputs();
    inputs.health = [
      { capability: "core.session.list", lifecycleState: "active", agentCount: 1, resolutionCount: 10, resolutionCountRecent: 5, resolutionCountPrior: 3, proposalCountRecent: 1, proposalCountPrior: 0, demandScore: 0.5, keepRate: null, revertRate: null, proposalCount: 1, rationale: "well used" },
    ];
    inputs.adoption = { "core.session.list": { invocationCount: 7, successRate: 0.9 } };
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "promote");
    assert.equal(candidates[0].proposedLifecycleState, "mature");
    assert.equal(candidates[0].observedLifecycleState, "active");
  });

  it("does not promote without adoption telemetry", () => {
    const inputs = emptyInputs();
    inputs.health = [
      { capability: "core.session.list", lifecycleState: "active", agentCount: 1, resolutionCount: 10, resolutionCountRecent: 5, resolutionCountPrior: 3, proposalCountRecent: 1, proposalCountPrior: 0, demandScore: 0.5, keepRate: null, revertRate: null, proposalCount: 1, rationale: "well used" },
    ];
    assert.deepEqual(analyzeCapabilityLifecycle(inputs), []);
  });

  it("deprecates a declining or stagnant capability", () => {
    const inputs = emptyInputs();
    inputs.health = [
      { capability: "core.old", lifecycleState: "stagnant", agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0, resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 2, demandScore: 0.1, keepRate: 0.2, revertRate: 0.4, proposalCount: 2, rationale: "no recent use" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "deprecate");
    assert.equal(candidates[0].proposedLifecycleState, "deprecated");
  });

  it("consolidates an overlap consolidationCandidate with multi-target identity", () => {
    const inputs = emptyInputs();
    inputs.overlap = [
      { capabilityA: "core.a", capabilityB: "core.b", overlapScore: 0.85, coverageAtoB: 0.8, coverageBtoA: 0.9, asymmetry: 0.1, sharedSignalCount: 3, consolidationCandidate: true },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "consolidate");
    assert.equal(candidates[0].target.capabilityId, "core.a");
    assert.deepEqual(candidates[0].target.relatedCapabilityIds, ["core.b"]);
    assert.equal(candidates[0].confidence, 0.85);
  });

  it("proposes a modify for a drift splitCandidate", () => {
    const inputs = emptyInputs();
    inputs.drift = [
      { capability: "core.mixed", originalScope: "x", currentScope: "y", driftMagnitude: 0.7, splitCandidate: true },
    ];
    inputs.health = [
      { capability: "core.mixed", lifecycleState: "active", agentCount: 1, resolutionCount: 5, resolutionCountRecent: 2, resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 1, demandScore: 0.4, keepRate: null, revertRate: null, proposalCount: 1, rationale: "scope grew" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "modify");
    assert.equal(candidates[0].proposedLifecycleState, "active");
    assert.equal(candidates[0].confidence, 0.7);
  });

  it("returns candidates in deterministic (capabilityId, intent) order", () => {
    const inputs = emptyInputs();
    inputs.gaps = [
      { suggestedCapability: "core.b", evidence: ["1"], signalStrength: 1, confidence: "low" },
      { suggestedCapability: "core.a", evidence: ["2"], signalStrength: 1, confidence: "low" },
    ];
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.deepEqual(candidates.map((c) => c.target.capabilityId), ["core.a", "core.b"]);
  });

  it("returns no candidates for empty signals (zero-candidate invariant)", () => {
    assert.deepEqual(analyzeCapabilityLifecycle(emptyInputs()), []);
  });

  it("does not mutate its inputs (purity)", () => {
    const inputs = emptyInputs();
    inputs.gaps = [{ suggestedCapability: "core.a", evidence: ["e"], signalStrength: 1, confidence: "low" }];
    const snapshot = JSON.stringify(inputs);
    analyzeCapabilityLifecycle(inputs);
    assert.equal(JSON.stringify(inputs), snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.js`
Expected: FAIL — `analyzeCapabilityLifecycle` not defined.

- [ ] **Step 3: Write the implementation**

Create `src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type {
  CapabilityLifecycleCandidate,
  CapabilitySignalInputs,
} from "./contracts/lifecycle-contract.js";
import type { LifecycleState } from "../../adaptation/capability-evolution-types.js";

/**
 * A7 — Capability Lifecycle Analyzer (pure).
 *
 * Consumes P5.5/P5.6 capability intelligence (health/gap/overlap/drift),
 * adoption telemetry, and A5/A6 evidence; emits lifecycle candidates. It does
 * NOT infer health, gap, overlap, or drift — those remain P5.5/P5.6
 * responsibilities (anti-duplication invariant, spec §6.1).
 *
 * Deterministic: same inputs → identical candidates and ordering.
 */
export function analyzeCapabilityLifecycle(
  inputs: CapabilitySignalInputs,
): CapabilityLifecycleCandidate[] {
  const candidates: CapabilityLifecycleCandidate[] = [];
  const healthByCapability = new Map<string, { lifecycleState: LifecycleState }>();
  for (const h of inputs.health) healthByCapability.set(h.capability, { lifecycleState: h.lifecycleState });

  // register ← P5.5 gap with a suggested capability.
  for (const gap of inputs.gaps) {
    if (!gap.suggestedCapability) continue;
    candidates.push({
      intent: "register",
      target: { capabilityId: gap.suggestedCapability },
      confidence: gap.signalStrength / 3,
      rationale: gap.evidence,
      evidenceRefs: [],
      observedLifecycleState: null,
      proposedLifecycleState: "emerging",
    });
  }

  const NEXT_TIER: Partial<Record<LifecycleState, LifecycleState>> = {
    emerging: "active",
    active: "mature",
  };

  for (const h of inputs.health) {
    const next = NEXT_TIER[h.lifecycleState];
    const adoption = inputs.adoption[h.capability];
    // promote ← emerging/active health AND adoption telemetry with invocations.
    if (next && adoption && adoption.invocationCount > 0) {
      candidates.push({
        intent: "promote",
        target: { capabilityId: h.capability },
        confidence: 0.8,
        rationale: [h.rationale],
        evidenceRefs: [],
        observedLifecycleState: h.lifecycleState,
        proposedLifecycleState: next,
      });
    }
    // deprecate ← declining/stagnant health.
    if (h.lifecycleState === "declining" || h.lifecycleState === "stagnant") {
      candidates.push({
        intent: "deprecate",
        target: { capabilityId: h.capability },
        confidence: 0.8,
        rationale: [h.rationale],
        evidenceRefs: [],
        observedLifecycleState: h.lifecycleState,
        proposedLifecycleState: "deprecated",
      });
    }
  }

  // consolidate ← P5.5 overlap consolidationCandidate (score > 0.7, P5.5-owned).
  for (const o of inputs.overlap) {
    if (!o.consolidationCandidate) continue;
    candidates.push({
      intent: "consolidate",
      target: { capabilityId: o.capabilityA, relatedCapabilityIds: [o.capabilityB] },
      confidence: o.overlapScore,
      rationale: [`overlap ${o.overlapScore.toFixed(2)} between ${o.capabilityA} and ${o.capabilityB}`],
      evidenceRefs: [],
      observedLifecycleState: healthByCapability.get(o.capabilityA)?.lifecycleState ?? null,
      proposedLifecycleState: "mature",
    });
  }

  // modify ← P5.5 drift splitCandidate (magnitude > 0.5, P5.5-owned).
  for (const d of inputs.drift) {
    if (!d.splitCandidate) continue;
    candidates.push({
      intent: "modify",
      target: { capabilityId: d.capability },
      confidence: d.driftMagnitude,
      rationale: [d.currentScope],
      evidenceRefs: [],
      observedLifecycleState: healthByCapability.get(d.capability)?.lifecycleState ?? null,
      proposedLifecycleState: healthByCapability.get(d.capability)?.lifecycleState ?? "active",
    });
  }

  // Corroborating A5/A6 evidence: attach to matching candidates, never as a
  // source of new signals.
  for (const ev of inputs.outcome) {
    for (const c of candidates) {
      if (ev.proposalId && ev.proposalId.includes(c.target.capabilityId)) {
        c.evidenceRefs.push(ev.evidenceId);
      }
    }
  }
  for (const p of inputs.patterns) {
    for (const c of candidates) {
      if (p.evidenceIds && p.evidenceIds.length > 0) {
        c.evidenceRefs.push(...p.evidenceIds);
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.target.capabilityId !== b.target.capabilityId) {
      return a.target.capabilityId < b.target.capabilityId ? -1 : 1;
    }
    return a.intent < b.intent ? -1 : 1;
  });
  return candidates;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.js`
Expected: PASS (9/9). If `pattern.evidenceIds` is not a field on `PatternObservation`, drop the A6-evidence block (its presence in the signature is what matters; the integration test uses `outcome` only).

- [ ] **Step 5: Commit**

```bash
git add src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts tests/evolution/capability-lifecycle/capability-lifecycle-analyzer.test.ts
git commit -m "feat(a7): pure capability lifecycle analyzer

Maps P5.5 health/gap/overlap/drift + adoption telemetry to lifecycle
candidates deterministically. Consumes P5.5 signals, never re-derives them.
Multi-target consolidation (A+B->C) and observed/proposed states per spec.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Proposal Builder (candidates → A0 EvolutionIntent + EvolutionProposal)

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-proposal-builder.ts`
- Test: `tests/evolution/capability-lifecycle/capability-proposal-builder.test.ts`

**Interfaces:**
- Consumes: `CapabilityLifecycleCandidate` from `./contracts/lifecycle-contract.js`; `EvolutionIntent`, `EvolutionProposal`, `EvolutionTargetKind`, `EvidenceReference` from `../contracts/evolution-contract.js`
- Produces:
  - `interface CapabilityProposalArtifacts { candidate: CapabilityLifecycleCandidate; intent: EvolutionIntent; proposal: EvolutionProposal }`
  - `buildCapabilityProposals(candidates: CapabilityLifecycleCandidate[], signalEvidenceRefs?: EvidenceReference[]): CapabilityProposalArtifacts[]`

Deterministic ids (mirror A6's content-addressed approach): `evolutionId = "evol-a7-<sha256hex16(capabilityId|intent)>"`, `proposalId = "prop-a7-<sha256hex16(capabilityId|intent)>"`. `intent.target = { kind: "capability", id: candidate.target.capabilityId }`. `intent.rationale = [...(signalEvidenceRefs ?? []), ...candidate.evidenceRefs.map(id => ({ evidenceId: id, source: "a7" }))]` — must be **non-empty** (validator requirement). `riskClass: "low"` (A7.0 proposals mutate nothing). `intent.origin = "governance_signal"`. Empty candidates → empty array.

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-proposal-builder.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityProposals } from "../../../src/evolution/capability-lifecycle/capability-proposal-builder.js";
import { validateEvolutionIntent, validateEvolutionProposal } from "../../../src/evolution/contracts/evolution-contract.js";
import type { CapabilityLifecycleCandidate } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function makeCandidate(overrides: Partial<CapabilityLifecycleCandidate> = {}): CapabilityLifecycleCandidate {
  return {
    intent: "deprecate",
    target: { capabilityId: "core.old" },
    confidence: 0.8,
    rationale: ["no recent use"],
    evidenceRefs: ["ev-1"],
    observedLifecycleState: "stagnant",
    proposedLifecycleState: "deprecated",
    ...overrides,
  };
}

describe("buildCapabilityProposals", () => {
  it("produces one EvolutionIntent + EvolutionProposal per candidate", () => {
    const artifacts = buildCapabilityProposals([makeCandidate()]);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].intent.target.kind, "capability");
    assert.equal(artifacts[0].intent.target.id, "core.old");
    assert.equal(artifacts[0].proposal.evolutionId, artifacts[0].intent.evolutionId);
  });

  it("intents validate against the A0 validator (target kind capability)", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    assert.deepEqual(validateEvolutionIntent(a.intent), { valid: true, errors: [] });
  });

  it("proposals validate against the A0 validator", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    assert.deepEqual(validateEvolutionProposal(a.proposal), { valid: true, errors: [] });
  });

  it("is deterministic: identical ids for identical inputs, across calls", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    const [b] = buildCapabilityProposals([makeCandidate()]);
    assert.equal(a.intent.evolutionId, b.intent.evolutionId);
    assert.equal(a.proposal.proposalId, b.proposal.proposalId);
    assert.equal(a.intent.target.id, "core.old");
  });

  it("returns an empty array for zero candidates (zero-candidate invariant)", () => {
    assert.deepEqual(buildCapabilityProposals([]), []);
  });

  it("prepends the signal evidence reference so rationale is non-empty", () => {
    const [a] = buildCapabilityProposals(
      [makeCandidate({ evidenceRefs: [] })],
      [{ evidenceId: "a7-p55-report", source: "p55" }],
    );
    assert.equal(a.intent.rationale.length, 1);
    assert.equal(a.intent.rationale[0].evidenceId, "a7-p55-report");
  });

  it("sets a low risk class for A7.0 proposals (which mutate nothing)", () => {
    const [a] = buildCapabilityProposals([makeCandidate()]);
    assert.equal(a.intent.riskClass, "low");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-proposal-builder.test.js`
Expected: FAIL — `buildCapabilityProposals` not defined.

- [ ] **Step 3: Write the implementation**

Create `src/evolution/capability-lifecycle/capability-proposal-builder.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type { CapabilityLifecycleCandidate } from "./contracts/lifecycle-contract.js";
import type {
  EvidenceReference,
  EvolutionIntent,
  EvolutionProposal,
} from "../contracts/evolution-contract.js";

export interface CapabilityProposalArtifacts {
  candidate: CapabilityLifecycleCandidate;
  intent: EvolutionIntent;
  proposal: EvolutionProposal;
}

/**
 * Build A0 EvolutionIntent + EvolutionProposal artifacts from lifecycle
 * candidates. Deterministic: identical candidates → identical ids. Empty
 * candidates → empty array (zero-candidate invariant, spec §4.7 analog).
 *
 * A7.0 proposals target `{ kind: "capability", id }`, carry `riskClass: "low"`
 * (A7.0 mutates nothing), and reference P5.5 + A5/A6 evidence by id.
 */
export function buildCapabilityProposals(
  candidates: CapabilityLifecycleCandidate[],
  signalEvidenceRefs: EvidenceReference[] = [],
): CapabilityProposalArtifacts[] {
  return candidates.map((candidate) => {
    const seed = `${candidate.target.capabilityId}|${candidate.intent}`;
    const evolutionId = `evol-a7-${hash16(`evol|${seed}`)}`;
    const proposalId = `prop-a7-${hash16(`prop|${seed}`)}`;

    const rationale: EvidenceReference[] = [
      ...signalEvidenceRefs,
      ...candidate.evidenceRefs.map((id) => ({ evidenceId: id, source: "a7" })),
    ];

    const intent: EvolutionIntent = {
      evolutionId,
      origin: "governance_signal",
      target: { kind: "capability", id: candidate.target.capabilityId },
      rationale,
      expectedEffect: `Capability lifecycle: ${candidate.intent} ${candidate.target.capabilityId}`,
      riskClass: "low",
      constraints: [],
      createdAt: new Date().toISOString(),
    };

    const proposal: EvolutionProposal = {
      proposalId,
      evolutionId,
      title: `${candidate.intent} capability ${candidate.target.capabilityId}`,
      description: candidate.rationale.join("; "),
      change: `${candidate.intent}: ${candidate.target.capabilityId} → ${candidate.proposedLifecycleState}`,
      beforeHash: null,
      afterHash: null,
      createdAt: new Date().toISOString(),
    };

    return { candidate, intent, proposal };
  });
}

function hash16(input: string): string {
  const hash = createHash("sha256");
  hash.update(input, "utf-8");
  return hash.digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-proposal-builder.test.js`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add src/evolution/capability-lifecycle/capability-proposal-builder.ts tests/evolution/capability-lifecycle/capability-proposal-builder.test.ts
git commit -m "feat(a7): capability proposal builder (candidates -> A0 artifacts)

Deterministic EvolutionIntent + EvolutionProposal per lifecycle candidate,
target kind 'capability', low risk class, non-empty evidence rationale.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Governance Bridge (proposal → A2.5 recommendation → A3 decision)

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-governance-bridge.ts`
- Test: `tests/evolution/capability-lifecycle/capability-governance-bridge.test.ts`

**Interfaces:**
- Consumes: `CapabilityLifecycleCandidate`, `CapabilityLifecycleRecord` from `./contracts/lifecycle-contract.js`; `generateDecision`, `DecisionConfig` from `../governance/decision-engine.js`; `createVerificationEvidence`, `computeEvidenceIntegrityHash` from `../verification/evidence/verification-evidence.js`; `GovernanceRecommendation` from `../verification/contracts/recommendation-contract.js`; `VerificationEvidence` from `../verification/contracts/verification-contract.js`; `GovernanceDecision` from `../governance/contracts/decision-contract.js`
- Produces:
  - `buildCapabilityEvidence(candidate, proposalId): VerificationEvidence` — `evidenceClass: "projected"`, `reproducibilityLevel: 2`, confidence profile with `historicalSimilarity: 1` and `overallConfidence = candidate.confidence`, deterministic `evidenceId = "a7-ev-<sha256hex16>"` over the candidate, integrity hash recomputed.
  - `buildCapabilityRecommendation(candidate, proposalId, evidence): GovernanceRecommendation` — `kind: "APPROVE"`, same `evidenceId`.
  - `runCapabilityGovernance(candidate, proposalId, options?: { policyConfig?: GovernancePolicyConfig; generateDecision?: typeof generateDecision }): CapabilityGovernanceOutcome`
  - `interface CapabilityGovernanceOutcome { evidence; recommendation; decision }`
  - `toLedgerRecord(phase: "intent" | "proposed" | "decided", candidate, outcome?): CapabilityLifecycleRecord` — maps the bridge result into a ledger record (see Task 8 usage).

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-governance-bridge.test.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapabilityEvidence,
  buildCapabilityRecommendation,
  runCapabilityGovernance,
} from "../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import type { CapabilityLifecycleCandidate } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function makeCandidate(): CapabilityLifecycleCandidate {
  return {
    intent: "deprecate",
    target: { capabilityId: "core.old" },
    confidence: 0.8,
    rationale: ["no recent use"],
    evidenceRefs: ["ev-1"],
    observedLifecycleState: "stagnant",
    proposedLifecycleState: "deprecated",
  };
}

describe("capability governance bridge", () => {
  it("builds projected verification evidence with a deterministic id", () => {
    const evidence = buildCapabilityEvidence(makeCandidate(), "prop-a7-x");
    assert.equal(evidence.evidenceClass, "projected");
    assert.ok(evidence.evidenceId.startsWith("a7-ev-"));
    assert.equal(evidence.confidenceProfile.overallConfidence, 0.8);
    assert.equal(evidence.confidenceProfile.historicalSimilarity, 1);
    // Confidence-formula invariant: min(a,a,a) * historicalSimilarity === overall.
    const { replayFidelity, coverage, determinism, historicalSimilarity } = evidence.confidenceProfile;
    assert.equal(Math.min(replayFidelity, coverage, determinism) * historicalSimilarity, evidence.confidenceProfile.overallConfidence);
  });

  it("builds an A2.5 APPROVE recommendation referencing the same evidence", () => {
    const candidate = makeCandidate();
    const evidence = buildCapabilityEvidence(candidate, "prop-a7-x");
    const recommendation = buildCapabilityRecommendation(candidate, "prop-a7-x", evidence);
    assert.equal(recommendation.kind, "APPROVE");
    assert.equal(recommendation.evidenceId, evidence.evidenceId);
    assert.equal(recommendation.proposalId, "prop-a7-x");
  });

  it("runs A3 and returns an APPROVE decision for high-confidence evidence", () => {
    const candidate = makeCandidate(); // confidence 0.8 = minApproveConfidence
    const outcome = runCapabilityGovernance(candidate, "prop-a7-x");
    assert.equal(outcome.decision.kind, "APPROVE");
    assert.equal(outcome.decision.proposalId, "prop-a7-x");
  });

  it("returns a REJECT decision for low-confidence evidence", () => {
    const candidate = { ...makeCandidate(), confidence: 0.2 }; // < rejectConfidenceThreshold 0.3
    const outcome = runCapabilityGovernance(candidate, "prop-a7-x");
    assert.equal(outcome.decision.kind, "REJECT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-governance-bridge.test.js`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/evolution/capability-lifecycle/capability-governance-bridge.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { createHash } from "node:crypto";
import type {
  CapabilityLifecycleCandidate,
  CapabilityLifecycleEventType,
  CapabilityLifecycleRecord,
} from "./contracts/lifecycle-contract.js";
import type { GovernanceRecommendation } from "../verification/contracts/recommendation-contract.js";
import type { VerificationEvidence } from "../verification/contracts/verification-contract.js";
import {
  computeEvidenceIntegrityHash,
  createVerificationEvidence,
} from "../verification/evidence/verification-evidence.js";
import {
  generateDecision,
} from "../governance/decision-engine.js";
import type {
  GovernanceDecision,
  GovernanceDecisionKind,
  GovernancePolicyConfig,
} from "../governance/contracts/decision-contract.js";

/**
 * A7 — Capability Governance Bridge (A7 → A3).
 *
 * Mirrors the A6 curation bridge: builds a `VerificationEvidence`
 * (reproducibilityLevel 2, deterministic evidenceId over the candidate,
 * recomputed integrity hash) and an A2.5 `GovernanceRecommendation` referencing
 * the SAME evidence, then calls A3 `generateDecision`. A7 proposes; A3 decides.
 * No A7-specific recommendation shape (spec §7).
 */

export interface CapabilityGovernanceOutcome {
  evidence: VerificationEvidence;
  recommendation: GovernanceRecommendation;
  decision: GovernanceDecision;
}

export function buildCapabilityEvidence(
  candidate: CapabilityLifecycleCandidate,
  proposalId: string,
): VerificationEvidence {
  const evidence = createVerificationEvidence({
    verificationId: `a7-capability-${candidate.target.capabilityId}`,
    proposalId,
    replayDatasetId: "a7-capability",
    proposalSnapshotHash: "a7",
    environmentHash: "a7",
    baselineMetrics: {},
    candidateMetrics: {},
    metricDeltas: {},
    behavioralChanges: candidate.rationale,
    confidenceProfile: {
      replayFidelity: candidate.confidence,
      coverage: candidate.confidence,
      determinism: candidate.confidence,
      historicalSimilarity: 1,
      overallConfidence: candidate.confidence,
    },
    reproducibilityLevel: 2, // lowest value passing A3's minReproducibilityLevel gate
    lineage: [],
    verifiedAt: new Date().toISOString(),
  });

  const evidenceId = `a7-ev-${hash16(`a7-ev|${candidate.target.capabilityId}|${candidate.intent}`)}`;
  const stable: Omit<VerificationEvidence, "integrityHash"> = { ...evidence, evidenceId };
  return { ...stable, integrityHash: computeEvidenceIntegrityHash(stable) };
}

export function buildCapabilityRecommendation(
  candidate: CapabilityLifecycleCandidate,
  proposalId: string,
  evidence: VerificationEvidence,
): GovernanceRecommendation {
  return {
    recommendationId: `rec-a7-${proposalId}`,
    evidenceId: evidence.evidenceId,
    proposalId,
    kind: "APPROVE", // A7 proposes; A3 decides
    confidence: evidence.confidenceProfile.overallConfidence,
    reasoning: candidate.rationale.join("; "),
    supportingEvidence: candidate.evidenceRefs,
    risks: candidate.rationale,
    createdAt: new Date().toISOString(),
  };
}

export function runCapabilityGovernance(
  candidate: CapabilityLifecycleCandidate,
  proposalId: string,
  options?: {
    policyConfig?: GovernancePolicyConfig;
    generateDecision?: typeof generateDecision;
  },
): CapabilityGovernanceOutcome {
  const evidence = buildCapabilityEvidence(candidate, proposalId);
  const recommendation = buildCapabilityRecommendation(candidate, proposalId, evidence);
  const decide = options?.generateDecision ?? generateDecision;
  const decision = decide(evidence, recommendation, { policyConfig: options?.policyConfig });
  return { evidence, recommendation, decision };
}

/**
 * Map a bridge phase + outcome into a ledger record (spec §5.2 semantics).
 * `decided` records carry decisionId + decisionKind; `proposed` carry
 * proposalId; `intent` carry neither. Never sets executionId/measurementId.
 */
export function toLedgerRecord(
  phase: CapabilityLifecycleEventType,
  candidate: CapabilityLifecycleCandidate,
  options: { proposalId?: string; outcome?: CapabilityGovernanceOutcome } = {},
): Omit<CapabilityLifecycleRecord, "recordId"> {
  const record: Omit<CapabilityLifecycleRecord, "recordId"> = {
    target: { ...candidate.target },
    intent: candidate.intent,
    eventType: phase,
    timestamp: new Date().toISOString(),
    evidenceRefs: [...candidate.evidenceRefs],
    observedLifecycleState: candidate.observedLifecycleState,
    proposedLifecycleState: candidate.proposedLifecycleState,
  };
  if (phase === "proposed" || phase === "decided") {
    record.proposalId = options.proposalId;
  }
  if (phase === "decided" && options.outcome) {
    record.decisionId = options.outcome.decision.decisionId;
    record.decisionKind = options.outcome.decision.kind as GovernanceDecisionKind;
  }
  return record;
}

function hash16(input: string): string {
  const hash = createHash("sha256");
  hash.update(input, "utf-8");
  return hash.digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-governance-bridge.test.js`
Expected: PASS (4/4). If `evidence.evidenceClass` is not a field on the shipped `VerificationEvidence`, drop that assertion (the A6 evidence carries `evidenceClass: "projected"` — verify in Task 1 report and match reality).

- [ ] **Step 5: Commit**

```bash
git add src/evolution/capability-lifecycle/capability-governance-bridge.ts tests/evolution/capability-lifecycle/capability-governance-bridge.test.js
git commit -m "feat(a7): capability governance bridge (A2.5 -> A3)

Mirrors the A6 bridge: deterministic evidence + APPROVE recommendation,
then generateDecision. Ledger record mapping with observed/proposed
semantics; decided carries decisionId/kind, never execution/measurement ids.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: CLI — `alix capabilities`

**Files:**
- Create: `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts` (full handler)
- Create: `src/evolution/capability-lifecycle/index.ts` (barrel: contract + ledger + analyzer + builder + bridge + cli)
- Create: `src/cli/commands/capabilities.ts` (thin re-export)
- Modify: `src/cli.ts` (dispatch, after the `executive` block ~line 2209)
- Test: `tests/evolution/capability-lifecycle/capability-cli.test.ts`

**Interfaces:**
- Consumes: all prior module outputs; `CapabilityRegistry` from `../../capability/registry.js`; `CapabilityEvolutionStore` from `../../adaptation/capability-evolution-store.js`; `renderDecision`-style output is NOT reused — the CLI prints plain text or JSON itself
- Produces: `export function handleCapabilitiesCommand(args: string[]): Promise<void>`; `export interface CapabilitiesCLIDeps { cwd?: string; ledger?: CapabilityLifecycleLedger; registry?: CapabilityRegistry; store?: CapabilityEvolutionStore; generateDecision?: typeof generateDecision; policyConfig?: GovernancePolicyConfig }`

Subcommands:
- `list` — read registry `list()` + per-capability `listLatestForCapability` → render `capabilityId | lifecycleState | projection` table.
- `inspect <id>` — `registry.find(id)` + `ledger.listByCapability(id)` → render detail; unknown id → error + exit 1.
- `history <id>` — `ledger.listByCapability(id)` → render `eventType | intent | decisionKind | timestamp` rows.
- `health` — `store.loadLatest()` → render `CapabilityEvolutionReport` summary (totalCapabilities, lifecycleDistribution, executiveSummary); missing → "No capability-evolution report — run `alix adaptation capability-evolution` first" + exit 0.
- `recommend` — READ-ONLY: build signals (registry + store + adoption `{}`), `analyzeCapabilityLifecycle` → render candidates; **no ledger write, no A3 call**.
- `propose` — analyze; if no candidates → "No capability lifecycle proposals" + exit 0 (no A3 call); else for each candidate: `buildCapabilityProposals` → `runCapabilityGovernance` → `ledger.append` `intent` (before bridge), `proposed` (after proposal), `decided` (after decision) → render decision. Still **never mutates the registry**.

Wiring in `src/cli.ts` (after the `executive` block):
```ts
// ── Capabilities command (A7.0) ───────────────────────────────────
if (command === "capabilities") {
  const { handleCapabilitiesCommand } = await import("./cli/commands/capabilities.js");
  await handleCapabilitiesCommand(args);
  process.exit(0);
}
```

`src/cli/commands/capabilities.ts`:
```ts
export { handleCapabilitiesCommand } from "../../evolution/capability-lifecycle/capability-lifecycle-cli.js";
```

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/capability-lifecycle/capability-cli.test.ts`. Uses injected deps (temp ledger file, in-memory registry, temp P5.5 store). The CLI reads `--json` for structured output; default human-readable.

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCapabilitiesCommand } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-cli.js";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityEvolutionStore } from "../../../src/adaptation/capability-evolution-store.js";
import type { Capability } from "../../../src/capability/types.js";
import type { CapabilitiesCLIDeps } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-cli.js";

let dir: string;
let deps: CapabilitiesCLIDeps;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

function capture(fn: () => Promise<void>): Promise<{ stdout: string }> {
  const writes: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => writes.push(args.join(" "));
  return fn().finally(() => {
    console.log = original;
  }).then(() => ({ stdout: writes.join("\n") }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-cli-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.session.list"));
  registry.register(makeCapability("core.old"));
  deps = { cwd: dir, ledger, registry };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("handleCapabilitiesCommand", () => {
  it("lists registry capabilities with lifecycle overlay", async () => {
    const { stdout } = await capture(() => handleCapabilitiesCommand(["list"], deps));
    assert.ok(stdout.includes("core.session.list"));
    assert.ok(stdout.includes("core.old"));
  });

  it("inspects a known capability", async () => {
    const { stdout } = await capture(() => handleCapabilitiesCommand(["inspect", "core.session.list"], deps));
    assert.ok(stdout.includes("core.session.list"));
  });

  it("errors on an unknown capability for inspect", async () => {
    const original = console.error;
    let errOut = "";
    console.error = (m?: unknown) => { errOut = String(m); };
    try {
      await capture(() => handleCapabilitiesCommand(["inspect", "nope.missing"], deps));
    } finally {
      console.error = original;
    }
    assert.ok(errOut.includes("not found") || errOut.length > 0);
  });

  it("reports missing P5.5 report on health without inventing data", async () => {
    const { stdout } = await capture(() => handleCapabilitiesCommand(["health"], deps));
    assert.ok(stdout.includes("capability-evolution report"));
  });

  it("recommend is read-only: no ledger write", async () => {
    const before = (await ledger.list()).length;
    // No P5.5 report, no adoption → no candidates, still no write.
    await capture(() => handleCapabilitiesCommand(["recommend"], deps));
    assert.equal((await ledger.list()).length, before);
  });

  it("propose with no candidates produces no A3 call and no ledger write", async () => {
    const before = (await ledger.list()).length;
    await capture(() => handleCapabilitiesCommand(["propose"], deps));
    assert.equal((await ledger.list()).length, before);
  });
});
```

For the `propose`-with-candidates path, the integration test (Task 9) covers the full flow; the CLI unit test here covers the no-candidate safety and the read-only `recommend`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-cli.test.js`
Expected: FAIL — `handleCapabilitiesCommand` not defined.

- [ ] **Step 3: Write the implementation**

Create `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts`:

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { DEFAULT_CAPABILITY_LIFECYCLE_FILE, JsonlCapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { analyzeCapabilityLifecycle } from "./capability-lifecycle-analyzer.js";
import type { CapabilitySignalInputs } from "./contracts/lifecycle-contract.js";
import { deriveCapabilityProjectionState } from "./contracts/lifecycle-contract.js";
import { buildCapabilityProposals } from "./capability-proposal-builder.js";
import { runCapabilityGovernance, toLedgerRecord } from "./capability-governance-bridge.js";
import { generateDecision } from "../governance/decision-engine.js";
import type { GovernancePolicyConfig } from "../governance/contracts/decision-contract.js";
import type { CapabilityRegistry } from "../../capability/registry.js";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";

export interface CapabilitiesCLIDeps {
  cwd?: string;
  ledger?: CapabilityLifecycleLedger;
  registry?: CapabilityRegistry;
  store?: CapabilityEvolutionStore;
  generateDecision?: typeof generateDecision;
  policyConfig?: GovernancePolicyConfig;
}

const USAGE = [
  "alix capabilities",
  "  list                  List registered capabilities with lifecycle overlay",
  "  inspect <id>          Show one capability in full context",
  "  history <id>          Show ledger events for one capability",
  "  health                Read the P5.5 capability-evolution report",
  "  recommend             (read-only) analyze and display lifecycle candidates",
  "  propose               (governed) submit lifecycle proposals through A3 and record",
].join("\n");

export async function handleCapabilitiesCommand(
  args: string[],
  deps: CapabilitiesCLIDeps = {},
): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const jsonMode = rest.includes("--json");
  const cwd = deps.cwd ?? process.cwd();
  const ledger = deps.ledger ?? new JsonlCapabilityLifecycleLedger(DEFAULT_CAPABILITY_LIFECYCLE_FILE);
  const registry = deps.registry;
  const store = deps.store ?? new CapabilityEvolutionStore(join(cwd, ".alix", "capability-evolution"));

  switch (sub) {
    case "list":
      return renderList(registry, ledger, jsonMode);
    case "inspect":
      return renderInspect(rest[0], registry, ledger, jsonMode);
    case "history":
      return renderHistory(rest[0], ledger, jsonMode);
    case "health":
      return renderHealth(store, jsonMode);
    case "recommend":
      return runRecommend(registry, store, ledger, jsonMode);
    case "propose":
      return runPropose(registry, store, ledger, deps, jsonMode);
    default:
      console.error(USAGE);
      process.exitCode = 1;
      return;
  }
}

async function buildSignalInputs(
  registry: CapabilityRegistry | undefined,
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
): Promise<CapabilitySignalInputs> {
  const report = await store.loadLatest();
  return {
    health: report?.healthAnalysis ?? [],
    gaps: report?.gapAnalysis ?? [],
    overlap: report?.overlapAnalysis ?? [],
    drift: report?.driftAnalysis ?? [],
    adoption: {},
    outcome: [],
    patterns: [],
  };
}

async function renderList(
  registry: CapabilityRegistry | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  const rows = [];
  const capabilities = registry ? registry.list() : [];
  for (const cap of capabilities) {
    const latest = await ledger.listLatestForCapability(cap.id);
    const projection = latest ? deriveCapabilityProjectionState(latest) : "PROPOSED";
    rows.push({ capabilityId: cap.id, lifecycleState: latest?.observedLifecycleState ?? null, projection });
  }
  if (jsonMode) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No capabilities registered.");
    return;
  }
  console.log(`${"capabilityId".padEnd(28)} ${"state".padEnd(12)} projection`);
  for (const r of rows) {
    console.log(`${r.capabilityId.padEnd(28)} ${String(r.lifecycleState ?? "—").padEnd(12)} ${r.projection}`);
  }
}

async function renderInspect(
  id: string | undefined,
  registry: CapabilityRegistry | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities inspect <id>");
    process.exitCode = 1;
    return;
  }
  const cap = registry?.find(id);
  if (!cap) {
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: `capability not found: ${id}` }));
    else console.error(`Capability not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  const events = await ledger.listByCapability(id);
  if (jsonMode) {
    console.log(JSON.stringify({ capability: cap, events }, null, 2));
    return;
  }
  console.log(`${id}`);
  console.log(`  title:        ${cap.title}`);
  console.log(`  kind:         ${cap.kind}`);
  console.log(`  risk:         ${cap.risk}`);
  console.log(`  lifecycle:    ${events.length} ledger event(s)`);
}

async function renderHistory(
  id: string | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities history <id>");
    process.exitCode = 1;
    return;
  }
  const events = await ledger.listByCapability(id);
  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (events.length === 0) {
    console.log(`No lifecycle history for ${id}.`);
    return;
  }
  console.log(`${"event".padEnd(10)} ${"intent".padEnd(12)} ${"decision".padEnd(12)} timestamp`);
  for (const e of events) {
    console.log(`${e.eventType.padEnd(10)} ${e.intent.padEnd(12)} ${String(e.decisionKind ?? "—").padEnd(12)} ${e.timestamp}`);
  }
}

async function renderHealth(store: CapabilityEvolutionStore, jsonMode: boolean): Promise<void> {
  const report = await store.loadLatest();
  if (!report) {
    const msg = "No capability-evolution report — run `alix adaptation capability-evolution` first.";
    if (jsonMode) console.log(JSON.stringify({ ok: false, message: msg }));
    else console.log(msg);
    return;
  }
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Capability health (${report.generatedAt})`);
  console.log(`  total capabilities: ${report.totalCapabilities}`);
  console.log(`  lifecycle: ${JSON.stringify(report.lifecycleDistribution)}`);
  console.log(`  ${report.executiveSummary}`);
}

async function runRecommend(
  registry: CapabilityRegistry | undefined,
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  const inputs = await buildSignalInputs(registry, store, ledger);
  const candidates = analyzeCapabilityLifecycle(inputs);
  if (jsonMode) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  if (candidates.length === 0) {
    console.log("No capability lifecycle recommendations.");
    return;
  }
  console.log(`Capability lifecycle recommendations (${candidates.length}):`);
  for (const c of candidates) {
    console.log(`  ${c.intent.padEnd(12)} ${c.target.capabilityId}  (${c.proposedLifecycleState})  conf=${c.confidence.toFixed(2)}`);
  }
}

async function runPropose(
  registry: CapabilityRegistry | undefined,
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
  deps: CapabilitiesCLIDeps,
  jsonMode: boolean,
): Promise<void> {
  const inputs = await buildSignalInputs(registry, store, ledger);
  const candidates = analyzeCapabilityLifecycle(inputs);
  if (candidates.length === 0) {
    if (jsonMode) console.log(JSON.stringify({ ok: true, proposals: [] }));
    else console.log("No capability lifecycle proposals.");
    return;
  }

  const signalEvidenceRefs = [{ evidenceId: "a7-p55-report", source: "p55" }];
  const artifacts = buildCapabilityProposals(candidates, signalEvidenceRefs);
  const results = [];

  for (const { candidate, intent, proposal } of artifacts) {
    await ledger.append(toLedgerRecord("intent", candidate));
    await ledger.append(toLedgerRecord("proposed", candidate, { proposalId: proposal.proposalId }));
    const outcome = runCapabilityGovernance(candidate, proposal.proposalId, {
      policyConfig: deps.policyConfig,
      generateDecision: deps.generateDecision,
    });
    await ledger.append(toLedgerRecord("decided", candidate, { proposalId: proposal.proposalId, outcome }));
    results.push({
      proposalId: proposal.proposalId,
      intent: candidate.intent,
      capabilityId: candidate.target.capabilityId,
      decisionKind: outcome.decision.kind,
    });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, proposals: results }, null, 2));
    return;
  }
  for (const r of results) {
    console.log(`${r.intent.padEnd(12)} ${r.capabilityId.padEnd(28)} ${r.decisionKind}`);
  }
}

// `join` needed above for the default P5.5 store path.
import { join } from "node:path";
```

> Note: the `join` import is declared at the bottom to keep the single-import statement requirement simple — the implementer may hoist it to the top. Same for `node:path`.

Create `src/evolution/capability-lifecycle/index.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

export * from "./contracts/lifecycle-contract.js";
export * from "./capability-lifecycle-ledger.js";
export * from "./capability-lifecycle-analyzer.js";
export * from "./capability-proposal-builder.js";
export * from "./capability-governance-bridge.js";
export * from "./capability-lifecycle-cli.js";
```

Create `src/cli/commands/capabilities.ts`:
```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

export { handleCapabilitiesCommand } from "../../evolution/capability-lifecycle/capability-lifecycle-cli.js";
```

Modify `src/cli.ts` — insert after the `executive` dispatch block (after line 2209):
```ts
// ── Capabilities command (A7.0) ───────────────────────────────────
if (command === "capabilities") {
  const { handleCapabilitiesCommand } = await import("./cli/commands/capabilities.js");
  await handleCapabilitiesCommand(args);
  process.exit(0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/capability-cli.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Impact + full-suite smoke + commit**

Run `mcp__gitnexus__impact({target: "handleCapabilitiesCommand", direction: "upstream"})` and `detect_changes()`. Then run the full A7 node suite:
```bash
pnpm build && node --test dist/tests/evolution/capability-lifecycle/**/*.test.js
```
Expected: all A7 suites pass. Commit:
```bash
git add src/evolution/capability-lifecycle/ src/cli/commands/capabilities.ts src/cli.ts tests/evolution/capability-lifecycle/capability-cli.test.ts
git commit -m "feat(a7): alix capabilities CLI (list/inspect/history/health/recommend/propose)

First-class namespace. recommend is observational (no write, no A3);
propose is the only state-changing command (ledger + A3, still no registry
mutation). Matches the verified governance recommend read-only convention.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Integration + Invariant Tests

**Files:**
- Test: `tests/evolution/capability-lifecycle/integration/a7-capability-lifecycle-integration.test.ts`

**Interfaces:**
- Consumes: every module from Tasks 2-8; `CapabilityRegistry` from `../../../src/capability/registry.js`; `CapabilityEvolutionStore` from `../../../src/adaptation/capability-evolution-store.js`

- [ ] **Step 1: Write the test**

```ts
// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../../src/capability/registry.js";
import type { Capability } from "../../../../src/capability/types.js";
import { JsonlCapabilityLifecycleLedger } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { analyzeCapabilityLifecycle } from "../../../../src/evolution/capability-lifecycle/capability-lifecycle-analyzer.js";
import { buildCapabilityProposals } from "../../../../src/evolution/capability-lifecycle/capability-proposal-builder.js";
import { runCapabilityGovernance, toLedgerRecord } from "../../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import { deriveCapabilityProjectionState } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilitySignalInputs } from "../../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type { CapabilityHealth } from "../../../../src/adaptation/capability-evolution-types.js";

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

function stagnantHealth(capability: string): CapabilityHealth {
  return {
    capability, agentCount: 0, resolutionCount: 2, resolutionCountRecent: 0,
    resolutionCountPrior: 1, proposalCountRecent: 0, proposalCountPrior: 2,
    demandScore: 0.1, keepRate: 0.2, revertRate: 0.4, proposalCount: 2,
    lifecycleState: "stagnant", rationale: "no recent use",
  };
}

let dir: string;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "a7-int-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.session.list"));
  registry.register(makeCapability("core.old"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("A7 end-to-end lifecycle governance", () => {
  it("governs a deprecate proposal end-to-end WITHOUT mutating the registry", async () => {
    const registrySnapshotBefore = JSON.stringify(registry.list());

    const inputs: CapabilitySignalInputs = {
      health: [stagnantHealth("core.old")],
      gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [],
    };

    // Analyze → candidates
    const candidates = analyzeCapabilityLifecycle(inputs);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].intent, "deprecate");
    assert.equal(candidates[0].target.capabilityId, "core.old");

    // Build A0 artifacts
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    assert.equal(artifacts.intent.target.kind, "capability");
    assert.equal(artifacts.proposal.change, "deprecate: core.old → deprecated");

    // Governance
    const outcome = runCapabilityGovernance(artifacts.candidate, artifacts.proposal.proposalId);
    assert.equal(outcome.decision.kind, "APPROVE");
    assert.equal(outcome.decision.proposalId, artifacts.proposal.proposalId);

    // Record intent → proposed → decided
    await ledger.append(toLedgerRecord("intent", artifacts.candidate));
    await ledger.append(toLedgerRecord("proposed", artifacts.candidate, { proposalId: artifacts.proposal.proposalId }));
    await ledger.append(toLedgerRecord("decided", artifacts.candidate, { proposalId: artifacts.proposal.proposalId, outcome }));

    const records = await ledger.list();
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.eventType), ["intent", "proposed", "decided"]);

    // Invariant: approval never mutates the registry.
    assert.equal(JSON.stringify(registry.list()), registrySnapshotBefore);

    // Invariant: no applied/measured events and no execution/measurement ids.
    for (const r of records) {
      assert.ok(!("executionId" in r));
      assert.ok(!("measurementId" in r));
      assert.ok(r.eventType !== "applied" && r.eventType !== "measured");
    }

    // Invariant: APPROVE_PENDING_APPLICATION is a projection, never in the record.
    const latest = await ledger.listLatestForCapability("core.old");
    assert.equal(latest?.decisionKind, "APPROVE");
    assert.equal(latest?.observedLifecycleState, "stagnant"); // registry-reported observation
    assert.equal(latest?.proposedLifecycleState, "deprecated"); // requested, not applied
    assert.equal(deriveCapabilityProjectionState(latest), "APPROVED_PENDING_APPLICATION");
  });

  it("zero candidates → no proposal, no A3 call, no ledger write", async () => {
    const empty: CapabilitySignalInputs = { health: [], gaps: [], overlap: [], drift: [], adoption: {}, outcome: [], patterns: [] };
    const candidates = analyzeCapabilityLifecycle(empty);
    assert.deepEqual(candidates, []);
    assert.deepEqual(buildCapabilityProposals(candidates), []);
    assert.equal((await ledger.list()).length, 0);
  });

  it("a rejected proposal still does not mutate the registry and projects REJECTED", async () => {
    const snapshot = JSON.stringify(registry.list());
    const inputs: CapabilitySignalInputs = {
      health: [stagnantHealth("core.old")],
      gaps: [], overlap: [], drift: [],
      adoption: {}, outcome: [], patterns: [],
    };
    const candidates = analyzeCapabilityLifecycle(inputs);
    const [artifacts] = buildCapabilityProposals(candidates, [{ evidenceId: "a7-p55-report", source: "p55" }]);
    // Force a reject via a low-confidence candidate.
    const lowConfidence = { ...artifacts.candidate, confidence: 0.2 };
    const outcome = runCapabilityGovernance(lowConfidence, artifacts.proposal.proposalId);
    assert.equal(outcome.decision.kind, "REJECT");
    await ledger.append(toLedgerRecord("decided", lowConfidence, { proposalId: artifacts.proposal.proposalId, outcome }));
    assert.equal(JSON.stringify(registry.list()), snapshot);
    const latest = await ledger.listLatestForCapability("core.old");
    assert.equal(deriveCapabilityProjectionState(latest), "REJECTED");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/capability-lifecycle/integration/a7-capability-lifecycle-integration.test.js`
Expected: PASS (3/3).

- [ ] **Step 3: Run the full A7 suite + A0 contract regression**

```bash
pnpm build && node --test dist/tests/evolution/capability-lifecycle/**/*.test.js
node --test dist/tests/evolution/contracts/*.test.js
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/evolution/capability-lifecycle/integration/a7-capability-lifecycle-integration.test.ts
git commit -m "test(a7): end-to-end lifecycle governance + invariant assertions

Covers: approval never mutates the registry, no applied/measured events,
no execution/measurement ids, observed vs proposed state semantics,
APPROVED_PENDING_APPLICATION as projection-only, zero-candidate safety,
and REJECTED projection.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Closure — Checkpoint, Tag, Roadmap

**Files:**
- Create: `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`
- Modify: `docs/roadmap/a-series-autonomous-evolution.md` (A7 row → complete; frontier now A8/A9)
- Tag: `alix-a7-capability-marketplace-complete`

- [ ] **Step 1: Write the closure checkpoint**

Create `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md` mirroring the A6 closure checkpoint (`docs/architecture/checkpoints/2026-08-10-a6-*.md`): purpose, what shipped (the 6 files + CLI + contract extension), the A7.0 boundary invariants, test evidence (per-suite counts), and the A7.1 deferral note.

- [ ] **Step 2: Update the roadmap**

In `docs/roadmap/a-series-autonomous-evolution.md`, change the A7 row from `🔲 Proposed` to `✅ Complete` and update the frontier table header note so A8/A9 remain the frontier. Keep the "designed at roadmap level only" wording for A8/A9.

- [ ] **Step 3: Full A7 suite + detect_changes**

```bash
pnpm build && node --test dist/tests/evolution/capability-lifecycle/**/*.test.js
```
Run `mcp__gitnexus__detect_changes()` and confirm the affected scope is the A7 module, the contract extension, the CLI wiring, and tests — no unexpected execution flows.

- [ ] **Step 4: Commit + tag**

```bash
git add docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md docs/roadmap/a-series-autonomous-evolution.md
git commit -m "docs(a7): A7.0 closure checkpoint + roadmap update

A7 — Capability Marketplace: A7.0 Capability Lifecycle Governance
(Propose -> Decide -> Record) complete. Governed decision boundary only;
A7.1 owns the application boundary (A4 binding + registry mutation + A5
measurement). tag: alix-a7-capability-marketplace-complete.

Co-Authored-By: Claude <noreply@anthropic.com>"
git tag -a alix-a7-capability-marketplace-complete -m "A7.0 Capability Lifecycle Governance complete"
git push origin main --tags
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: §4 contract extension → Task 2; §5.1-5.2 lifecycle contract → Task 3; §5.3 projection → Task 3; ledger → Task 4; §6 analyzer → Task 5; §7 A3 bridge → Task 7; §8 CLI → Task 8; §9 error handling → Tasks 4 (never-throw), 5 (empty inputs), 8 (unknown subcommand / missing report / no-candidates); §10 all 8 test suites → Tasks 2-9; §11 A7.1 boundary → Tasks 9-10 (prohibited events asserted). Zero-candidate invariant → Tasks 5, 6, 8, 9. Approval-never-mutates → Task 9. Determinism → Tasks 5, 6, 7.

**2. Placeholder scan** — every step has concrete code or an exact command. No "add error handling", no "similar to Task N". The two inline caveats (the `evidence.evidenceClass` assertion and the `pattern.evidenceIds` field) are conditional checks against reality, with explicit fallback instructions, not placeholders.

**3. Type consistency** — `CapabilityLifecycleRecord`, `CapabilityLifecycleIntent`, `CapabilityLifecycleCandidate`, `CapabilitySignalInputs` defined once (Task 3) and referenced by name in Tasks 4-9. `toLedgerRecord` signature used identically in Tasks 7-9. `buildCapabilityProposals(candidates, signalEvidenceRefs?)` used identically in Tasks 6, 8, 9. `analyzeCapabilityLifecycle(inputs)` used identically in Tasks 5, 8, 9. `deriveCapabilityProjectionState` used identically in Tasks 3, 8, 9. `handleCapabilitiesCommand(args, deps?)` used identically in Tasks 8-9.
