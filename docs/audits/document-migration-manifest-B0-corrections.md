# ALiX — Document Migration Manifest, B0 Corrections (executed 2026-10-15)

> Status: **executed on branch `docs/b0-classification-corrections`** (from merged `main` post-PR-#941).
> Companion to `document-migration-manifest.md` and `document-classification.csv`.
> B0 is the prerequisite correction pass: fix confirmed classification errors BEFORE any
> physical move (B1+). No `git mv` executed. No production code or tests touched.
> Row count stays **841**; audit artifacts are registered here, not added as CSV rows.

## Method

Revalidated the low-confidence `not-used` rows against the DOX chain, source, and inbound
references. Evidence = inbound reference from a load-bearing file (root `AGENTS.md`, an
`AGENTS.md` child index, a test/tool import) or a live-contract statement inside the doc.
The CSV heuristic missed these because it keyed on implementation grep, not reference graph.

## Applied — reclassified `not-used` → `used:current` (8 rows)

| # | Path | Evidence | `lifecycle` |
|---|------|----------|-------------|
| 1 | `docs/README.md` | Docs index; referenced by `docs/architecture/plans/2026-07-04-p12-2-risk-scoring.md`, `tests/verifier/change-classifier.test.ts`, `tests/governance/risk-scoring.test.ts`, and two `docs/archive/superpowers/*` | `implemented` |
| 2 | `docs/agents/domain.md` | Root `AGENTS.md:209` ("See `docs/agents/domain.md`") | `implemented` |
| 3 | `docs/agents/issue-tracker.md` | Root `AGENTS.md:201` | `implemented` |
| 4 | `docs/agents/triage-labels.md` | Root `AGENTS.md:205` | `implemented` |
| 5 | `docs/superpowers/AGENTS.md` | DOX child doc; indexed by `docs/AGENTS.md` and root `AGENTS.md` | `implemented` |
| 6 | `docs/dox-executor-id-baseline.txt` | Consumed by `scripts/check-dox-claims.mjs` (`BASELINE_PATH`); CI gate input | `implemented` |
| 7 | `docs/governance/governance-model.md` | "Part of: P5.7e Documentation Freeze" header; invariant table (Generate≠Approve, Approve≠Apply, …) matches the R1.5 fail-closed contract; linked from `docs/README.md` Governance Model row | `implemented` |
| 8 | `docs/governance/adaptation-lifecycle.md` | "Part of: P5.7e Documentation Freeze" header; proposal status flow; cross-linked to governance-model and operational-runbook; linked from `docs/README.md` Integrator row | `implemented` |

**Disposition for all eight:** `docs/current/ (keep in place; load-bearing - do not relocate).`
Confidence raised Low → High with per-row evidence above. Counts now
`used:current` 443 / `used:superseded` 335 / `not-used` 63 (was 435/335/71).

## Investigated — held provisional (NOT reclassified)

| Path | Direct read | Why held |
|------|-------------|----------|
| `docs/governance/capability-evolution-lifecycle.md` | "Part of: P5.7e Documentation Freeze"; See-also chain to adaptation-lifecycle/governance-model; capability lifecycle states | Inbound refs only from `docs/archive/superpowers/*`; no load-bearing inbound. Same family profile is not adoption evidence. |
| `docs/governance/mutation-path-audit.md` | "Part of: P5.7a Governance Invariant Audit"; self-claims "Canonical reference for: governance-model.md, operational-runbook.md" | Self-claim ≠ inbound adoption; inbound refs only from archive. A doc calling itself canonical does not make it current. |

Both stay `not-used` / `proposed-or-unknown` until inbound adoption or implementation linkage is shown.

## Preserve uncertainty — the remaining `not-used` rows

63 rows remain `not-used` / `proposed-or-unknown`. Per the handoff, lifecycle
(`proposed` vs `abandoned`) stays separate from usage classification. No disposition
change and no move for these 63 until per-row resolution (Workstream B5).

## `docs/audits/` registration (no CSV expansion)

The nine audit artifacts plus this manifest are the permanent evidence/reconciliation
directory (per `docs/AGENTS.md`). They are registered **here, not as CSV rows** —
expanding the 841-row inventory scope would corrupt the audit's fixed baseline.

## Validation (B0)

1. `python3 csv` parse: 841 rows, 12 cols, header intact, unique paths, classification domain clean; counts 443/335/63 match `document-inventory.md`.
2. Reference re-checks for all 8 promoted paths re-run; each resolves.
3. `pnpm check:dox` exit 0; `git diff --check` clean.
4. Rollback: revert this commit — no filesystem change to undo.

## Still blocked / not approved

- Any `git mv` (B1 archive moves, B2 handoffs, B3 MVP specs, B4 subtree moves) — **not approved.**
- SRAP-1 implementation — design reconciliation delivered; implementation stays gated
  on explicit approval. The design document remains untracked by separate decision.
