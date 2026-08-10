# A6 — Knowledge Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build A6 Knowledge Evolution — detect stale, duplicate, contradictory, and compressible knowledge across ALiX's existing stores and route curation proposals through A3 governance.

**Architecture:** `src/evolution/knowledge/` mirrors the A5 `observation/` layout: read-only adapters project store artifacts into a normalized in-memory `KnowledgeArtifact` read model; pure detectors (`detect(artifacts, config)`) emit `CurationFinding[]`; the `curation-proposal-builder` wraps findings into a `CurationProposal` and, only when non-empty, constructs a `GovernanceRecommendation` + `VerificationEvidence` fed to A3's `generateDecision`. A6 never writes to knowledge stores and never instantiates the lifecycle.

**Tech Stack:** TypeScript, Node:test (node:test runner), JSONL/Filesystem stores. Follows the A5 `observation/` pattern exactly.

## Global Constraints

- **A6 never writes to knowledge stores.** Adapters are read-only; detectors are pure.
- **Detectors are pure** — `detect(artifacts: KnowledgeArtifact[], config: CurationConfig): CurationFinding[]`. No I/O, no store access, no side effects.
- **Adapters never throw** — wrap reads in try/catch, return `[]` on corrupt/missing artifacts, skip corrupt JSONL lines (reuse the `parseLines` pattern from `src/learning/learning-store.ts`).
- **Deterministic identity** — `findingId = hash(store, kind, artifactId, targetId?)`; pairwise findings canonicalize by sorting target IDs lexicographically before hashing; `createdAt` is observation metadata, excluded from identity and comparison.
- **Contradiction detection operates only on `KnowledgeArtifact.claim`** — never free text, never semantic inference. If a store has no structured claim, no contradiction is detected for it.
- **Zero-findings invariant** — 0 findings → no `CurationProposal` → no A3 call → no `GovernanceDecision`.
- **A6 does not instantiate the evolution lifecycle.** A3 governs; the existing A-series lifecycle owns transitions.
- **Store availability is diagnostic, not a finding** — `CurationResult.storeStatus`, never a `CurationFinding`, never a proposal.
- **CLI dimension names** are the full `CurationFindingKind` names: `stale | duplicate | contradiction | compressible`.
- All new files must carry the SPDX header used in `src/evolution/observation/` files. All cross-file imports use `.js` extension.
- **Contract-first:** Task 1 verifies existing A0/A3/A5 interfaces before any new files; do not invent compatibility fields.

## Executable Invariants

Each invariant below must be asserted by an explicit test (task noted). These are **not** aspirational — a failing invariant test is a plan failure.

| Invariant | Required test | Task |
|-----------|---------------|------|
| Detectors are pure | input `KnowledgeArtifact[]` snapshot byte-identical before/after detector | Task 4 |
| Adapters are read-only | store dir listing + file contents byte-identical after `read()` | Task 3 |
| Deterministic finding IDs | same input twice → identical `findingId`s | Task 5 |
| Pair symmetry | `duplicate(A,B)` == `duplicate(B,A)` (canonicalized targetId) | Task 4 |
| Stable ordering | same input ordering → same output ordering | Task 5 |
| Missing store tolerated | one unavailable store does not suppress findings from others | Task 5 |
| Corrupt JSONL tolerated | valid lines survive bad lines | Task 3 |
| No findings | no proposal **and no A3 call** | Task 6 + Task 7 |
| Non-empty findings | exactly one proposal and one A3 decision | Task 6 + Task 8 |
| A6 never mutates stores | integration snapshot of store dir before/after full pipeline byte-identical | Task 8 |

---

### Task 1: Contract verification against A0/A3/A5

**Files:**
- Read (verify, do not modify): `src/adaptation/decision-types.ts`, `src/governance/governance-types.ts`, `src/evolution/governance/decision-engine.ts`, `src/evolution/verification/evidence/evidence-ledger.ts`, `src/evolution/verification/evidence/verification-evidence.ts`, `src/learning/learning-store.ts`, `src/chronicle/chronicle-store.ts`, `src/governance/failure-memory.ts`, `src/context/pattern-registry.ts`

**Interfaces:**
- Consumes: the approved spec `docs/superpowers/specs/2026-08-10-a6-knowledge-evolution-design.md`
- Produces: a short verification note (e.g. `docs/architecture/checkpoints/2026-08-10-a6-contract-verification.md`) recording the exact signatures the plan builds against.

- [ ] **Step 1: Verify `DecisionArtifact`**

Run: `sed -n '30,55p' src/adaptation/decision-types.ts`
Confirm: it requires `id, subject, outcome, confidence, reasons, generatedAt` (plus optional `warnings, evidenceRefs`). This is why `CurationProposal` must NOT extend it (spec §4.3).

- [ ] **Step 2: Verify `GovernanceRecommendation` and `Recommendation`**

Run: `sed -n '103,120p' src/governance/governance-types.ts`
Confirm: `GovernanceRecommendation extends DecisionArtifact`, has `reportType: "governance_recommendation"` and `recommendations: Recommendation[]`. `Recommendation` has `id, source, sourceArtifactId, priority, confidence, status, category`.

- [ ] **Step 3: Verify A3 `generateDecision` input contract**

Run: `grep -nE "evidence\.|recommendation\.|policyConfig\." src/evolution/governance/decision-engine.ts | head -20`
Confirm: it reads `evidence.confidenceProfile.overallConfidence`, `evidence.reproducibilityLevel`, `inferRegressions(evidence)`, and the optional `recommendation`. The builder must supply these.

- [ ] **Step 4: Verify `VerificationEvidenceLedger` read API**

Run: `grep -nE "interface|get\(|listByProposal|listExpired" src/evolution/verification/evidence/evidence-ledger.ts`
Confirm: `store()`, `get()`, `listByProposal()`, `listExpired()` exist. `listByProposal` and `listExpired` are the read-only evidence inputs for the evidence adapter.

- [ ] **Step 5: Verify `createVerificationEvidence` and `EvidenceClass`**

Run: `sed -n '78,100p' src/evolution/verification/evidence/verification-evidence.ts` and `grep -n "EvidenceClass" src/evolution/verification/contracts/verification-contract.ts`
Confirm: `EvidenceClass = "observed" | "derived" | "projected" | "executed"`; `createVerificationEvidence(input)` requires `verificationId, proposalId, replayDatasetId, proposalSnapshotHash, environmentHash, baselineMetrics, candidateMetrics, metricDeltas, behavioralChanges, confidenceProfile, reproducibilityLevel, lineage, verifiedAt`.

- [ ] **Step 6: Verify the four store read APIs**

Run:
```bash
grep -nE "querySignals|queryProfiles|async query" src/learning/learning-store.ts
grep -nE "loadIndex|list|entries" src/chronicle/chronicle-store.ts
grep -nE "list\(|getByRun|findSimilar" src/governance/failure-memory.ts
grep -nE "getStats|recordOutcome" src/context/pattern-registry.ts
```
Confirm each store exposes a read path the adapters can use read-only. Note: `pattern-registry` is in-memory (`getStats(taskType)`) — the adapter projects via its public getters, not files.

- [ ] **Step 7: Write the verification note**

Create `docs/architecture/checkpoints/2026-08-10-a6-contract-verification.md` recording the verified signatures above and the store→artifact mapping table from spec §4.1.

- [ ] **Step 8: Commit**

```bash
git add docs/architecture/checkpoints/2026-08-10-a6-contract-verification.md
git commit -m "docs(a6): record contract verification against A0/A3/A5"
```

---

### Task 2: Curation contracts — types + config

**Files:**
- Create: `src/evolution/knowledge/contracts/curation-contract.ts`
- Test: `tests/evolution/knowledge/curation-contract.test.ts`

**Interfaces:**
- Consumes: `KnowledgeStore`, `KnowledgeArtifact` shape (defined here)
- Produces:
  - `KnowledgeStore = "learning" | "chronicle" | "failure_memory" | "pattern_registry"`
  - `interface KnowledgeArtifact { store, artifactId, artifactKind, subject?, content, createdAt, updatedAt?, evidenceRefs, downstreamRefs, claim? }`
  - `type CurationFindingKind = "stale" | "duplicate" | "contradiction" | "compressible"`
  - `interface CurationFinding { findingId, kind, reasonCode, store, artifactId, artifactKind, targetId?, severity, rationale, evidenceRefs, confidence, createdAt }`
  - `interface CurationProposal { proposalId, findings, summary, dimension, createdAt }` (NOT extending DecisionArtifact)
  - `interface CurationConfig { staleAfterDays, duplicateSimilarityThreshold, compressionAfterDays }`
  - `type StoreStatus = { status: "available" } | { status: "unavailable"; store; reason? }`
  - `interface CurationResult { findings: CurationFinding[]; storeStatus: StoreStatus[] }`
  - `DEFAULT_CURATION_CONFIG: CurationConfig = { staleAfterDays: 90, duplicateSimilarityThreshold: 0.9, compressionAfterDays: 180 }`

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/knowledge/curation-contract.test.ts` with:
- a test asserting `DEFAULT_CURATION_CONFIG` values are `{ staleAfterDays: 90, duplicateSimilarityThreshold: 0.9, compressionAfterDays: 180 }`
- a test asserting a valid `KnowledgeArtifact` object satisfies a type-guard `isKnowledgeArtifact()` (returns true)
- a test asserting an object missing `store` fails `isKnowledgeArtifact()` (returns false)
- a test asserting a valid `CurationFinding` object satisfies `isCurationFinding()`
- a test asserting `CurationProposal` does NOT have `DecisionArtifact`'s required `outcome` field (verify the type's shape: `('outcome' in proposal) === false`)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/evolution/knowledge/curation-contract.test.js` (after `pnpm build`; tests run against `dist/`)
Expected: FAIL — module/type-guards not defined.

- [ ] **Step 3: Implement `curation-contract.ts`**

Write the SPDX header (copy from `src/evolution/observation/observation-contract.ts`). Define all types above plus:
```ts
export function isKnowledgeArtifact(v: unknown): v is KnowledgeArtifact {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as KnowledgeArtifact).store === "string" &&
    typeof (v as KnowledgeArtifact).artifactId === "string" &&
    typeof (v as KnowledgeArtifact).content === "string" &&
    typeof (v as KnowledgeArtifact).createdAt === "string"
  );
}
export function isCurationFinding(v: unknown): v is CurationFinding { /* similar */ }
export const DEFAULT_CURATION_CONFIG: CurationConfig = {
  staleAfterDays: 90,
  duplicateSimilarityThreshold: 0.9,
  compressionAfterDays: 180,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-contract.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/knowledge/contracts/curation-contract.ts tests/evolution/knowledge/curation-contract.test.ts
git commit -m "feat(a6): add curation contract types and config"
```

---

### Task 3: Store adapters — project store artifacts into KnowledgeArtifact[]

**Files:**
- Create: `src/evolution/knowledge/adapters/learning-store-adapter.ts`, `chronicle-adapter.ts`, `failure-memory-adapter.ts`, `pattern-registry-adapter.ts`, `evidence-adapter.ts`, `src/evolution/knowledge/adapters/index.ts`
- Test: `tests/evolution/knowledge/knowledge-artifact-adapter.test.ts`

**Interfaces:**
- Consumes: `KnowledgeArtifact`, `KnowledgeStore`, `CurationResult` (Task 2); store read APIs (Task 1)
- Produces:
  - `interface AdapterResult { artifacts: KnowledgeArtifact[]; status: StoreStatus }`
  - `class LearningStoreAdapter { constructor(dir: string); async read(): Promise<AdapterResult> }`
  - `class ChronicleAdapter { constructor(dir: string); async read(): Promise<AdapterResult> }`
  - `class FailureMemoryAdapter { constructor(dir: string); async read(): Promise<AdapterResult> }`
  - `class PatternRegistryAdapter { constructor(registry: PatternRegistry); async read(): Promise<AdapterResult> }` — projects from the in-memory registry's `getStats(taskType)` via `registry` getters, read-only
  - `class EvidenceAdapter { constructor(ledger: VerificationEvidenceLedger); async read(): Promise<AdapterResult> }` — projects A5 `VerificationEvidence` into `KnowledgeArtifact`s (store: `"learning"` is not right — see Step 1 note)
  - Each adapter returns `{ artifacts, status }`; on missing dir / throw → `{ artifacts: [], status: { status: "unavailable", store } }`.

- [ ] **Step 1: Decide the evidence adapter's `KnowledgeStore` value**

The spec's `KnowledgeStore` union does not include evidence. Read `docs/superpowers/specs/2026-08-10-a6-knowledge-evolution-design.md` §3 "A5 evidence input". If `KnowledgeStore` needs an evidence source, extend the union with `"evidence"` in Task 2's contract (add it now in `curation-contract.ts`). This task's `EvidenceAdapter` projects A5 evidence as `KnowledgeArtifact` with `store: "evidence"`, `artifactKind: "VerificationEvidence"`, `content: JSON.stringify of metrics/deltas`, `evidenceRefs: [evidenceId]`.

- [ ] **Step 2: Write the failing test**

Create `tests/evolution/knowledge/knowledge-artifact-adapter.test.ts` with:
- a test that `LearningStoreAdapter` on a temp dir with two `signals.jsonl` lines returns 2 `KnowledgeArtifact`s with correct `store`/`artifactKind`
- a test that `LearningStoreAdapter` on a missing dir returns `{ artifacts: [], status: { status: "unavailable" } }`
- a test that one corrupt JSONL line doesn't suppress a valid neighbor (2 lines, 1 bad → 1 artifact)
- a test that `FailureMemoryAdapter` projects `FailureRecord` fields into `claim` when `failureType` present
- a test that `EvidenceAdapter` projects a `VerificationEvidence` (from `createVerificationEvidence`) into an artifact with `store: "evidence"`
- **a read-only test**: seed a store dir with known files + contents, snapshot the dir listing + file contents, run each adapter's `read()`, then assert the dir listing + file contents are byte-identical (adapters must never write)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/knowledge-artifact-adapter.test.js`
Expected: FAIL — adapters not defined.

- [ ] **Step 4: Implement the adapters**

For each, write SPDX header, constructor, and `async read()` that:
- resolves the store dir / source
- if missing or read throws → return `{ artifacts: [], status: { status: "unavailable", store } }`
- parses JSONL, skipping corrupt lines (reuse the `parseLines` pattern from `src/learning/learning-store.ts`)
- maps each artifact to `KnowledgeArtifact` (see spec §4.1 mapping table)

`LearningStoreAdapter` maps:
- `LearningSignal` → `artifactKind: "LearningSignal"`, `subject: signalType`, `claim: { subject: signalType, predicate: "delta", value: JSON.stringify(delta) }` when `delta` present
- `CalibrationProfile` → `subject: target+targetName`, `claim: { subject: target, predicate: "value", value: String(suggestedValue) }`
- `LearningReport` → `artifactKind: "LearningReport"`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/knowledge-artifact-adapter.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/evolution/knowledge/adapters/ tests/evolution/knowledge/knowledge-artifact-adapter.test.ts
git commit -m "feat(a6): add read-only store adapters"
```

---

### Task 4: Detectors — pure, config-driven

**Files:**
- Create: `src/evolution/knowledge/detectors/staleness-detector.ts`, `dedup-detector.ts`, `contradiction-detector.ts`, `compression-detector.ts`, `src/evolution/knowledge/detectors/index.ts`
- Test: `tests/evolution/knowledge/staleness-detector.test.ts`, `dedup-detector.test.ts`, `contradiction-detector.test.ts`, `compression-detector.test.ts`

**Interfaces:**
- Consumes: `KnowledgeArtifact`, `CurationFinding`, `CurationConfig`, `isCurationFinding` (Task 2)
- Produces:
  - `function detectStale(artifacts, config): CurationFinding[]`
  - `function detectDuplicates(artifacts, config): CurationFinding[]`
  - `function detectContradictions(artifacts): CurationFinding[]` (config not needed for claims-only)
  - `function detectCompressible(artifacts, config): CurationFinding[]`
  - A shared `computeFindingId(store, kind, artifactId, targetId?): string` in `src/evolution/knowledge/detectors/finding-id.ts` — deterministic SHA-256 hash; **sort target IDs lexicographically before hashing for pairwise findings**
  - A shared `normalizeContent(s): string` (lowercase, collapse whitespace) for dedup similarity.

- [ ] **Step 1: Write the failing tests**

Create the four test files:
- `staleness-detector.test.ts`: (a) artifact older than `staleAfterDays` → finding with `reasonCode: "age"`; (b) newer artifact in same `(store, artifactKind, subject)` → `reasonCode: "superseded"`; (c) artifact whose `claim.value` disagrees with a newer evidence artifact → `reasonCode: "outcome_contradiction"`; (d) fresh artifact → no finding.
- `dedup-detector.test.ts`: (a) two exact-same `(store, artifactKind, subject)` → finding `reasonCode: "exact"`; (b) two near-duplicate content above threshold → `reasonCode: "near"`; (c) **pair canonicalization**: `detectDuplicates([A,B])` finding's `targetId` is the lexicographically-smaller ID regardless of input order.
- `contradiction-detector.test.ts`: (a) two claims same subject different value → `reasonCode: "value_clash"`; (b) a claim whose value disagrees with evidence artifact → `reasonCode: "outcome_contradiction"`; (c) artifacts without `claim` → no finding.
- `compression-detector.test.ts`: (a) artifact older than `compressionAfterDays` AND empty `evidenceRefs` AND empty `downstreamRefs` → finding; (b) referenced artifact → no finding.
- **a purity test (shared across the four suites)**: build an `artifacts: KnowledgeArtifact[]` fixture, deep-freeze a snapshot of it, run each detector, then assert the input array's elements and contents are unchanged (`JSON.stringify(snapshotBefore) === JSON.stringify(snapshotAfter)`) — detectors must not mutate their input.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/staleness-detector.test.js dist/tests/evolution/knowledge/dedup-detector.test.js dist/tests/evolution/knowledge/contradiction-detector.test.js dist/tests/evolution/knowledge/compression-detector.test.js`
Expected: FAIL — detectors not defined.

- [ ] **Step 3: Implement the detectors + finding-id helper**

Write `finding-id.ts` with `computeFindingId` (SHA-256 over `store|kind|artifactId|targetId?`, with targetId sorted). Implement each detector as a pure function. **Pairwise detectors (dedup, contradiction) sort the pair by ID before assigning `targetId`** so `(A,B)` and `(B,A)` yield identical findings.

- [ ] **Step 4: Run tests to verify they pass**

Run: same as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/knowledge/detectors/ tests/evolution/knowledge/*detector.test.ts
git commit -m "feat(a6): add pure curation detectors"
```

---

### Task 5: Curation engine — orchestrate adapters + detectors

**Files:**
- Create: `src/evolution/knowledge/curation-engine.ts`, `src/evolution/knowledge/index.ts`
- Test: `tests/evolution/knowledge/curation-engine.test.ts`

**Interfaces:**
- Consumes: adapters (Task 3), detectors (Task 4), `CurationConfig`, `CurationResult` (Task 2)
- Produces:
  - `interface CurationEngineDeps { adapters: ReadonlyArray<() => Promise<AdapterResult>>; detectors: ReadonlyArray<(artifacts, config) => CurationFinding[]>; }`
  - `class CurationEngine { constructor(deps: CurationEngineDeps); async curateAll(config?): Promise<CurationResult> }`

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/knowledge/curation-engine.test.ts`:
- a test that with two stub adapters (one returning 1 stale artifact, one unavailable) + a stub detector, `curateAll` returns findings from the available store and a `storeStatus` entry for the unavailable store
- a test that an unavailable store does not suppress findings from the other three
- a test that ordering is preserved (findings appear in adapter-then-detector order)
- a test that same input run twice → identical finding IDs (determinism)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-engine.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `curation-engine.ts`**

`curateAll(config?)`:
1. Run all adapters, collect `artifacts` and `storeStatus[]`
2. For each detector, `detector(artifacts, config ?? DEFAULT_CURATION_CONFIG)`
3. Aggregate findings in order, preserving adapter-then-detector sequence
4. Return `{ findings, storeStatus }`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-engine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/knowledge/curation-engine.ts src/evolution/knowledge/index.ts tests/evolution/knowledge/curation-engine.test.ts
git commit -m "feat(a6): add curation engine orchestration"
```

---

### Task 6: Curation proposal builder — A3 mapping

**Files:**
- Create: `src/evolution/knowledge/curation-proposal-builder.ts`
- Test: `tests/evolution/knowledge/curation-proposal-builder.test.ts`

**Interfaces:**
- Consumes: `CurationFinding`, `CurationProposal`, `CurationConfig` (Task 2); `GovernanceRecommendation`, `Recommendation` (Task 1); `createVerificationEvidence`, `VerificationEvidenceInput` (Task 1)
- Produces:
  - `function buildCurationProposal(findings: CurationFinding[]): CurationProposal | null` — returns `null` when findings is empty (zero-findings invariant)
  - `function buildGovernanceRecommendation(proposal: CurationProposal): GovernanceRecommendation` — builds a `DecisionArtifact`-satisfying recommendation (id←proposalId, subject←summary, outcome←"curation_proposed", confidence←max finding confidence, reasons←rationales, evidenceRefs←union, generatedAt←createdAt, reportType:"governance_recommendation", recommendations: one `Recommendation` per dimension)
  - `function buildEvidenceFromFindings(findings: CurationFinding[]): VerificationEvidence` — wraps finding `evidenceRefs` + rationale into a `VerificationEvidence` via `createVerificationEvidence` with `confidenceProfile.overallConfidence` = aggregated finding confidence.

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/knowledge/curation-proposal-builder.test.ts`:
- `buildCurationProposal([])` → `null`
- `buildCurationProposal([finding])` → proposal with `findings.length === 1`, summary non-empty
- `buildGovernanceRecommendation(proposal)` → object satisfying `DecisionArtifact` shape (`id`, `subject`, `outcome`, `confidence`, `reasons`, `generatedAt` all present), `reportType === "governance_recommendation"`, one `Recommendation` per dimension
- `buildEvidenceFromFindings(findings)` → `VerificationEvidence` with `evidenceClass === "projected"`, `proposalId` non-empty

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-proposal-builder.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the builder**

Follow the A3 construction pattern (see `src/governance/governance-types.ts` and `src/evolution/verification/evidence/verification-evidence.ts`). For `buildEvidenceFromFindings`, call `createVerificationEvidence` with:
```ts
{
  verificationId: `a6-curation-${proposalId}`,
  proposalId: findings[0].artifactId,
  replayDatasetId: "a6-curation",
  proposalSnapshotHash: "a6",
  environmentHash: "a6",
  baselineMetrics: {}, candidateMetrics: {}, metricDeltas: {},
  behavioralChanges: findings.map(f => f.rationale),
  confidenceProfile: { overallConfidence: aggregated, perMetric: {} },
  reproducibilityLevel: /* lowest level that satisfies A3 — check the enum in Task 1 */,
  lineage: [], verifiedAt: now,
}
```
(The `reproducibilityLevel` value must satisfy A3's `minReproducibilityLevel` check — verify the enum in Task 1 Step 3 and set a passing value.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-proposal-builder.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/knowledge/curation-proposal-builder.ts tests/evolution/knowledge/curation-proposal-builder.test.ts
git commit -m "feat(a6): add curation proposal builder and A3 mapping"
```

---

### Task 7: CLI — `alix governance evolution curate`

**Files:**
- Modify: `src/governance/evolution-cli.ts` (add `curate` case + help text + import)
- Create: `src/evolution/knowledge/curation-cli.ts`
- Test: `tests/evolution/knowledge/curation-cli.test.ts`

**Interfaces:**
- Consumes: `CurationEngine`, adapters, detectors, builder, `CurationConfig` (Tasks 3-6); `EvolutionCLIDeps` (existing in `evolution-cli.ts`)
- Produces:
  - `function handleCurationCommand(deps, args): Promise<void>` — parses `--dimension` and `--json`, runs the engine, renders findings, routes non-empty proposals to A3
  - A new `curate` case in `evolution-cli.ts` following the `observe` pattern

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/knowledge/curation-cli.test.ts`:
- `--dimension stale` filters findings to stale only
- `--dimension duplicate` accepts the full name (and `--dimension dup` → usage error + exit 1)
- `--json` produces valid JSON `{ findings, proposal, decision }`
- no findings → "No curation findings" message, no A3 call (mock deps to assert `generateDecision` not called)
- unknown dimension → usage error + exit 1

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-cli.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `curation-cli.ts` + wire into `evolution-cli.ts`**

Follow the `observe` case pattern in `evolution-cli.ts`. Add:
```ts
case "curate":
  if (!id) { /* no id needed — curate runs all stores; but keep the usage guard */ }
  {
    const { handleCurationCommand } = await import("../evolution/knowledge/curation-cli.js");
    return handleCurationCommand(deps, args.slice(1));
  }
```
`handleCurationCommand` runs the engine, and for non-empty proposals calls `buildCurationProposal` → `buildGovernanceRecommendation` + `buildEvidenceFromFindings` → `generateDecision`, printing the decision. For empty findings, prints "No curation findings" without calling A3.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/curation-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/evolution/knowledge/curation-cli.ts src/governance/evolution-cli.ts tests/evolution/knowledge/curation-cli.test.ts
git commit -m "feat(a6): wire curate CLI command"
```

---

### Task 8: Integration test — end-to-end

**Files:**
- Create: `tests/evolution/knowledge/integration/a6-curation-integration.test.ts`

**Interfaces:**
- Consumes: all Tasks 2-7 pieces wired together
- Produces: end-to-end proof that adapters → detectors → builder → A3 decision works

- [ ] **Step 1: Write the failing test**

Create `tests/evolution/knowledge/integration/a6-curation-integration.test.ts`:
- seed a temp learning store with a stale `LearningSignal` (old `generatedAt`) and a fresh one
- run `CurationEngine` with real adapters + all four detectors
- assert findings include the stale signal
- build the proposal + recommendation + evidence, call `generateDecision`
- assert the decision is a valid `GovernanceDecision` (has `decisionId`, `kind`, `confidence`)
- assert `buildCurationProposal([])` → null (no A3 call path)
- **a no-mutation snapshot**: before running the engine, snapshot the temp store dir listing + all file contents; after the full `curateAll` + proposal + decision flow, assert byte-identical — the entire A6 pipeline never writes to knowledge stores (the A-series invariant holds end-to-end)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test dist/tests/evolution/knowledge/integration/a6-curation-integration.test.js`
Expected: FAIL.

- [ ] **Step 3: Run with real adapters**

This is an integration test — implement by composing the already-tested pieces. It should pass once Tasks 2-7 are complete. If it fails, the failure is in composition (e.g. wrong config passed to a detector), not new logic.

- [ ] **Step 4: Run full A6 suite**

Run:
```bash
pnpm build && node --test dist/tests/evolution/knowledge/ --test-concurrency=1 --test-timeout=30000
```
Expected: all 10 A6 suites pass.

- [ ] **Step 5: Run the full evolution suite (regression)**

Run:
```bash
find dist/tests/evolution -name '*.test.js' -print0 | xargs -0 node --test --test-concurrency=1 --test-timeout=30000
```
Expected: all pass (should still be 806+ new A6 tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add tests/evolution/knowledge/integration/a6-curation-integration.test.ts
git commit -m "test(a6): add end-to-end curation integration test"
```

---

### Task 9: A6 closure — checkpoint + tag

**Files:**
- Create: `docs/architecture/checkpoints/2026-08-10-a6-knowledge-evolution-complete.md`
- Modify: `docs/roadmap/a-series-autonomous-evolution.md` (mark A6 complete)

**Interfaces:**
- Consumes: the completed A6 implementation + the `alix-a{0..5}-*-complete` tag convention (annotated tags, see P29/P30)

- [ ] **Step 1: Write the closure checkpoint**

Create `docs/architecture/checkpoints/2026-08-10-a6-knowledge-evolution-complete.md` following the A3/A4/A5 checkpoint format, verifying:
- A6 never writes to knowledge stores (adapters read-only, detectors pure)
- Zero-findings invariant (no proposal/no A3 call on empty)
- Determinism (pair canonicalization, timestamp exclusion)
- Contradiction limited to structured claims (no semantic inference)
- Store availability is diagnostic, not a finding

- [ ] **Step 2: Update the roadmap**

Modify `docs/roadmap/a-series-autonomous-evolution.md`: mark A6 ✅ Complete in the Frontier table, move it to the pipeline table.

- [ ] **Step 3: Tag**

```bash
git tag -a alix-a6-knowledge-evolution-complete -m "A6 Knowledge Evolution complete (closure checkpoint 2026-08-10)"
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/checkpoints/2026-08-10-a6-knowledge-evolution-complete.md docs/roadmap/a-series-autonomous-evolution.md
git commit -m "docs(a6): add closure checkpoint and tag A6 complete"
```

- [ ] **Step 5: Run detect_changes before final push**

Run `detect_changes()` (GitNexus) to verify the change surface is only A6 symbols, per the project rule.
