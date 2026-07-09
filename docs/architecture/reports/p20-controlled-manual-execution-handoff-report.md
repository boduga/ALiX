# P20 — Controlled Manual Execution Handoff

**Report Date:** 2026-07-09
**Status:** Sealed
**Tag:** `alix-p20-controlled-manual-execution-handoff-complete`

---

## Phase Summary

P20 turned readiness-approved P19 plans into **explicit, human-readable operator handoff packages** for manual execution, with evidence validation and post-action recording preparation. ALiX produces handoff packages — it never executes them.

The phase delivered **5 slices** across builder, evidence contract, recording preparation, report/CLI, and this checkpoint. Every slice enforces a hard no-autonomous-execution, no-persistence, no-tool-invocation boundary.

**Deliverable scope:** 5 source files, 4 test files, 1 CLI integration, **25 P20-specific tests**, 0 new store writes, 0 execution imports, 0 audit emitter imports.

---

## Delivered Pipeline

```
P19 readiness-approved plan → build package → validate evidence → prepare record → report
```

| Slice | Module | Tests | Role |
|-------|--------|-------|------|
| P20.1 | `handoff-builder.ts` | 7 | Convert readiness-approved plans to handoff packages |
| P20.2 | `handoff-evidence.ts` | 6 | Capture evidence refs with ISO timestamp validation |
| P20.3 | `handoff-recorder.ts` | 5 | Return P17-compatible execution attempt (no .append()) |
| P20.4 | `handoff-report.ts` + CLI | 7 | Derived-status handoff report + read-only CLI |
| P20.5 | Phase report + checkpoint | — | Seal documentation |

---

## Handoff Package Contract

Every handoff package is created with:

| Property | Value |
|----------|-------|
| `status` | `"pending"` (immutable — report state derived later) |
| `explicitlyManualOnly` | `true` |
| Evidence refs | Generated for mutating/manual actions |
| Operator instructions | Derived from simulation preconditions, risks, and rollback |

---

## Evidence Validation

| Rule | Behaviour |
|------|-----------|
| Required refs match | `valid: true` |
| Missing refs | `valid: false`, refs listed in `missingRefs` |
| Invalid `capturedAt` | Throws `HandoffEvidenceError` |
| Empty `capturedBy` | Throws `HandoffEvidenceError` |
| Extra refs | Ignored |

---

## Recording Boundary

`prepareHandoffRecord`:
- Validates evidence via P20.2
- Returns `GovernanceExecutionAttempt` object with `status: "succeeded"`
- Does **not** call `.append()` — the caller decides whether to persist

---

## CLI Surface

All commands require `--input <path>` and support `--json`:

| Command | Output |
|---------|--------|
| `alix governance handoff build <id> --input` | Handoff package |
| `alix governance handoff validate <id> --input --evidence` | Validation result |
| `alix governance handoff prepare-record <id> --input --evidence` | Execution attempt (stdout only) |
| `alix governance handoff report --input [--since] [--until]` | Derived-status report |

---

## No-Persistence No-Execution Evidence

| Invariant | Evidence |
|-----------|----------|
| No handoff store | `src/governance/handoff-store*` does not exist |
| No execution imports | 0 matches for `executeAction` across all P20 files |
| No tool/network/shell calls | 0 matches for `fetch`, `spawn`, `exec` |
| No audit emitter imports | 0 matches across all 4 P20 source files |
| No store writes | 0 matches for `.append(`, `.write(`, `.save(`, `.delete(` |
| `explicitlyManualOnly` | Always `true` on every handoff package |
| P19 readiness required | Builder rejects blocked decisions |
| P17 approval required | Pipeline validates approval correlation |
| `prepare-record` | Returns object, does not call `.append()` |

---

## Test Evidence

| Suite | Tests | Status |
|-------|-------|--------|
| P20.1 handoff-builder.test.ts | 7 | ✅ All pass |
| P20.2 handoff-evidence.test.ts | 6 | ✅ All pass |
| P20.3 handoff-recorder.test.ts | 5 | ✅ All pass |
| P20.4 handoff-report.test.ts | 7 | ✅ All pass |
| Full governance suite | all | ✅ All pass |
| TypeScript | — | ✅ Clean |

---

## Deferred Capabilities

| Capability | Rationale |
|-----------|-----------|
| Autonomous execution | Out of P20 scope — ALiX must never execute |
| Handoff persistence | Packages are immutable artifacts, not stores |
| Execution adapters | No shell/network/tool execution |
| `ExecutionStore.append()` | Caller decides whether to persist prepared records |
| Operator ranking | P20 surfaces no operator identity or ranking data |

---

## Final Seal

P20 — Controlled Manual Execution Handoff is sealed with the following evidence:

```text
P20.0 — Design Spec               ✅
P20.1 — Handoff Package Builder   ✅
P20.2 — Evidence Capture          ✅
P20.3 — Recording Preparation     ✅
P20.4 — Handoff Report + CLI      ✅
P20.5 — Checkpoint                ✅

TypeScript:                         clean
Governance tests:                   all passing
P20 tests (specific):               25/25 passing
No autonomous execution shipped:    verified
No handoff store exists:            verified
No execution adapter:               verified
No audit emitter imports:           verified
No operator ranking data:           verified
explicitlyManualOnly:               always true
Checkpoint tag:                     alix-p20-controlled-manual-execution-handoff-complete
```
