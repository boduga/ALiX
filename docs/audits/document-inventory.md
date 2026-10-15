# ALiX — Document Inventory & Classification

> Companion to `document-classification.csv` (841 rows: 833 under `docs/` + 8 root docs).
> Method: automated heuristic + manual verification of high-value paths.
> Values are exactly `used:current` / `used:superseded` / `not-used`.
> Lifecycle (advisory, alongside classification): `implemented` / `retired` / `proposed-or-unknown`.
> `not-used` ≠ worthless — a never-implemented proposal may still be the best future direction.

## Counts (provisional, heuristic)

| Classification | Rows | Share |
|---|---|---|
| `used:current` | 435 | 52% |
| `used:superseded` | 335 | 40% |
| `not-used` | 71 | 8% |

Confidence mix: High ~120 rows (explicit banners, live contracts, archive tree);
Medium ~650 rows (shipped-slice specs/plans/checkpoints, domain runbooks — spot-check vs code required);
Low ~71 rows (`not-used` provisional — requires implementation grep to resolve).

Full per-file fields in CSV: path, title, date, purpose, phase, classification,
confidence, evidence, superseded_by, implementation, lifecycle, disposition.

## What each category means

- **`used:current`** — authoritative now or accurately describes implemented functionality,
  active contracts, or accepted ongoing work (roadmaps, `overview.md`, ADRs, R-registers,
  shipped P/X/A/M specs+plans+checkpoints, CAP greenfield, active runbooks, Jev, root contracts).
- **`used:superseded`** — genuinely used then replaced (MVP specs, `STATUS.md`, `post-mvp-backlog.md`,
  MA0, A7.0/A7.1 checkpoints, `archive/legacy-nexus-os-v1.6/`, dated `docs/2026-10-*` handoffs
  which are history per `docs/AGENTS.md`). Preserve; identify superseder where possible.
- **`not-used`** — no reliable adoption evidence (research probes, harness assessments,
  unlinked diagrams, isolated proposals). Provisional Low confidence; record uncertainty +
  evidence needed rather than inventing history.

## Key authoritative documents (`used:current`, High)

- `docs/roadmap/README.md`, `m-series-platform.md`, `p-series-product-intelligence.md`,
  `a-series-autonomous-evolution.md`
- `docs/architecture/ALiX_MASTER_ROADMAP.md`, `README.md`, `overview.md`, `runtime-spine.md`,
  `governance-infrastructure.md`, `a-series-governed-evolution.md`, `eventlog-projection-architecture.md`,
  `patch-engine-protocol.md`, `provider-adapter-interface.md`, `frontend-transport.md`
- `docs/architecture/adrs/ADR-0001…0014` (0006 pipeline, 0013 capability/provider, 0014 naming)
- `docs/capability-platform.md` (canonical single-registry contract)
- `docs/refactors/r0-findings-r3-plan.md`, `r4-tui-projection-plan.md`, `r5-support-subsystem-plan.md`,
  `r6-physical-layout-plan.md`
- `docs/architecture/checkpoints/2026-08-29-milestone-verification.md`,
  `2026-08-17-invariant-audit.md`, `2026-08-14-capability-platform-greenfield-complete.md`
- Root `README.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `WORKSPACE_MAP.md`

## Key superseded (`used:superseded`, High)

| Document | Superseded by |
|---|---|
| `docs/STATUS.md` | `CHANGELOG.md` + issues (header says retired) |
| `docs/post-mvp-backlog.md` | shipped P/M work; historical reference only |
| `docs/implementation-plan.md`, `mvp-product-spec.md`, `PRD.md` | post-MVP P/M/X/A implementation |
| `docs/architecture/ma0-alix-architecture-2-0.md` | `ALiX_MASTER_ROADMAP.md` (header, commit `4ef20fba`) |
| `docs/architecture/checkpoints/2026-08-10-a7-*.md` | CAP-11 greenfield (`2026-08-14-capability-platform-greenfield-complete.md`) |
| `docs/archive/roadmap-legacy.md`, `decision-records.md`, `legacy-nexus-os-v1.6/` subtree | M/P/A + R-series present |
| `docs/2026-10-*-*.md` (5 handoffs) | later baseline; history per `docs/AGENTS.md` |
| `docs/observability/metric-registry.md` §Python catalog | TS registry (file §7 notes superseded) |

## `not-used` (provisional — verify before discarding)

Examples: `docs/ALiX-ExecutionState-Architecture.md`, `docs/ALiX-full-flow.drawio(.png)`,
`docs/agentic-harness-research.md`, `docs/alix-harness-assessment-2026-07-08.md`,
isolated `research/wf-*`, unlinked diagrams. Each CSV row lists the evidence gap
(e.g. "no implementation grep hit; check `src/` + git log before reclassifying").
Lifecycle `proposed-or-unknown` prevents mistaking them for discarded ideas.

## Conflicts / splits needed

- `docs/capability-platform-phase2…6.5.md` (7 files): each a landed increment, no banner.
  Keep as history (`used:current`, Medium) with `capability-platform.md` canonical; do not merge silently.
- `docs/observability/metric-registry.md`: authoritative + obsolete in one file → split or
  banner the Python section; canonical is TS `metric-registry.ts` + `MinimalMetrics`.
- `docs/security/*`: live architecture + legacy-migration notes interleaved → banner legacy blocks.
- End-Product P7 (`docs/ALiX_End_Product_NonCode_Artifacts/11_P7_IMPLEMENTATION_PLAN.md`):
  active slice (P7a ✅/P7b active/P7c deferred) but isolated from roadmap P7 — keep, disambiguate name.
- `docs/reports/p18-workbench-lifecycle-operations-report.md` duplicates
  `docs/architecture/reports/p18-*` — keep one canonical, cross-link other.

## How to resolve Low-confidence rows

1. `grep -r "< distinctive symbol >" src tests --include="*.ts"` + `git log --oneline -- <doc>`.
2. If code+test hit → promote to `used:current` (implemented).
3. If replaced-doc reference + absence in code → `used:superseded` + superseder.
4. If neither → keep `not-used`, set lifecycle `proposed` (future candidate) vs `abandoned`
   based on author intent + roadmap links. Do not delete.
