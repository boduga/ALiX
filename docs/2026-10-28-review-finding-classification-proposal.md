# ALiX — Review Finding Classification and Release Disposition (PROPOSAL)

**Status:** DRAFT / NOT ADOPTED  
**Date:** 2026-10-28  
**Scope:** Independent code/security reviews and D9 R4.2 Phase F qualification.  
**Change boundary:** Documentation proposal only; no runtime gate, policy, or CI behavior changes.

## 1. Existing authority and non-goals

- `alix security gate` is an implemented runtime/configuration acceptance check (`src/interfaces/cli/commands/security/doctor.ts`, `docs/security/operations.md`). It is **not** currently a Codex P0–P3 review-finding gate.
- The existing security risk register (`docs/security/risk-register.md`) assesses likelihood, impact, risk level, mitigation, and residual risk using Low/Medium/High/Critical. This proposal does not redefine that methodology.
- `.github/PULL_REQUEST_TEMPLATE.md` requests security doctor/gate checks and security tests; these do not establish review-priority disposition authority.
- A reviewer's `P0`–`P3` tag is a triage suggestion, **not** an ALiX risk level, authorization, release decision, or substitute for evidence.
- No automatic gate integration, risk acceptance, or retrospective Phase F PASS is authorized by this document.

## 2. Proposed finding record

Every actionable review finding should have: stable finding ID; source and review-log provenance; commit/worktree baseline; affected files/lines; reproducible behavior or explicitly marked hypothesis; reviewer priority (optional P0–P3); ALiX impact and likelihood assessment; platform and execution-mode scope; affected security invariant; test/evidence links; owner; proposed remedy; verification status; residual risk; disposition; operator/security decision reference and timestamp if applicable.

**Statuses:** `reported -> triaged -> (remediation_planned | scope_decision_requested) -> implemented -> verified -> closed`. `accepted_risk` and `not_applicable` are terminal only with recorded authorized disposition. `reopened` returns a previously closed finding to triage. A test pass alone cannot move a finding to `closed`.

**Review priority (informational):** P0 immediate critical review, P1 high-priority review, P2 normal-priority review, P3 low-priority review. These labels do **not** map automatically to ALiX Low/Medium/High/Critical risk.

**ALiX assessment:** preserve the risk register's separate likelihood and impact dimensions; record an explicit rationale for risk level. Do not use priority alone to calculate risk.

## 3. Proposed Phase F release-disposition rule

- Any **confirmed, unresolved** finding that violates a Phase F security invariant, or prevents a claimed supported platform from executing guarded operations safely, blocks Phase F clearance until independently verified remediation **or** an explicit authorized scope/risk decision. No silent downgrades.
- A finding that is not reproduced remains `unverified` rather than being silently dismissed; the gate packet must state whether it is a release blocker and why.
- Medium/Low findings still require documented disposition; a P2 is not automatically safe to defer.
- Release readiness requires independent regression verification, platform coverage against declared support, risk register updates where warranted, and operator/security sign-off separate from CI success.
- `alix security gate` passing is necessary where already required, but does not establish D9 Phase F release readiness. D9 Phase F HOLD remains in force until its own decision authority clears it.
- No reviewer or implementation agent may grant itself an exception or change the gate state merely by editing a report.

## 4. Current findings (illustrative, NOT formally adjudicated)

| ID | Reviewer priority | Observed behavior | Assessment still required | Status |
|---|---|---|---|---|
| D9-R4.2-F-REPLAY-WIN-01 | P1 | POSIX directory-open/fsync in effect-claim persistence can block guarded operations on native Windows; review points to `src/capabilities/tools/effect-replay-guard.ts` | Confirm native Windows reproduction, supported-platform contract, safe durability alternative | Reported; Phase F HOLD |
| D9-R4.2-F-SHELL-WIN-02 | P2 | New persistent-shell test unconditionally invokes `/bin/bash` in Windows Vitest lane | Confirm native CI behavior; separate test portability from runtime shell support | Reported; Phase F HOLD |

Review evidence: `/tmp/alix-d9-third-independent-review-20261028.log` (local ephemeral log; preserve into pinned evidence before release). Review command exited 0; that means the review ran, **not** that findings passed.

## 5. Design review and implementation prerequisites

1. Obtain security/architecture review of the effect-identity, shell-cwd, claim-persistence, uncertain-outcome, and recovery contract before modifying implementation.
2. Define supported OS/filesystem guarantees. Distinguish process-crash protection from power-loss durability; native Windows directory fsync must not be assumed equivalent to POSIX. If guarantees cannot be met, reject guarded effects with an explicit unsupported-capability error, not a misleading replay diagnosis.
3. Specify tests first: fresh invocation IDs, relative/aliased cwd, persistent-shell reuse, cancellation/timeouts, crash/restart, concurrent claims, read-only shell escape, Windows and macOS behavior, and failed durability operations.
4. Verify native CI lanes, TypeScript, DOX, and refreshed dependency/impact analysis; record tool limitations rather than marking unexecuted checks PASS.
5. Request independent final review and an authorized release disposition. No automatic claim of exactly-once external effects.

## 6. Proposed decision record (unfilled)

- Decision owner / authority: **TBD**
- Supported platforms and filesystems: **TBD**
- Accepted risk exceptions and expiry: **NONE APPROVED**
- Security contract approved: **NO**
- Phase F clearance: **HOLD**
- Runtime gate changes authorized: **NO**

## 7. Open questions for approval

- Which role has final authority to classify findings and accept residual risk for D9?
- Is native Windows a required Phase F supported target, or only a CI/test target? Record this explicitly; do not infer it from the CI matrix alone.
- Which filesystem durability guarantees are required for each supported deployment environment?
- Should future CI enforce a signed finding-disposition manifest, and who may amend it? This requires a separate approved design and tests.
