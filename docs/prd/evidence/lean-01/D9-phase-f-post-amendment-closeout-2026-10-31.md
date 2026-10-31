# D9 Phase F — post-amendment closeout reconciliation (initial packet)

Date: 2026-10-31 (UTC)
Status: **HOLD — no final independent Phase F acceptance in this packet**
Baseline commit: `d77aa991c32877bfebbee59ab201eef38cb443ff`
Baseline tree: `2fc9cad5b7d19aeeda56f11439a2687bcf4407bd`
Branch: `audit/d9-phase-f-final-closeout`

## Scope decision

Master PRD v2.10 Q10/Q15 and ADR-0017, merged in PR #1004, make **Linux x86-64** the sole initial certified architecture. Native Linux ARM64 certification is deferred, **non-blocking for initial x86-64 D9 qualification**, and must not be advertised as passed. macOS, Windows, containers, network filesystems, and other untested backends remain uncertified. The earlier Slice G packet was historically accurate when authored; its ARM64 REQUIRED/HOLD statements are superseded for initial release by this amendment, not retroactively rewritten.

## Evidence boundaries

- Slice E independently accepted Linux x86-64/ext4 **process-crash/restart and process-tree** scope only; no kernel-crash, power-loss, or generalized storage guarantee (`D9-phase-f-slice-e-linux-x86-64-qualification-2026-10-28.md`).
- Slice F independently accepted nested MCP reconciliation fix and targeted tests on its pinned historical tree (`D9-phase-f-slice-f-reconciliation-qualification-2026-10-29.md`).
- Slice G independently accepted governance reconciliation on its historical pinned tree, not a final Phase F PASS (`D9-phase-f-slice-g-governance-reconciliation-2026-10-29.md`).
- Merged remediation PR #1003 and platform-scope PR #1004 do not replace a fresh exact-tree independent technical review.
- Historical retained Vitest artifact SHA-256 `dd9901e79ceb2838787c8836641c476894e8c547315d2d90afce7fade35472e7` has no independently retrievable bytes in the prior packet: **INCONCLUSIVE**, not PASS. Fresh test execution can provide new evidence, not reconstruct the missing historical artifact.
- `R-014 / RISK-REPLAY-01` remains OPEN. No claim of global exactly-once external effects; ambiguous effects require governed reconciliation, not automatic retry.

## Security exception disposition

The repository `security/audit-exceptions.json` records five advisories with `expiry: 2026-09-16` and `failOnExpired: true` (as of this baseline). No renewal, deletion, exception extension, or waiver is authorized by this packet. Each must be reconciled with current dependency reachability and supply-chain policy by an authorized owner; until then, security-exception clearance is **HOLD**. A CI supply-chain PASS does not, by itself, prove this independent gate cleared.

## Initial fresh checks on candidate branch

- `pnpm exec vitest run tests/security/d9-scripted-review-routing.vitest.ts --config vitest.config.mts`: **3/3 PASS**.
- `node --test dist/tests/cli/security-doctor.test.js`: **4/4 PASS** on the local compiled tree. This does not certify the full security gate.
- `pnpm audit --json`: **exit 1**, vulnerability summary: **1 critical, 13 high, 14 moderate, 1 low**. These are dependency advisory counts, not an adjudicated list of exploitable ALiX vulnerabilities. Require owner review, dependency reachability assessment, and remediation; do not automatically renew expired exceptions.
- Attempting to execute a `.vitest.js` artifact using `node --test` failed because it is not the intended Vitest runner; the correctly invoked source Vitest suite passed. Do not treat the invalid-runner failure as a product regression.
- Historical `node-tests` CI flake from PR #1004 passed on rerun; no root cause or permanent test-runner repair is established.

## Required final evidence before a Phase F PASS

1. Run reproducible native Linux x86-64 tests and negative crash/replay/approval/identity checks on the exact candidate tree; retain logs and hashes, including build and source identities.
2. Independently review code and evidence with separate verifier/critic authority; no author self-certification.
3. Resolve the five expired exception records through governed review and prove the security gate accepts the resulting actual repository state, or retain HOLD.
4. Reconcile historical missing Vitest evidence explicitly as INCONCLUSIVE or supersede the *specific* acceptance obligation with independently retained new evidence, without claiming historical hash verification.
5. Reconcile D9 Phase F with Harness Gate E clause-by-clause; PRE-R024 rubric/process isolation remains a separate Harness blocker.
6. Preserve zero acknowledged-critical-transition loss, evidence-derived enforceable recovery thresholds, fail-closed effects, and Q13 external release authority. Do not expand process-crash evidence into a power-loss certification claim.

**Verdict: HOLD pending the above.** This is a traceable closeout work packet, not a final qualification or release authorization.
