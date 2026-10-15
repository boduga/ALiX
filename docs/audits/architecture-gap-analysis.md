# ALiX — Architecture Gap Analysis

> Code vs docs vs claims @ `3b9337de`. Classes: confirmed defect / documentation drift /
> historical difference / unimplemented capability / unverified claim / potential improvement.
> Do not replace stable working components without evidence — none proposed below.

## Findings

1. **Layering over-claimed (documentation drift, Medium)** — `overview.md` presents a strict 4-layer DAG,
   but `layer-boundaries.test.ts:16-34` pins only 3 edges (`experience-is-top`, `platform-not-upward`,
   `models-not-governance`); `operations` is explicitly unconstrained. Fix docs, not code: label
   `operations` cross-cutting and list exactly which edges are gated.
   Evidence: `docs/architecture/overview.md:97-131`, `tests/architecture/layer-boundaries.test.ts`.

2. **Duplicate approval stores coexist (historical difference, Medium)** —
   `governance/execution-approval-store.ts` (+`execution-store.ts`, `governance-store.ts`,
   `investigation-store.ts`, `remediation-store.ts`, P12/P17 domain artifacts) alongside R2
   ledger-backed `approvals/approval-store.ts` (runtime queue). Deliberate per `governance/audit/AGENTS.md`
   (audit NOT ledger-mirrored, R2.11 exception) but a newcomer can mistake the P17 plan store for the
   runtime queue. Improvement: banner headers + cross-links; **do not merge** without R-register change.

3. **Roadmap links to superseded MA0 (confirmed defect, Low risk)** —
   `docs/roadmap/README.md` → `../architecture/ma0-alix-architecture-2-0.md` (superseded `4ef20fba`).
   Fix: point to `ALiX_MASTER_ROADMAP.md` + `overview.md`.

4. **`docs/AGENTS.md` vs practice on handoffs (documentation drift, Low)** — AGENTS.md says
   "Delete superseded records"; 5 `docs/2026-10-*` handoffs accumulate. Either enforce deletion or
   amend to "move to `superseded/`". Recommend move (auditability).

5. **Metric registry split-brain (documentation drift, Low)** —
   `docs/observability/metric-registry.md:7` embeds superseded Python catalog next to live TS registry.
   Split or banner; canonical is `metric-registry.ts` + `MinimalMetrics` (`coordination/kernel/`).

6. **P7 ×3 namespace collision (confirmed defect, Medium)** — roadmap P7 vs End-Product P7
   (`ALiX_End_Product_NonCode_Artifacts/11_P7_IMPLEMENTATION_PLAN.md`) vs ad-hoc `P7:` plan steps.
   Rename in prose only (`End-Product P7 (outcome)` vs `Roadmap P7 (approval-rec)`); never reuse `P7`.

7. **Milestone-in-code residue (historical difference, Low)** — `A9_*/P28_*/p10.x/m09.*` symbols persist
   as frozen wire/display contracts per ADR-0014 while docs say renamed. Correct behavior; text search
   mixes live slices with frozen values. Improvement: `grep`-visible `FROZEN_CONTRACT` comments where missing.

8. **M0.x tag gap (unverified claim, Medium)** — `m-series-platform.md` claims `m0.67–m0.9` tags;
   `git tag -l "m0*"` empty in this clone; `alix-p*/a*` tags likewise absent (only `r2–r5`, backups present).
   Either tags live elsewhere or doc needs re-baselining (doc itself flags "untagged" + open normalization debt).

9. **No general sandbox (unimplemented capability, High relevance to SRAP)** — only skill `runSandboxed`
   (env-only fallback, "not a jail"), opt-in verifier isolation, and path containment
   (`WorkspacePathResolver`). Any remote-approval future must assume **local execution is unjailed**;
   authority must stay server-side. Evidence: `src/capabilities/skills/sandbox.ts:1-16,142-245`.

10. **Future proposals risk duplicating existing capabilities (potential improvement)** —
    - Second approval authority (SRAP must extend `ApprovalStore`+`ExecutionAuthorization`, not fork).
    - Second capability registry (ADR-0013 hard rule; CAP-11 deleted the last fork).
    - Second scheduler/completion/liveness verdict (R3 unified all three).
    - Second ledger/event truth (R2 append-is-commit; audit exception is deliberate).
    - Mobile/direct-authorize path bypassing `PolicyGate` (R1.5 fail-closed forbids).

## Implemented but undocumented / documented but absent (spot-checks)

- Implemented, thin docs: `ApprovalWatcher` + schedule materialization (daemon), `continuation-store.ts`
  revalidation (R1.5/R2.14), `session-ledger-reconcile.ts` drift reporting — covered in code AGENTS.md,
  missing from `overview.md` narrative.
- Documented, correctly absent: M9 distributed, A9 self-directed engineering, OpenTUI rollout,
  AFK/proactive autonomy, voice/wake-word, Rust services — all proposals or explicitly unbuilt; no drift.

## Priority fixes (docs-only, no prod-code change)

1. Roadmap README link (finding 3). 2. Operations-layer scoping note (1). 3. P7 disambiguation (6).
4. Approval-store banners (2). 5. Metric-registry split (5). 6. M0.x tag re-baseline (8).
