# ALiX — Phase Registry

> Do not reuse an existing identifier for unrelated work.
> `AUT-*`, `SRAP-*`, `VOICE-*`, `EDGE-*`: **zero hits** in `docs/` — all four namespaces are free.
> Recommended future namespaces: `SRAP-*` (phone approval), `AUT-*` (autonomous OS),
> `VOICE-*` (wake-word), `EDGE-*` (distributed workers). Verify again at creation time.

| Identifier | Program | Purpose | First known | Status | Key docs / implementation | Conflicts |
|---|---|---|---|---|---|---|
| M0 (+m0.67–m0.9, M0.75, M0.77–M0.78) | M-Series | platform substrate | 2026-06-08 | Substantial | `docs/roadmap/m-series-platform.md`; kernel `8a355248…7e2f39b4`; ownership `d43d62b6` | `m09.*` wire strings (ADR-0014 frozen); claimed tags absent in clone |
| M1–M8 (M1.1–M1.9) | M-Series | runtime contracts → observability | 2026-07-10 | Substantial (M4/M5 Partial) | `plans/2026-07-10-m1-*`, `specs/2026-07-10-m1-*`, checkpoint `2026-07-10-m1-9-*` | — |
| M9 | M-Series | distributed/remote/federation | roadmap | 🔴 Not started | `m-series-platform.md`, `2026-08-29-milestone-verification.md §M9` | — |
| P0/P1 (post-MVP) | post-MVP backlog | P0.1 Context Compiler, P0.2 Edit Policy | `docs/post-mvp-backlog.md` | Complete (historical) | backlog :12-43 | collides with roadmap "P1–P3 do not exist" + local P0–P10 plan shorthands |
| P4–P30 | P-Series | product intelligence/governance | 2026-06-17 | ✅ Complete | `docs/roadmap/p-series-product-intelligence.md`; `specs/2026-07-*-p*`; `plans/2026-07-*-p*` | P7 ×3 (see below); P10.x frozen wire versions (ADR-0014) |
| P7 (roadmap) | P-Series | approval-rec persistence | roadmap | Complete | `p-series-*.md:20`, Master Roadmap | vs End-Product P7 vs ad-hoc `P7:` plan steps |
| P7 (End-Product) | End-Product | outcome intelligence (P7a ✅/P7b active/P7c deferred) | `docs/ALiX_End_Product_NonCode_Artifacts/11_P7_IMPLEMENTATION_PLAN.md` | Active | `alix decision outcome` CLI | same `P7` prefix, disjoint scope — highest confusion risk |
| P10.0–P10.10 | P-Series | executive slices | 2026-07 | Complete | `p10-8c*`, `p10-9*`, `p10-10*` specs | `p10.x` envelope versions now `executive_*_v1` dual-accept |
| X0–X4 (X1+X2 share plan) | X-Series | controlled execution | 2026-07-10 | ✅ Verified | `specs/2026-07-10-x0/x3a/x3b/x4-*`, `plans/2026-07-10-x1-x2/x3a/x3b/x4` | X0 spec exists, verification emphasizes X1–X4 |
| A0–A5 | A-Series | governed-evolution pipeline | 2026-07-10 | ✅ Complete | ADR-0006, `a-series-governed-evolution.md`, `a0/a1/a2` specs | doc title says A0–A5 while roadmaps say A0–A9 — scope footnote needed |
| A6–A9 | A-Series | knowledge/capability/learning/forecast | 2026-08 | ✅ Complete (self-directed eng. unbuilt) | checkpoints `2026-08-10-a6*`, `2026-08-14-a8*`, `2026-08-17-a9*` | `A9_*` frozen symbols in code/tests (ADR-0014) |
| CAP-1…12,N,O,P | Capability greenfield | single registry/provider model | 2026-08-10 | ✅ Shipped | `superpowers/specs/2026-08-10-capability-platform-*`, checkpoint `2026-08-14-*-complete.md` | vs `capability-platform-phase*` (different numbering, same words) |
| Capability Phase 2–6.5 | Capability TUI trace | timeline/trace/checkpoint/unification | 2026-07-31 | Landed increments | `docs/capability-platform-phase*.md` | see above |
| R0–R6 + R1.5 | R-Series refactor | audit→ports→ledger→coord→TUI→support→layout | 2026-10-07 | ✅ All done | `docs/refactors/r*.md`; `b15f3747,ca27b8e1,#868–877`; tags `r2–r5*` | R1 vs MA0 `R1.0 Experimental Planner` vs DeepSeek-R1 mention; R-series ≠ model R1 |
| PHASE 1–6 | Master Roadmap §9 | M→P→sealed P14–P30→X→A7→A8/A9 order | `ALiX_MASTER_ROADMAP.md` | Living (5/6 complete) | Master Roadmap §§9–10 | vs generic `Phase N` plan staging vs `P-N` milestones |
| Phase 0/1 (generic) | per-plan staging | local plan phases | various `superpowers/plans/*` | Local, not milestones | e.g. `2026-10-03-tui-workbench-preview-parity.md` | `Phase 1` hits ~25 docs — never cite bare |
| P0–P10 (agent-session-builder) | code-structure | 10 `initialize` phases → setup fns | `superpowers/plans/2026-07-25-agent-session-builder.md` | Local convention | plan :5,14 | not a milestone series |

## Rules for new work (Option B / SRAP)

1. Never mint `Phase 0/1` or `P0/P1` for SRAP — both collide. Use `SRAP-0…` / `SRAP-1…`.
2. Never mint `P7`, `R1`, `X*`, `A*`, `CAP-*`, `M*` for new scope.
3. Free and recommended: `SRAP-*` (approval protocol), `AUT-*` (autonomous OS substrate),
   `VOICE-*` (wake-word/audio), `EDGE-*` (workers/devices). Re-grep before first use:
   `grep -rE "SRAP-|AUT-|VOICE-|EDGE-" docs src tests --include="*.md" --include="*.ts"`.
4. Disambiguate End-Product P7 in prose as `End-Product P7 (outcome)` vs `Roadmap P7 (approval-rec)`.
