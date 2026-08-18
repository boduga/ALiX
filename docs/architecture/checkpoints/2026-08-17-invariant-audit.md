# Repository-Wide Invariant Audit

**Date:** 2026-08-17
**Purpose:** Independent, read-only audit of every recorded architectural invariant across the ALiX repository — cataloging source-of-truth, enforcement, and coverage, and adjudicating count discrepancies. No source files modified.

Method: source + doc analysis, full sentinel-suite re-run, targeted file verification.

---

## 1. Executive summary

- **No single central invariants registry exists.** Invariants are scattered across spec/plan/ADR/checkpoint docs, one `.git/sdd` security file, and the out-of-tree memory dir (locked rulings for A9/CAP-N/O/P).
- **Enforcement is strong and green:** **32 sentinel files / 345 sentinel tests pass**, plus the full vitest suite (**488 files / 5196 tests / 0 failed**) and a clean typecheck (0 errors).
- **Three count discrepancies adjudicated** (§4): A9 16-vs-10 (superset), security 12-vs-10 (enforced vs mirror), capability 10-vs-5 (full vs condensed). None is a functional conflict.
- **Three findings** (§5): a phantom sentinel reference, a misleading sentinel header, and CAP-6's sentinel-less enforcement. All non-blocking.

---

## 2. Invariant sets catalog

### 2.1 A-series evolution (A8, A9)

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| A9 spec §48 | `docs/superpowers/specs/2026-08-15-a9-forecast-calibration-and-provenance-design.md:2033` | **16** | `tests/evolution/a9-sentinel.vitest.ts` (12) + `a9-{contracts,identity,correlation,governance,persistence}.vitest.ts` | ✅ 16/16 verified (checkpoint `2026-08-17-a9-full-verification.md`) |
| A9 #546 grilling | memory `a9-546-grilling-locked.md` (out-of-tree) | 10 | subset of the 16 | ✅ subset |
| A9 plan §37 closeout | `docs/superpowers/plans/2026-08-15-a9-forecast-calibration-and-provenance.md:1907` | 10 | subset of the 16 | ✅ subset |
| A8 checkpoint rulings | `docs/architecture/checkpoints/2026-08-14-a8-organizational-learning-complete.md:104` | **12** (8 wayfinder + 4 spec) | `tests/evolution/a8-sentinel.vitest.ts` + `tests/learning/{learning,adapter-purity,evidence-chain}-sentinels.vitest.ts` | ✅ |
| A8 HARD sentinel pins | A8 checkpoint `:86` | 3 | `a8-sentinel.vitest.ts` | ✅ |

### 2.2 Capability platform (CAP-6 … CAP-12, CAP-P)

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| Greenfield §77 Critical | `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md:2470` | **10** | `five-axis`/`three-axis`/`single-registry` sentinels | ✅ |
| Greenfield reconciled §2 Core | `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md:37` | 5 | condensed §77 | ✅ |
| CAP-12 | `docs/superpowers/plans/2026-08-14-cap-12-end-to-end-capability-evolution.md:17` | **7** | `tests/capability/cap-12-sentinel.vitest.ts` | ✅ |
| CAP-9 (A7) | `docs/superpowers/plans/2026-08-13-cap-9-a7-proposal-integration.md:25` | 5 + 23 rulings | `a7-proposals.vitest.ts` + `cap-9-supersession.test.ts` | ⚠️ phantom four-axis ref (§5) |
| CAP-10 (A5) | `docs/superpowers/plans/2026-08-13-cap-10-a5-measurement-integration.md:43` | 5 + 23 rulings | `five-axis-sentinel.vitest.ts` + `cap-10-supersession.test.ts` | ⚠️ header overstates scope (§5) |
| CAP-10.5 | `docs/superpowers/plans/2026-08-14-cap-10-5-evolution-signal-emission.md:11` (11 constraints) + Task 8 (6 axes) | 6 sentinel axes | `tests/capability/cap-10-5-emission-sentinel.vitest.ts` | ✅ |
| CAP-8 | `docs/superpowers/plans/2026-08-12-cap-8-capability-service-surface.md` (12 rulings) | 12 | `three-axis-sentinel.vitest.ts` + `cap-8-supersession.test.ts` | ✅ |
| CAP-6 (A4 executor) | `docs/superpowers/plans/2026-08-11-cap-6-a4-capability-mutation-executor.md:1911,1914` | 2 locked + 9 deviations | `mutation-contract*.vitest.ts` + `mutation-port.vitest.ts` | ⚠️ no dedicated sentinel (§5) |
| CAP-11 | `docs/superpowers/specs/2026-08-14-cap-11-remove-legacy-capability-surfaces-design.md:45` | 6 | `cap-11-structural-cleanup-sentinel.vitest.ts` | ✅ |
| CAP-P frozen | `docs/architecture/checkpoints/2026-08-15-cap-p-consolidation-execution-complete.md:64` | 6 | `cap-p-consolidate-execution.vitest.ts` (9 sentinels) | ✅ |
| CAP-P discriminator | CAP-P checkpoint `:98` | 5 cells | cap-p + cap-n + cap-o tests | ✅ 5/5 |
| CAP-O guard | `docs/superpowers/plans/2026-08-14-cap-o-underperformer-update-path.md:31` | 1 | `cap-o-sentinel.vitest.ts` (3 axes) | ✅ |

### 2.3 Security

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| Security track | `.git/sdd/task-s0-invariants.md:1` | **12** (non-negotiable) | `tests/security/redaction/*.test.ts`, `secret-scanner.test.ts`, `path-assert.vitest.ts` | ✅ enforced |
| Security architecture | `docs/security/architecture.md:236` | 10 | **documented mirror** | ⚠️ documented-only (§4.2) |

### 2.4 Governance (top-level)

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| Governance guarantees | `README.md:47` | 5 | `tests/adaptation/*-sentinels.vitest.ts` (9) + `tests/governance/*-sentinels.vitest.ts` (2) | ✅ |
| Governance invariants | `CHANGELOG.md:17` | 5 | (verbatim duplicate of README) | ✅ same set |

### 2.5 Evolution verification model

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| ADR-0011 | `docs/architecture/adrs/ADR-0011-evolution-verification-model.md:143` | **7** | indirect via `tests/evolution/` + `tests/verification/` | ⚠️ no dedicated sentinel (§5) |

### 2.6 Agent / tool surface

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| Canonical agent surface | `docs/superpowers/plans/2026-08-16-canonical-agent-surface.md:1944` | 16 (INV-1…16) | `tests/agents/agent-taxonomy-sentinel.vitest.ts` | ✅ |
| Tool-capability taxonomy | `docs/superpowers/plans/2026-08-16-tool-capability-taxonomy-unification.md:52` | 10 (INV-1…10) | `tests/tools/taxonomy-sentinel.vitest.ts` | ✅ |

### 2.7 Intent-contract / TUI

| Set | Source (file:line) | Count | Enforcement | Status |
|-----|--------------------|-------|-------------|--------|
| Intent closed-world | `docs/intent-contracts/canonical-taxonomy.md:182`, `layer-2-gate.md:53`, `agent-loop-mode.md:201` | 1 (8 intents) | `tests/runtime/action-classifier.test.ts` | ✅ |
| TUI alignment | `docs/superpowers/specs/2026-07-17-tui-alignment-design.md:42,447,610` | 8 + 5 + 6 | TUI tests + lint (render purity, widgets-never-fetch) | ✅ |
| TUI sidebar | `docs/superpowers/specs/2026-07-23-tui-sidebar-revival-design.md:605` | 8 | TUI tests | ✅ |

---

## 3. Enforcement status (sentinel suite)

Full sentinel re-run: **32 files, 345 tests, 0 failed** (all capability/evolution/adaptation/governance/learning/agents/tools/explain/baseline/executive/chat sentinels). Plus `tests/config/model-invariant.test.ts` (node test, model/provider identity).

The `governance-sentinel-retired.vitest.ts` file is a retired-marker (skipped, not failing) — the retired lens-calibration path it guards was superseded; it remains as a tombstone, correctly skipped.

---

## 4. Discrepancy adjudications

### 4.1 A9 16-vs-10 (RESOLVED — superset, no conflict)

- Spec §48 defines **16**. Plan §37 closeout + #546 grilling define **10**.
- The 16 are a **strict superset**: #1–10 are identical to the closeout's 10; #11–16 (deterministic, availability-as-fact, never-modifies-foreign, capability≠provenance, execution≠causality, A3-sovereign) are additive.
- **Ruling:** spec §48's **16 is authoritative** (post-implementation contract). The 10 was the merge-time subset. Verified 16/16 in the A9 full-verification checkpoint. No action needed beyond documenting.

### 4.2 Security 12-vs-10 (RESOLVED — enforced vs mirror)

- `.git/sdd/task-s0-invariants.md` = **12** (the enforced security-hardening track with behavioral tests).
- `docs/security/architecture.md:236` = **10** (a higher-level documentation summary of the same posture; items overlap but don't map 1:1 — e.g. s0's "same bytes", "serialized audit append", "exact artifact", "closed metrics vocabulary", "fail closed" have no architecture.md counterpart; architecture.md's "loopback by default" has no s0 counterpart).
- **Ruling:** the **12-item s0 list is authoritative** (it is the test-enforced track). The architecture.md 10-item list is a design doc that predates/overlaps. **Recommendation:** reconcile `docs/security/architecture.md:236` to either reference the s0 list or clearly mark itself as a non-enforced summary (LOW, doc-only).

### 4.3 Capability 10-vs-5 (RESOLVED — full vs condensed, no conflict)

- Greenfield §77 = **10 Critical Invariants** (one definition universe … measurement observational).
- Reconciled program §2 = **5 Core invariants** — a condensation of §77 (one canonical universe, three independent axes, kind-is-semantic, A4-only mutation, registries-as-projections).
- **Ruling:** **§77's 10 is the full set**; §2's 5 is the distilled summary both trace to ADR-0013 + locked decisions #473–#482. No conflict; the 5 are a subset framing.

---

## 5. Findings

1. **[MEDIUM] Phantom `four-axis-sentinel.vitest.ts` (CAP-9).** `docs/superpowers/plans/2026-08-13-cap-9-a7-proposal-integration.md:17` references a `four-axis-sentinel.vitest.ts` that **does not exist**. CAP-9's axis-4 purity is actually enforced inline via `tests/capability/a7-proposals.vitest.ts` + `cap-9-supersession.test.ts`. **Impact:** a reader following the plan will look for a file that isn't there. **Fix:** either create the dedicated four-axis sentinel or correct the plan reference (doc-only, LOW effort).

2. **[LOW] Five-axis sentinel header overstates scope.** `tests/capability/five-axis-sentinel.vitest.ts:44` describes itself as "CAP-8/9 axes 1-4 + CAP-10 axis 5" but implements only **axes 1, 4, 5**. Axes 2 (import boundary) and 3 (CLI call sites) live solely in the CAP-8 `three-axis-sentinel.vitest.ts`. Coverage is complete (no gap), but the header misleads. **Fix:** correct the header comment to "axes 1, 4, 5 (2/3 covered by three-axis sentinel)" (doc-only).

3. **[LOW] CAP-6 has no dedicated sentinel.** Unlike every other CAP increment, CAP-6 (A4 mutation executor) is pinned only by `mutation-contract*.vitest.ts` + `mutation-port.vitest.ts`, not a `cap-6-sentinel`. The locked invariants (single rollback resolver `:1911`; "never a second governance-policy engine" `:1914`) are covered by contract/port tests. **Impact:** none today; a dedicated sentinel would make the two locked invariants as mechanically enforced as the rest of the CAP family. **Recommendation:** add a `cap-6-sentinel.vitest.ts` pinning both when CAP-6 is next touched (optional hardening).

4. **[INFO] ADR-0011's 7 invariants have no dedicated sentinel.** They're enforced indirectly via `tests/evolution/` + `tests/verification/` (A2 evaluator read-only, evidence immutable/expiring). Coverage is real but not pinned by name. **Recommendation:** optionally add a `verification-sentinel` for the ADR-0011 set.

5. **[INFO] Cross-plan ruling chaining is intentional, not duplication.** CAP-8 #12 / CAP-9 #19 / CAP-10 #23 all restate "composition root owns EventLog; never instantiate internally" — expected chaining across increments.

---

## 6. Verified green (independent re-run)

| Check | Result |
|-------|--------|
| Sentinel family (32 files) | **345/345 pass** |
| Full vitest | **488 files / 5196 tests / 0 failed / 7 skipped** |
| Typecheck | **0 errors** |
| A9 16-invariant sign-off | ✅ (checkpoint `2026-08-17-a9-full-verification.md`) |
| CAP-P discriminator | 5/5 cells green (checkpoint `2026-08-15-cap-p-consolidation-execution-complete.md`) |

---

## 7. Concerns / decisions for later

1. **No central registry.** The audit had to pull from ~30 docs + the out-of-tree memory dir. A consolidated `docs/architecture/invariants.md` (one table: set → source → count → enforcement → last-verified) would make future audits single-source. Recommendation: create it as a maintenance artifact (not a spec change), documenting the authoritative count per domain (A9 16, security 12, capability §77 10, A8 12, CAP-P 6).
2. **Memory↔repo split.** The canonical locked rulings for A9/CAP-N/O/P live in `~/.claude/.../memory/` (out-of-tree), so a repo-only audit misses them. The consolidated invariants doc would also capture these by reference.
3. **Findings 1–3 are doc/hardening only** — none is a merge-blocker or functional defect. All invariant enforcement is green.

---

## 8. References

- A9 spec §48 (16): `docs/superpowers/specs/2026-08-15-a9-forecast-calibration-and-provenance-design.md:2033`
- A8 checkpoint (12 rulings, 3 pins): `docs/architecture/checkpoints/2026-08-14-a8-organizational-learning-complete.md:86,104`
- CAP-P checkpoint (6 frozen, 9 sentinels, 5-cell discriminator): `docs/architecture/checkpoints/2026-08-15-cap-p-consolidation-execution-complete.md:64,98`
- Security track (12): `.git/sdd/task-s0-invariants.md:1`
- Capability §77 (10): `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md:2470`
- ADR-0011 (7): `docs/architecture/adrs/ADR-0011-evolution-verification-model.md:143`
- Sentinel family: `tests/{capability,evolution,adaptation,governance,learning,agents,tools,explain,baseline,executive,chat}/*-sentinel*.vitest.ts`
- A9 full-verification checkpoint: `docs/architecture/checkpoints/2026-08-17-a9-full-verification.md`
