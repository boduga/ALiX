# D9 Phase F Slice G — governance/evidence reconciliation

Date: 2026-10-29 (America/Edmonton)
Status: ACCEPTED at Slice G governance-reconciliation scope; Phase F remains HOLD
Source commit: `04711911a5169ed5652fbcfa89f3976eed7f799d`
Source tree: `85b83d2bb21fe8ad0ac6d2d17fa54e2ed9ce26eb`
Branch: `fix/d9-phase-f-remediation-v2`

## Scope

This packet reconciles the governance/evidence items listed in Slice G of `docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md`. It does not provide Linux ARM64 native qualification, close PRE-R024, clear Harness Gate E, authorize release, or claim global exactly-once effects.

## Slice G checklist

| Requirement | Disposition | Evidence |
|---|---|---|
| Correct retained Vitest SHA-256 to `dd9901e79ceb2838787c8836641c476894e8c547315d2d90afce7fade35472e7` | HASH TEXT CORRECT; RETAINED-ARTIFACT VERIFICATION BLOCKED | Two historical evidence documents record the required SHA-256, but the named raw artifact is absent from reachable history, the working tree and stash-visible content. A bounded unreachable-object scan checked 193 dangling blobs and found no blob whose raw SHA-256 matches `dd9901…`. The historical Vitest result therefore remains **INCONCLUSIVE**, and this packet does not claim retained-byte verification. |
| Formalize `RISK-REPLAY-01` | SATISFIED | `docs/security/risk-register.md` now records `R-014 / RISK-REPLAY-01`, High assessed risk, OPEN status, exact-effect mitigation and residual non-global-exactly-once limits. |
| Correct contradictory residual-risk summary | SATISFIED | Risk summary now counts R-014 among High risks and states that each row's residual-risk field is authoritative; R-014 remains explicitly OPEN. |
| Reconcile `alix security gate` documentation with implementation | SATISFIED | `docs/security/operations.md` and `src/interfaces/cli/commands/security/doctor.ts` now match the bounded implementation. The exceptions check was also hardened against ALiX's canonical supply-chain schema: the file must contain an `advisories` array, each advisory must carry an `id`, each present `expiry` must be parseable, and expired entries fail the gate. Audit-chain integrity, limiter behavior, independent-review adjudication and D9 readiness remain explicitly outside this command. |
| Add `unverified` to review-finding lifecycle if proposal adopted | ALREADY SATISFIED / NO ADOPTION CLAIM | `docs/2026-10-28-review-finding-classification-proposal.md` already states that unreproduced findings remain `unverified`. The proposal remains DRAFT; Slice G does not silently adopt it. |
| Pin evidence to exact reviewed tree/commit and platform matrix | SATISFIED by this packet at governance source scope | This packet binds the reconciled governance state to commit/tree above and records the platform matrix below. Technical platform qualification retains its own source pins. |

## Agent-driven contract reconciliation

The remediation plan is now consistent with ADR-0017 and the Harness v1.2 agent-driven operating model:

- unresolved-effect reconciliation is an audited **delegated** authority path, not a routine human-in-loop step;
- implementation/reviewer agents cannot self-authorize `effect.reconcile`;
- missing authority or unresolved risk fails closed as HOLD/BLOCKED;
- independent verifier/critic agents provide the technical verdict against exact evidence;
- Q13 publication/release authority remains external to D9 and unchanged;
- the stale footer claiming runtime work was still unauthorized was corrected because ADR-0017 already records the required §0 decisions.

## Platform / qualification matrix

| Target | D9 Phase F status | Evidence / disposition |
|---|---|---|
| Linux x86-64 / ext4 | QUALIFIED for the tested process-crash/restart and process-tree scope | `D9-phase-f-slice-e-linux-x86-64-qualification-2026-10-28.md`; implementation source `72c9f3a988d16560244989ef0ad7cdfcf7f302c1`; no power-loss claim. |
| Linux ARM64 | REQUIRED / NOT YET QUALIFIED | ADR-0017 and Master PRD Q10 require native evidence. This remains a Phase F blocker. |
| macOS | DEFERRED certification target | ADR-0017/Q10; must fail closed where guarded durability/process contract is unavailable; not advertised as Phase F certified. |
| Native Windows | DEFERRED certification target | Same disposition as macOS. |
| Containers / other filesystems / network filesystems | NOT QUALIFIED by this packet | No generalization from local ext4 evidence. |

## Relevant implementation state

Slice F is separately accepted at implementation scope in `D9-phase-f-slice-f-reconciliation-qualification-2026-10-29.md`:

- implementation `db9bf8777d3937c140be3ad4958f4642be552d9c`;
- deep snapshot closes the independently reproduced nested MCP A→B identity drift;
- writable-tree targeted suite: 4 files / 48 tests PASS;
- independent post-fix security review: ACCEPT, no HIGH/MEDIUM reconciliation defect found.

Slice G does not broaden that result.

## Validation on the reconciled governance tree

Against source commit/tree pinned above:

```text
pnpm build                                                PASS
node --test dist/tests/cli/security-doctor.test.js       8/8 PASS
pnpm typecheck:unused                                     PASS
pnpm check:dox                                            PASS
git diff --check                                          PASS
```

The security-gate tests exercise both JSON and human-readable doctor/gate surfaces plus fail-closed canonical `advisories`/`id`/`expiry` validation. A direct validation of the repository's current `security/audit-exceptions.json` returned `expiredCount: 5` on 2026-10-29, confirming the gate now understands the real file format rather than an invented schema. Consequently, the current repository security gate is expected to fail the expired-exception check until those records are renewed, removed, or otherwise resolved through their governing supply-chain process; this packet grants no waiver. These tests validate the command/report contract; they are not substitutes for D9 technical qualification.

## Remaining blockers

Phase F remains **HOLD** because:

1. required Linux ARM64 native qualification is still absent;
2. the historical raw Vitest artifact remains unavailable, so its retained-byte verification stays explicitly BLOCKED/INCONCLUSIVE rather than silently passed;
3. final Phase F/Harness Gate E reconciliation must be run against the exact completed evidence tree;
4. the repository currently contains 5 expired audit-exception records; the hardened security gate correctly treats them as a failure until governed remediation occurs;
5. PRE-R024 process/rubric isolation remains a separate Harness HOLD and is not cleared by D9.

`R-014 / RISK-REPLAY-01` remains OPEN by design. Its OPEN status is not itself a hidden waiver: D9 claims only the qualified exact-effect boundary and explicitly does not claim global exactly-once behavior.

## Independent Slice G verdict

A fresh read-only Codex review of source commit `04711911a5169ed5652fbcfa89f3976eed7f799d` / tree `85b83d2bb21fe8ad0ac6d2d17fa54e2ed9ce26eb` returned **VERDICT ACCEPT — Slice G governance reconciliation only**. The reviewer independently:

- confirmed all six Slice G checklist dispositions;
- scanned 193 unreachable blobs and found no raw SHA-256 match for the missing `dd9901…` Vitest artifact, accepting BLOCKED/INCONCLUSIVE as the honest disposition;
- confirmed R-014 / RISK-REPLAY-01 remains OPEN with High assessed / Medium residual risk;
- confirmed the gate code/docs use canonical `advisories[]` / `id` / `expiry` semantics and that the current file yields `expiredCount: 5` with no waiver;
- confirmed the `unverified` lifecycle proposal remains DRAFT / not adopted;
- confirmed exact commit/tree and platform pins and no material overclaim.

The review noted one **Low, pre-existing observation** outside the gate-specific Slice G acceptance: the broader `security doctor` diagnostic still interprets the exception file using legacy `items`/`expires` names. That diagnostic inconsistency does not change the accepted `security gate` contract and is tracked as follow-up hygiene rather than silently folded into this Slice G verdict.

Post-acceptance follow-up: commit `d51be5b9ef0e7b9c32956ff421424c99826379fa` removed that inconsistency by making the broader `security doctor` path reuse the same canonical `advisories` / `id` / `expiry` validator. Build, 8/8 security-doctor tests, unused typecheck, DOX and diff check remained green; the accepted Slice G source verdict above remains pinned to `04711911` and is not retroactively rewritten.
