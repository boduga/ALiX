# ALiX — Document Migration Manifest

> Target (requires review, not unconditional):
> `docs/current/` ← `used:current`; `docs/superseded/` ← `used:superseded`;
> `docs/not-used/` ← `not-used`; plus `docs/audits/`.
> **Do not move files yet. Await explicit approval.** Preserve history with `git mv`.
> Preserve special-purpose dirs where tooling requires them (`adrs/`, `jev/`, per-subtree `AGENTS.md`).

## Proposed moves (summary from `document-classification.csv`)

| Destination | Rows | Example sources |
|---|---|---|
| `docs/current/` | 435 | `docs/roadmap/*`, `docs/architecture/{README,overview,ALiX_MASTER_ROADMAP,adrs/*,runtime-spine,…}`, `docs/capability-platform.md`, `docs/refactors/r*.md`, shipped specs/plans/checkpoints, `docs/jev/*`, root contracts |
| `docs/superseded/` | 335 | `docs/archive/**`, MVP specs, `STATUS.md`, `post-mvp-backlog.md`, MA0, A7 checkpoints, `docs/2026-10-*` handoffs |
| `docs/not-used/` | 71 | harness assessments, isolated research, unlinked diagrams — **review each: `proposed` future candidate vs `abandoned`** |

Per-file mapping (original → proposed, classification, reason) is the CSV itself
(columns `path`, `classification`, `lifecycle`, `disposition`, `evidence`).
Representative high-risk moves:

| Original | Proposed | Why |
|---|---|---|
| `docs/architecture/ma0-alix-architecture-2-0.md` | `docs/superseded/architecture/ma0-…` | Superseded by Master Roadmap `4ef20fba` |
| `docs/STATUS.md`, `docs/post-mvp-backlog.md` | `docs/superseded/…` | Retired headers; history only |
| `docs/2026-10-*-*.md` | `docs/superseded/handoffs/…` | History per `docs/AGENTS.md`; delete-not-move is also sanctioned ("Delete superseded records") — prefer move for auditability |
| `docs/archive/**` | `docs/superseded/archive/**` | Already archived; re-parent, keep subtree intact |

## References that would break

- `docs/architecture/README.md` → `overview.md`, `adrs/*` (relative links; safe if subtree moves together).
- `docs/roadmap/README.md` → `../architecture/ma0-…` (points at a superseded doc — update to Master Roadmap regardless of move).
- `docs/AGENTS.md` Child DOX Index (`superpowers/AGENTS.md`, `jev/AGENTS.md`, `agents/domain.md`) — path-sensitive; moving those dirs requires DOX pass.
- `AGENTS.md` + `src/**/AGENTS.md` reference `docs/architecture/overview.md`, `adrs/*`, `docs/superpowers/specs/*` by workspace-relative path (`pnpm check:dox` resolves them) — bulk move without link pass will fail `check:dox`.
- Inspector/UI and `scripts/check-dox-claims.mjs` embed doc paths — grep before move.
- ~146 spec/plan/checkpoint cross-links (`2026-07-*` family) reference siblings by relative path — move as intact subtrees.

Required link updates: run `pnpm check:dox` + `grep -rn "docs/architecture\|docs/roadmap\|docs/superpowers\|docs/refactors" AGENTS.md src/**/AGENTS.md docs scripts src/interfaces/ui` after any move; fix workspace-relative refs; re-run.

## Duplicates / overlaps

- `docs/reports/p18-*` vs `docs/architecture/reports/p18-*` — identical report in two trees; canonicalize to architecture copy.
- `docs/capability-platform*.md` (8 files: canonical + phase2…6.5) — keep all, canonical is `capability-platform.md`; add banner headers to phase files.
- `docs/architecture/specs/` vs `docs/superpowers/specs/` (P-slices vs CAP/R/TUI slices) — overlapping "spec" word, disjoint scopes; do not merge; disambiguate in `current/` README.
- `m-series-platform.md` M0.x tags vs absent tags — normalize doc, not move.

## Canonical replacements

- MA0 → `ALiX_MASTER_ROADMAP.md` + `overview.md`.
- A7.0/A7.1 checkpoints → `2026-08-14-capability-platform-greenfield-complete.md` + ADR-0013.
- EventLog-as-truth docs → R2 ledger docs (`r0-findings-r3-plan.md`, `overview.md`).
- MVP specs → roadmaps + ADRs + `CHANGELOG.md`.
- Python metric catalog section → TS `metric-registry.ts` + `MinimalMetrics`.

## Recommendation

1. Approve this manifest + CSV first; resolve the 71 `not-used` rows (proposed vs abandoned).
2. Land `docs/audits/` + CSV on `main` before any move.
3. If approved: `git mv` intact subtrees (`archive/`, `architecture/specs|plans|checkpoints`, `superpowers/`),
   update `docs/README.md` (new index: `current/`, `superseded/`, `not-used/`, `audits/` + tooling exceptions),
   run `pnpm check:dox`, keep `adrs/` + `AGENTS.md` paths stable where tooling pins them.
4. Do not rewrite old docs to match new decisions; add banners instead.
