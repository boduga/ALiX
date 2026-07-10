# P28.4 — Governance Explainability Checkpoint

**Date:** 2026-07-09
**Phase:** P28 — Governance Explainability (Tasks 3-4)
**Branch:** (committed on P28.3)

---

## Implemented

### Task 3 — Report Renderer + CLI

| File | Purpose |
|---|---|
| `src/governance/governance-explainability-report.ts` | Text and JSON renderers converting `GovernanceExplanation` to output |
| `src/cli/commands/governance-explain.ts` | CLI handler for `alix governance explain trace <candidateId>` and `alix governance explain window` |
| `src/cli/commands/governance.ts` | Modified `case "explain"` dispatch to delegate to `governance-explain.ts` for `trace`/`window` subcommands |
| `tests/governance/governance-explainability-report.test.ts` | 15 tests: section ordering, footer, JSON, purity invariants |
| `tests/governance/governance-explain.test.ts` | 8 tests: trace/window output, JSON mode, unknown candidate, no-write invariant |

### Key Implementation Details

**Text Renderer (`renderExplanationText`):**
- Sections rendered in stable canonical order: `signal_origin` -> `candidate_lifecycle` -> `outcome_summary` -> `peer_comparison` -> `learning_synthesis`
- Absent sections silently skipped
- Delimiters: `P28-EXPLAIN-START` / `P28-EXPLAIN-END`
- Includes `P28_FOOTER` before end marker

**JSON Renderer (`renderExplanationJson`):**
- `JSON.stringify(explanation, null, 2)` — standard 2-space indentation
- Preserves all `GovernanceExplanation` fields including boundary flags

**CLI Handler (`handleGovernanceExplainCommand`):**
- `trace <candidateId> --p24-bundle <path> [--json]`: loads P24 bundle + P25 candidates + P26 outcomes, builds all traces via P27's `buildDriftOutcomeTraces`, filters to the requested candidate, builds peers from remaining traces, renders explanation
- `window --p24-bundle <path> [--json]`: loads same data, builds all traces, computes `DriftCorrelationAnalytics` via P27's `computeCorrelationAnalytics`, builds window explanation with single `learning_synthesis` section
- Read-only: no file-system writes in any P28 module

**Dispatch in `governance.ts`:**
- `case "explain"` now checks whether `rest[0]` is `"trace"` or `"window"` before delegating to the existing `runGovernanceExplain`
- Uses dynamic import pattern matching existing dispatch style (`await import("./governance-explain.js")`)

### Verification Checklist

- [x] TypeScript compilation (`npx tsc --noEmit`): clean
- [x] Report tests: 15/15 pass
  - [x] Text output starts with `P28-EXPLAIN-START`, ends with `P28-EXPLAIN-END`
  - [x] Subject rendered on its own line
  - [x] Sections in canonical order
  - [x] Missing sections (e.g., `peer_comparison`) silently skipped
  - [x] `P28_FOOTER` present before end marker
  - [x] Section body text rendered
  - [x] Data points rendered when present
  - [x] Evidence refs rendered when present
  - [x] JSON output parseable
  - [x] JSON preserves all top-level fields
  - [x] JSON preserves all sections and fields
  - [x] JSON indented with 2 spaces
  - [x] `P28_FOOTER` constant contains all expected sections
  - [x] `renderExplanationText` is pure (no mutation)
  - [x] `renderExplanationJson` is pure (no mutation)
- [x] CLI tests: 8/8 pass
  - [x] Usage returned when no subcommand given
  - [x] Error when `--p24-bundle` missing
  - [x] Trace subcommand renders valid explanation for known candidate
  - [x] Trace subcommand produces parseable JSON with `--json`
  - [x] Trace subcommand returns error for unknown candidate
  - [x] Window subcommand renders aggregated explanation
  - [x] Window subcommand produces parseable JSON with `--json`
  - [x] No-write invariant: no `.alix/governance/explain` directory created
- [x] `P28_FOOTER` contains all 4 required lines
- [x] No file-system writes in P28 modules
- [x] No ranking or prescriptive language (builder invariant, not rendered in report)

### Interfaces Consumed (Tasks 1-2)

- `GovernanceExplanation` from `../../governance/governance-explainability-types.js`
- `buildTraceExplanation(trace, peerGroup?)` from `../../governance/governance-explainability-builder.js`
- `buildWindowExplanation(traces, analytics)` from `../../governance/governance-explainability-builder.js`
- `computeCorrelationAnalytics(traces)` from P27's `../../governance/learning-synthesis-analytics.js`
- `buildDriftOutcomeTraces({ signals, candidates, outcomes })` from P27's CLI module

### Exported Functions

- `renderExplanationText(explanation: GovernanceExplanation): string` — terminal-safe text renderer with stable section order
- `renderExplanationJson(explanation: GovernanceExplanation): string` — indented JSON
- `handleGovernanceExplainCommand(args, opts): string` — sync CLI handler, returns string (caller prints)
- `P28_FOOTER` — constant string with governance boundary disclaimer

### Commit

```
57707bca feat(P28.3): governance explainability report + CLI — render explanations without writes
```
