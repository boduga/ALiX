# ADR-0014 — Naming Convention: Milestone vs Domain Identifiers

**Status:** Accepted
**Date:** 2026-08-17
**Scope:** folder, filename, and symbol naming across `src/`, `tests/`, and docs; all milestones (A/P/CAP/M/X series)
**Context:** A9 verification + invariant audit (2026-08-17) surfaced the question "is it standard to use milestone names for function/variable names or folder names?" — with `src/evolution/a9/` as the visible case. This ADR records the convention and catalogs the current state.

---

## Context

A codebase that names things by *milestone* (A9, CAP-12, P25, M09…) instead of *domain* (forecast, capability, governance, metrics…) embeds program-schedule vocabulary into the code. Milestone names:
- **go stale** — A7 is the precedent: it was architecturally reset and superseded by greenfield (ADR-0013). Had there been an `a7/` folder, it would be a permanent lie. The roadmap docs for A8/A9 just carried a stale label ("Self-Directed Engineering") until corrected on 2026-08-17.
- **leak scope** — a milestone covers many domains; a folder named `a9` says "everything A9 owns" rather than what the code does.
- **force renames** — every new milestone re-brands, so milestone-named code churns.

Milestone identifiers are only *legitimately* load-bearing when they name a **cross-module ownership boundary** on a shared contract (e.g. `A9Forecast` is consumed by the TUI, capability platform, and governance CLI — the prefix is a namespace, not a label).

---

## Decision

### 1. Folders and filenames are named by DOMAIN, never by milestone

- A folder/file says **what the code does** (`src/evolution/forecast/`), not **which milestone built it** (`src/evolution/a9/`).
- This matches the existing majority: A8 lives in `src/evolution/learning/`, A5 in `src/evolution/observation/`, A2 in `src/evolution/verification/`, the P-series in `src/governance/`, `src/executive/`, etc. **No `a8/`, `a5/`, `a2/`, `p*/` folders exist.**
- `src/capability/` and its subfolders (`measurement/`, `evolution/`, `canonical/`, `governance/`) are domain names — `capability` is the domain word, not a milestone. **Compliant.**

### 2. Milestone prefixes on SHARED CONTRACT TYPES are renamed to domain when no collision

- The original rule allowed milestone prefixes on shared contract types (`A9Forecast`, `A5Measurement`, `A3DecisionSurface`, …) as a cross-module namespace. The 2026-08-18 sweep found **no type-name collisions** for the domain names (`Forecast`, `Correlation`, `Measurement`, `DecisionSurface`, `ForecastAdapter`), so the prefixes carried no disambiguation value — only schedule vocabulary — and the contracts were renamed to domain names.
- A milestone prefix on a shared contract is only justified when it resolves a genuine collision or names an externally-versioned schema boundary (`P14` audit contracts, `X4` runtime contracts remain precedent).

### 3. Milestone prefixes on constants / helpers / local functions are REDUNDANT when the folder already scopes them

- `A9_*` constants inside `src/evolution/a9/` duplicate the folder scope; `P28_FOOTER` in a governance report; `isA8Relevant`, `readP25Candidate`, `normalizeAllP13Outputs`, `defaultA7ProposalGenerator` are milestone-coupled where a domain name says the same thing. **Rename when touched** (see catalog).

### 4. Milestone-labeled TEST/verification artifacts are INTENTIONAL — keep

- `tests/evolution/a9-*.vitest.ts`, `tests/capability/cap-*.vitest.ts`, the sentinels — these are verification artifacts keyed to a milestone's acceptance criteria, referenced 1:1 by the invariant-audit catalog (`docs/architecture/checkpoints/2026-08-17-invariant-audit.md`). Renaming breaks the audit trail. **Keep as-is.** The convention is "milestone labels on *verification*, domain labels on *code*."

### 5. Adapters/bridges that target a milestone contract keep the TARGET name — unless the target itself is renamed

- `recommendationToA3Decision` named the `A3DecisionSurface` contract; with that contract renamed to `DecisionSurface` the bridge became `recommendationToDecision` (2026-08-18). `toA3`-style boundary functions follow the target's current name.

---

## Current-state catalog (2026-08-17, `main` `86947ed2`)

### A. Rename candidates — production code (blast radius in parentheses)

| Item | Proposed domain name | Blast radius |
|---|---|---|
| `src/evolution/a9/` folder | `src/evolution/forecast/` | 22 importers |
| `src/evolution/a9/a9-bridge.ts` | `bridge.ts` (in renamed folder) | part of the 22 |
| `src/evolution/a9/contracts/a9-contract.ts` | `contract.ts` | part of the 22 |
| `src/evolution/learning/a2-bridge.ts` | `governance-bridge.ts` | 4 |
| `src/evolution/observation/a5-capability-measurement.ts` | `capability-measurement.ts` | 10 |
| `src/capability/evolution/a7-proposals.ts` | `proposals.ts` | 10 |
| `src/capability/measurement/a5.ts` | `measurement-contract.ts` (or fold into module index) | 2 |
| `isA8Relevant` (TUI evolution-projection) | `isLearningRelevant` | 2 |
| `readP25Candidate` (governance-policy-review-outcome) | `readPolicyReviewCandidate` | 2 |
| `normalizeAllP13Outputs` (governance-signal) | `normalizeSignalOutputs` | 8 |
| `defaultA7ProposalGenerator` (capability/evolution) | `defaultCapabilityProposalGenerator` | 3 |
| `P28_FOOTER` (governance-explainability-report) | `EXPLAINABILITY_REPORT_FOOTER` | 13 |
| `M09MetricName/DurationName/CounterName` (kernel/minimal-metrics) | `MetricName/DurationName/CounterName` | 8 |

### B. Keep as-is

| Item | Why |
|---|---|
| `CAPABILITY_*` constants | `CAPABILITY` is the domain word, not a milestone |
| `tests/evolution/a9-*`, `a8-*`, `tests/capability/cap-*` | verification trail (§4) |
| `src/capability/` + subfolders | domain names (§1) |
| `A9_*` constants (51 uses) | redundant but high-blast-radius; fold into a folder rename, not standalone churn (§3, note) |

> Superseded 2026-08-18: `A9Forecast`/`A9Correlation`/`A9Adapter`/`A5Measurement`/`A3DecisionSurface` and `recommendationToA3Decision` were previously kept under §2/§5; the sweep renamed them to domain names (no collisions). See "Milestone-identifier sweep" below.

---

## Adoption rule (for new code)

- New folder / file: **name by domain.** If it's A-milestone work, the folder is `src/evolution/<domain>/` (mirrors A8/A5/A2).
- New shared contract type crossing module boundaries: **name by domain** unless a real collision or externally-versioned schema requires a namespace prefix.
- New test / sentinel: **may** carry the milestone label (it is a verification artifact).
- New constant / helper / local function: **no** milestone prefix — the folder scopes it.

## Consequence

Re-verification of the A-series labels in `docs/roadmap/` and `docs/architecture/ALiX_MASTER_ROADMAP.md` (done 2026-08-17, commit `e953a111`) and this ADR together establish the rule; renames are mechanical follow-ups triaged by blast radius (see A-catalog). Renames are executed with word-boundary bulk replacement + full `pnpm build`/test verification (GitNexus `rename` is not available in the CLI); each rename batch was compiler- and test-verified.

## Rename execution (2026-08-18)

All Section A catalog items executed with `git mv` + import updates (impact: LOW per GitNexus `impact`):

| Item | Result |
|---|---|
| `src/evolution/a9/` → `src/evolution/forecast/` | done |
| `a9-bridge.ts` → `bridge.ts` | done |
| `contracts/a9-contract.ts` → `contracts/contract.ts` | done |
| `a2-bridge.ts` → `governance-bridge.ts` | done |
| `a5-capability-measurement.ts` → `capability-measurement.ts` | done |
| `a7-proposals.ts` → `proposals.ts` | done |
| `measurement/a5.ts` → `measurement-contract.ts` | done |
| `isA8Relevant` → `isLearningRelevant` | done |
| `readP25Candidate` → `readPolicyReviewCandidate` | done |
| `normalizeAllP13Outputs` → `normalizeSignalOutputs` | done |
| `defaultA7ProposalGenerator` → `defaultCapabilityProposalGenerator` | done |
| `P28_FOOTER` → `EXPLAINABILITY_REPORT_FOOTER` | done |
| `M09MetricName/DurationName/CounterName` → `MetricName/DurationName/CounterName` | done |

Path-sentinel tests (`five-axis-sentinel.vitest.ts`, `cap-10-supersession.test.ts`, `a9-sentinel.vitest.ts`) updated to assert the new paths. Test file names (`a9-*.vitest.ts`, `cap-*.vitest.ts`) intentionally kept (§4).

## Milestone-identifier sweep (2026-08-18)

Full-repo identifier sweep beyond the Section A catalog — every milestone-prefixed identifier in `src/` declarations (`type`/`interface`/`class`/`const`/`function`/`enum`/fields/locals). Classified by §1–§5.

### Renamed (local identifiers — folder already scopes them)

| Old | New | Notes |
|---|---|---|
| `A5CapabilityMeasurement` (class) | `CapabilityMeasurement` | 27 refs |
| `A5CapabilityMeasurementOptions` | `CapabilityMeasurementOptions` | 2 refs |
| `A7ProposalGenerator` (class) | `CapabilityProposalGenerator` | 64 refs |
| `A7ProposalGeneratorOptions` | `CapabilityProposalGeneratorOptions` | 2 refs |
| `A9_FORECAST_VERSION` / `A9_CORRELATION_VERSION` / `A9_GENERATOR_VERSION` | `FORECAST_VERSION` / `CORRELATION_VERSION` / `GENERATOR_VERSION` | wire values unchanged |
| `A9_FORECAST_HORIZON_DAYS` | `FORECAST_HORIZON_DAYS` | |
| `A9_PROPOSAL_EVENT_PREFIX` / `A9_GOVERNANCE_NAMESPACE_PREFIX` / `A9_MEASUREMENT_EVENT_TYPE` | `PROPOSAL_EVENT_PREFIX` / `GOVERNANCE_NAMESPACE_PREFIX` / `MEASUREMENT_EVENT_TYPE` | |
| `P10_1_FACTORS` | `PRIORITY_FACTOR_DEFS` | |
| `p24BundlePath` (locals, 3 CLI files) | `bundlePath` | `--p24-bundle` flag kept (CLI contract) |
| `platform.a9` surface + `a9StoreDir`/`a9ProposalEvents`/`a9MeasurementEvents`/`a9Enriched`/`a9Forecasts`/`a5` locals + opts fields | `platform.forecast` / `storeDir` / `proposalEvents` / `measurementEvents` / `enriched` / `forecasts` / `measurement` / `capabilityMeasurement` | consumed by TUI + tests |
| `CapabilityMeasurementEngineOptions.a5` | `.measurement` | shared engine opts |
| `p18TracePresent` / `missingP18Visibility` / `requireP18Visibility` | `tracePresent` / `missingVisibility` / `requireVisibility` | readiness report/policy fields, in-memory only |
| `p22CalibrationCount` / `p23ReplayCount` | `calibrationCount` / `replayCount` | `PolicyDriftSignal.sampleSize`, in-memory diagnostic |
| `phasePresence.p24`…`p29` (LineageRecord) | `signal` / `candidate` / `outcome` / `trace` / `explanation` / `compliance` | builder + CLI + tests; CLI display labels `P24 (signal):`… kept as display text |
| TUI `EvolutionProjectionState.a8` | `learning` | `isA8Relevant`→`isLearningRelevant` already done; `sources.learning` already domain-named |
| `A9Forecast` / `A9ForecastKind` / `A9ForecastContent` | `Forecast` / `ForecastKind` / `ForecastContent` | shared forecast contract, 74/11/21 refs — renamed, no collision |
| `A9Correlation` / `A9CorrelationContent` | `Correlation` / `CorrelationContent` | shared correlation contract, 53/16 refs |
| `A9Adapter<T>` | `ForecastAdapter<T>` | shared adapter seam, 21 refs |
| `A5Measurement` / `A5MeasurementTarget` | `Measurement` / `MeasurementTarget` | shared measurement contract, 24/13 refs |
| `A3DecisionSurface` | `DecisionSurface` | 4 refs (forecast-cli) |
| `recommendationToA3Decision` | `recommendationToDecision` | §5 bridge, follows renamed target |

### Kept — no shared-contract namespace remains (§2)

The 2026-08-18 sweep found zero collisions for the domain names, so all former §2 shared-contract prefixes were renamed. §2 now applies only to genuinely versioned/foreign schema boundaries (e.g. `P14`/`X4`).

### Kept — data / format / CLI contracts (renaming breaks persisted data or parsers)

- `sourcePhase: "p13.1"…"p13.4"` values + `VALID_SOURCE_PHASES` — embedded in signal identity/dedup keys (`${sourcePhase}:${signalType}:${title}`).
- `source: "p22_calibration" | "p23_replay_diff" | "p23_candidate_lesson"` — `PolicyDriftEvidenceRef` data values.
- Hash salts `"p24"`, `"p27"`, audit tag `"p18_visibility_missing"`, disposition `"not_available_in_p19"` — wire/audit strings.
- Report delimiters `P24-CALIBRATION-START/END`, `P23-REPLAY-START/END` — output format contracts.
- CLI flag `--p24-bundle` — user-facing CLI contract.
- CLI display labels `P24 (signal):`…`P29 (compliance):`, `P22=`/`P23=`, section headers `P24 Signal:`… — display text (field access renamed, labels kept).
- Event/producer type strings `m09.metric`, `a9_pre_execution_risk_forecast`, `a8_organizational_learning`, telemetry namespace map `"m09."` → `"memory"`, SQL migration `0001_m09_kernel.sql` — persisted event-log / telemetry / migration contracts (renaming breaks history or parsers).
- Test-local constants (`A9_ROOT` etc. in `a9-sentinel.vitest.ts`), milestone-labeled test file names (§4).
