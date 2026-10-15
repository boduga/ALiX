# ALiX — Architecture Trajectory

> Audit artifact. Evidence-based reconstruction from `main` @ `3b9337de` (2026-10-14).
> 3410 commits, 2026-05-12 → 2026-10-14. Primary refs: source, `docs/roadmap/*`,
> `docs/architecture/*`, `docs/refactors/*`, `CHANGELOG.md`, tags.
> Confidence: High where commit + doc + code agree; Medium where doc-only; Low where inferred.
> `2026-10-14-srap-option-b-design.md`: **not present** — SRAP assessment is readiness-only.

## Timeline

### 0. Foundation — pre-series (2026-05-12 → 06-08) — Completed, superseded in parts

- Objective: MVP agent loop: config, policy+approvals, patch primitives, event JSONL, inspector.
- Evidence: `c977cdbe` event kernel, `e8384bf4` policy+approvals, `ec00b4bd` patch,
  `61a6cf1d` inspector; 12-provider abstraction `9033720a`; agent loop `b019abfb`;
  MCP `d1dadda3…2e8046d2`; ADR-0001/0002 `48a4c3b8,4c8f7a45` (`docs/architecture/adrs/`).
- Superseded: `docs/STATUS.md` (retired 2026-05-24, pointer to CHANGELOG+issues);
  `docs/implementation-plan.md`, `docs/mvp-product-spec.md`, `docs/PRD.md` (Node-24/mock era).

### 1. M-series Platform (2026-06-08 → ongoing) — Substantial, M9 not started

- Objective: domain-neutral substrate; dependency direction M→P→A (later M→P→X→A).
- Evidence: M0.9 kernel (`8a355248,fd96870f,e6b856e0,220cc62f`, hardened `c6e1a3ee/b206e24c`,
  recorded `7e2f39b4`); policy `f4be67fe`→`RuntimeGate`→`ExecutionAuthorization 29837d67`
  (`CapabilityResolver→PolicyGate→ApprovalStore→OwnershipGate→Audit`); approvals store
  `bf8bc96b`; daemon `a6fe5669`; ownership `d43d62b6` (M0.75, 81 tests);
  coordination M0.77b-f (`a5540d37,28b0a088,074c31fc,780b4ee7`); M1 contracts
  `8580ccd1,de180398,a2a6c9db…e79cffbc` + checkpoint
  `docs/architecture/checkpoints/2026-07-10-m1-9-runtime-contract-standardization-checkpoint.md`.
- Canonical: `docs/roadmap/m-series-platform.md` (M0–M8 Substantial, M9 🔴 Not started),
  `docs/roadmap/README.md`.
- Open debt: M0.x `m0.67–m0.9` tags claimed in roadmap but absent in this clone
  (`git tag -l "m0*"` empty); M0.75 plan lives under `docs/archive/superpowers/`.

### 2. MA0 → Master Roadmap pivot (2026-06-27 → 07-10) — MA0 superseded

- `3c22aba2` MA0 canonical M/P/A tree (`docs/architecture/ma0-alix-architecture-2-0.md`).
- `9b0794a5` adds X-series → M→P→X→A (`docs/architecture/ALiX_MASTER_ROADMAP.md`).
- `4ef20fba`: MA0 header marked **SUPERSEDED** by Master Roadmap. Live: Master Roadmap +
  `docs/architecture/overview.md` (post-R0–R6).

### 3. P-series Product Intelligence (2026-06-17 → 07-10) — Complete P4–P30

- P4 observability/security/evidence/workflow; P5 adaptation (`a790d3be…f74c4b57`,
  CHANGELOG v0.5.0 2026-06-20, invariants Generate≠Approve≠Apply≠Mutate);
  P6 `Recommend≠Decide`; P10 executive → P30 lineage (`f8021fb3…4a7e7ec0`).
- Evidence: `docs/architecture/specs/2026-07-*-p*.md` (~70 files),
  `docs/architecture/plans/2026-07-*-p*.md` (74 files),
  `docs/architecture/checkpoints/2026-07-*.md`,
  `docs/roadmap/p-series-product-intelligence.md` (P30 head).
- Note: P1–P3 do not exist by design; P0/P1 in `docs/post-mvp-backlog.md` are
  post-MVP enablers (Complete, historical only), not roadmap milestones.

### 4. X-series Controlled Execution (2026-07-10) — Complete X0–X4

- Order X0→X1/X2→X3a/X3b→X4. X0 immutable `ExecutionIntent` (`55e4c215`);
  X1 intent (`15022524`)+X2 governor (`1dae7c19`, plan `99c8381b`);
  X3a bridge (`ef99a7ee`); X3b store (`4469e60b,842ddc50`); X4 runtime
  (`c2514aaa…45e83d66`: state machine, retry, cancel, rollback-as-governed-execution, persistence).
- Why: separate safe approved-work execution from intelligence (P) and self-change (A).

### 5. A-series Governed Evolution (2026-07-10 → 08-17) — Complete A0–A9

- Pipeline Observe→Discover→Verify→Govern→Execute→Observe
  (ADR-0006 `docs/architecture/adrs/ADR-0006-a-series-governed-evolution-pipeline.md`,
  `docs/architecture/a-series-governed-evolution.md`).
- A0 contract → A5 observation (`82a7ab88…20c7e1ec`); A6 knowledge (`9bf7902f…57e40868`);
  **A7.0+A7.1 completed then SUPERSEDED** by ADR-0013 greenfield (checkpoints marked superseded);
  A8 learning PR #525; A9 forecast PR #552 (self-directed engineering explicitly unbuilt).
- Naming cleanup ADR-0014 `4fa13ddf` (2026-08-18): `a9/→forecast/`, milestone prefixes → domain names.

### 6. Capability Platform greenfield (2026-07-31 → 08-15) — Shipped, supersedes A7 split-registry

- ADR-0013 (2026-08-10): one registry, semantic identity,
  providers `native|tool|mcp|external-cli|daemon|agent|plugin|remote-api`.
- CAP-1…12,N,O,P (`25441bf1…35f90b33`); closeout
  `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md`
  (67 files/552 tests, 19/19 criteria). CAP-11 deleted `APPROVED_PENDING_APPLICATION`.
- Supersedes: A7.0/A7.1 split-registry model.

### 7. R-series Consolidation (2026-10-07 → 10-09) — Complete R0–R6 (+R1.5)

- Register `docs/refactors/r0-findings-r3-plan.md` (+r4/r5/r6 plans); gates
  `tests/architecture/r1-boundary-freeze.test.ts`, `layer-boundaries.test.ts`, `r15-authorization.test.ts`.
- R1 ports `b15f3747` (contracts + shrink-only freeze); R1.5 `ca27b8e1` fail-closed
  (`enforceCapabilities` ON, `authorizationSource`, continuation revalidation);
  R2 ledger strangler `80b8973f…d4c30b6b` (R2.12 baseline `b1799133`, R2.18 session `d4c30b6b`;
  tags `r2-ledger-baseline, r2-ledger-authoritative`);
  R3 coordination `3dcf0d3d…daae5e04` (R3.1 deletes `orchestrator/`, R3.7 adapts GraphExecutor);
  R4 projection `3616002f` PR #870; R5 support `674f7883` PR #871;
  R6 layout `234f2676` PR #876/#877: 65 dirs → **12 subsystems**, zero behavior change.
- Tags present: `r2-ledger-baseline/authoritative, r3-consolidation/complete,
  r3-graph-executor-adapt, r4-complete, r5-complete, backup/r1-original`.

### 8. Session / persistence (evolving) — Current: R2.18 ledger-authoritative

- ADR-0008 `92b4fc59` (2026-07-13): `.alix/sessions/<uuid>/{messages.jsonl,scope.json,state.json,events.jsonl,plan.md}`
  append-first + atomic snapshots. M0.61 TUI persistence `917cde19`;
  R2.18 `d4c30b6b` (append-first via `appendFact`, JSON as tolerated projection);
  Phase 5.5 non-interactive `07e8c452` PR #894 (`src/session/persist.ts`, `resume.ts`,
  `session-ledger-reconcile.ts`).

### 9. Workbench / TUI → OpenTUI (default still ANSI) — Active migration, supersedes nothing yet

- TUI spec 2026-05-24 → merged `43f8301d`; Ink `76249e2b`; daemon-first `db3bdbf4`;
  ApprovalManager `a6f07995`; P18 CLI `227a9891`; semantic transcript `f230853c` #657;
  multi-agent nav `2eebea06,4b3d595f` #794; parity plan `ba40acb8`→`7db0e370` #850;
  polish `3dc52f99,8814a1d2` #937.
- OpenTUI design `docs/superpowers/specs/2026-10-09-opentui-workbench-migration-design.md`
  (approved 10-10, ANSI default, `--experimental-ffi`, Node ≥26.4); spikes
  `df4f5865` #898 → `5b311823` #907; handoffs `docs/2026-10-*.md`.
- Status: parallel renderer; rollout decision pending.

## Major pivots

| Pivot | Why (evidence-backed) |
|---|---|
| MA0 → Master Roadmap (+X-series) | Needed controlled-execution layer between intelligence and evolution (`9b0794a5`) |
| A7 split-registry → CAP greenfield | Two registries violated single-authority; ADR-0013 unified (CAP-11 deletion) |
| EventLog/snapshot-ahead → R2 ledger | 13 truth stores + 11 bypasses (R0 audit); append-is-commit per domain |
| 65 dirs → 12 subsystems (R6) | Boundary drift; physical layout now matches `overview.md` authorities |
| ANSI → OpenTUI (pending) | Native layout/input/mouse; ANSI retained as default until parity proven |

## What was completed / abandoned / partial

- Completed: M0–M8 substrate, P4–P30, X0–X4, A0–A9, CAP-1…P, R0–R6, session R2.18.
- Abandoned/superseded: Nexus OS v1.6 tree (`docs/archive/legacy-nexus-os-v1.6/`),
  MA0, A7.0/A7.1 split model, `APPROVED_PENDING_APPLICATION`, EventLog-as-truth,
  `orchestrator/`, `runtime-snapshot.ts/store.ts`, MVP specs.
- Partial/future: M9 distributed (Not started), A9 self-directed engineering (unbuilt),
  OpenTUI rollout, End-Product P7b/c (active/deferred), AFK/voice/edge (no evidence).
