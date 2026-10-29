# D9 R4.2 Phase F — Coordinated Remediation Implementation Plan

**Status:** implementation-ready plan / §0 contract decisions recorded in ADR-0017; test-first implementation may proceed  
**Date:** 2026-10-28  
**Scope:** F1–F7 from `/tmp/alix-d9-consolidated-design-audit-20261028.log`  
**Primary objective:** remove replay/authorization/completion ambiguity as one execution-boundary change, then qualify supported platforms and reconcile governance evidence.

## Authority and scoped-freeze boundary

This plan is an **already-active D9 dependency-resolution lane**, not authorization to resume the broader PRE-2.0 program. Its requirement chain is:

```text
ALiX Master PRD v2.9
├─ PRE-2.0 Master PRD v1.1
│  └─ D9 / LEAN-R006 / LEAN-G01 dependency constraints
└─ Harness PRD v1.2
   └─ Gate E execution/security + uncertain-effect stop rules
        ↓
ADR-0017 → this remediation plan → implementation → independent qualification
```

The PRE-2.0 Master PRD is frozen for **new** work while Harness v1.2 closeout and D9 are reconciled. Permitted under the D9 exception: Phase F remediation, tests, native-platform qualification, evidence reconciliation, and the minimum contract/document changes required to close D9. Not permitted under this exception: unrelated LEAN optimization/cutover, new capability expansion, new milestone execution, or treating D9 progress as LEAN-G01 PASS. Harness PRE-R001–PRE-R032 and Gate F remain independently controlled until their own closeout evidence is accepted.

## 0. Non-negotiable design decisions before code changes

Record these explicitly in this document or a linked ADR before implementation begins:

The five decisions are now recorded in ADR-0017:

1. **Supported platforms:** Linux x86-64 and ARM64 are required for first-release Phase F qualification per Master PRD Q10; macOS/Windows/container certification is deferred.
2. **Durability target:** mandatory process-crash/restart safety; kernel/power-loss durability is not claimed unless separately qualified.
3. **Threat model:** untrusted model/project/plugin/shell inputs, ALiX crashes/concurrency and ALiX-created races are in scope; an unrestricted hostile same-user process is not the Phase F integrity boundary.
4. **Completion authority:** terminal success requires both unambiguous execution completion and durable `terminal_success` recording for the same effect identity.
5. **Risk authority:** the technical gate is agent-driven with independent verifier/critic separation and deterministic/native evidence. There is **no residual-risk waiver path** inside D9: unresolved risk or missing evidence means `HOLD`. Q13 release authority remains external and unchanged.

These decisions authorize test-first remediation work; they do not claim Phase F readiness.

## 1. Architectural target

### 1.1 Routed shell execution

Replace persistent routed-shell execution with **one fresh OS process per command**. Preserve persistent-shell facilities only for explicitly non-routed/internal use if separately justified.

Required properties:
- command receives no harness completion protocol on stdin;
- cwd is canonicalized once and is the cwd actually passed to spawn;
- completion is based on process exit code **and termination signal**;
- cancellation terminates the full child process tree using the platform-qualified mechanism;
- timeout/cancel/signal/process-exit ambiguity never becomes success;
- stdout/stderr capture cannot contaminate the next command because no process is reused.

This directly removes F1 and materially simplifies F2/cancellation proof obligations.

### 1.2 Authorization classification

Split these concepts:

- `safe to parse/route`
- `provably non-mutating for approval exemption`

The second set must be conservative. Commands/options that can invoke preprocessors, redirect/write output, execute hooks, or dispatch subprocesses must not be exempt from `ask` authorization merely because the command family is normally read-oriented.

No replay guard may be used as a substitute for first-attempt authorization.

### 1.3 Durable effect journal

Replace the temporary unresolved-marker lifecycle with a small durable operation journal owned by the effect guard.

Minimum state model:

```text
not_started -> claimed -> started_unknown -> terminal_success
                              |               terminal_failure
                              +-> reconciled_success / reconciled_not_applied
```

Suggested persisted fields:
- schemaVersion
- effectKey
- toolName
- canonicalArgsHash
- workspace identity
- state
- claimedAt / updatedAt
- optional adapter operation key / reconciliation metadata
- no raw command/plugin arguments if secret-bearing

Required ordering:

1. Persist durable claim before adapter entry.
2. Persist `started_unknown` before/at the point after which an external effect may have happened.
3. Execute adapter.
4. Persist durable terminal outcome **before** releasing replay quarantine.
5. Only after terminal outcome durability may cleanup/compaction occur.

A host crash between adapter success and receipt recording must not make a fresh invocation look unclaimed.

### 1.4 Outcome semantics

Do not collapse persistence failures into one message. At minimum distinguish:

- unsupported durability backend;
- claim already exists / unresolved prior effect;
- claim creation failed before effect could start;
- effect may have started and outcome is unknown;
- terminal outcome recorded but cleanup failed.

Only qualified terminal outcomes may permit automated retry. `signal`, cancellation after dispatch, timeout, lost response, and provider uncertainty are non-success unless the adapter has stronger reconciliation evidence.

### 1.5 Adapter contract

The local journal prevents exact-key replay; it does not provide global exactly-once semantics.

Adapters that can affect remote systems should optionally expose:

```ts
interface EffectReconciliationAdapter {
  operationKey?: string;
  reconcile(effectIdentity): Promise<
    | { state: "applied"; evidence: ... }
    | { state: "not_applied"; evidence: ... }
    | { state: "unknown"; evidence?: ... }
  >;
}
```

Do not normalize arbitrary shell strings into semantic equivalence claims.

## 2. Test-first implementation slices

### Slice A — completion and authorization counterexamples

Add failing tests before implementation for:

- F1 stdin trailer consumption/premature completion;
- F2 `SIGTERM`/signal termination must not produce success;
- effect-capable `rg --pre` and `git ... --output` require approval in ask mode;
- safe-shell cancellation reaches execution;
- fresh command isolation: cwd/env/functions/stdin/output cannot leak between routed commands.

**Exit criterion:** tests fail for the documented reason on baseline and pass only after the architectural change.

### Slice B — remove routed persistent-shell protocol

Implement fresh-process routing using the existing lower-level spawn path where possible rather than creating a second execution implementation.

Delete or bypass marker/trailer completion for routed commands. Preserve any legitimate persistent-shell API only behind an explicit boundary and dedicated tests.

**Exit criterion:** all Slice A tests pass; existing shell behavior tests remain green; no replay-guard changes yet beyond interface adaptation.

### Slice C — durable journal and crash ordering

Implement the operation journal and migrate guard call sites.

Add deterministic crash/fault injection points:

- before claim creation;
- after claim fsync;
- immediately before adapter entry;
- after effect/application but before adapter return;
- after adapter success but before terminal receipt persistence;
- after terminal receipt persistence but before cleanup.

Test fresh-process restart against the same workspace and effect key.

**Exit criterion:** no tested crash point permits an unresolved/applied effect to be automatically replayed; known non-started cases are distinguishable from unknown outcomes.

### Slice D — dispatch-mode coverage

Prove guard/journal behavior across:

- ask/approval flow;
- auto-allowed flow;
- bypass/direct flow where legitimately supported;
- continuation/resume flow;
- MCP/dynamic mutating tools;
- cancellation and timeout paths.

**Exit criterion:** every mutating high/critical path has one explicit journal boundary and no alternate unguarded dispatch route.

### Slice E — platform backends

For each declared supported platform, implement/qualify persistence and process-tree behavior.

**Linux x86-64 / ARM64 (required):** qualify the selected supported filesystem assumptions and process-tree behavior natively on both architectures. Record filesystem/mount context with the evidence; do not generalize ordinary `fsync` into an untested power-loss claim.  
**macOS / Windows / containers (deferred):** may receive development backends, but are not first-release certification requirements under Q10. Until separately qualified, guarded effects must fail closed where their durability/process-control contract is unavailable and documentation must not advertise them as certified.

If a required Linux target cannot satisfy required durability, return a stable `unsupported_effect_durability` style error before adapter entry; Phase F remains HOLD.

### Slice F — recovery/reconciliation

Add an audited operator reconciliation path for unresolved journal entries.

Requirements:
- never clear by age/PID alone;
- evidence and actor identity recorded;
- operation identity cannot be silently changed;
- reconciliation outcome is durable and append/history preserving;
- no implementation agent/reviewer can self-approve risk or clear the Phase F gate.

### Slice G — governance/evidence reconciliation

Before clearance:

- correct the retained Vitest SHA-256 to `dd9901e79ceb2838787c8836641c476894e8c547315d2d90afce7fade35472e7`;
- add `RISK-REPLAY-01` to the formal risk register or explicitly link the authoritative risk record;
- fix contradictory residual-risk summary text;
- reconcile `docs/security/operations.md` claims with what `alix security gate` actually verifies, or strengthen the implementation under a separate approved change;
- add `unverified` to the review-finding lifecycle if that proposal is adopted;
- pin evidence to the exact reviewed tree/commit and platform matrix.

## 3. Qualification matrix

Every declared supported platform must cover:

| Area | Required cases |
|---|---|
| Authorization | ask/auto/deny, `rg --pre`, output-writing flags, fresh invocation IDs |
| Identity | canonical cwd, relative path, aliases/symlinks, workspace distinction |
| Completion | exit 0/nonzero, signal, timeout, cancel, lost child, stdin isolation |
| Concurrency | same key collision, different keys, independent processes |
| Crash recovery | all journal checkpoints before/during/after effect/outcome recording |
| Storage faults | create/write/fsync/rename/unlink/cleanup failure injection |
| Provider ambiguity | lost response, delayed settlement, provider retry, reconcile applied/not-applied/unknown |
| Process lifetime | descendants and host death; no orphaned effect mistaken for terminal result |

Platform test collection alone is not qualification. Native execution evidence is required for every claimed platform.

## 4. Implementation order

1. Record five design decisions from §0.
2. Land test-only counterexamples for F1/F2/F4/cancellation.
3. Replace routed persistent shell with fresh-process execution.
4. Land durable operation journal and crash-order tests.
5. Cover every dispatch/continuation path.
6. Implement/qualify platform persistence and process control.
7. Add audited reconciliation.
8. Reconcile governance/risk/evidence docs.
9. Run full native platform matrix plus typecheck/build/unused/DOX/dependency analysis.
10. Independent final architecture/security review.
11. Authorized operator/security disposition.

## 5. Explicit no-go conditions

Phase F cannot clear if any of the following remain:

- command can report success before its process/effect has actually reached the defined completion boundary;
- signal/timeout/cancel can be mapped to success without reconciliation evidence;
- a crash after effect application can remove all replay quarantine before durable terminal outcome recording;
- an effect-capable command bypasses required authorization because of broad command-family classification;
- a declared supported platform lacks native qualification for journal durability and child-process semantics;
- unresolved effects can be auto-cleared by PID/age or reviewer/agent decision;
- evidence hashes/tree/platform provenance are inconsistent;
- residual security risk lacks authorized disposition.

## 6. Current gate state

- Phase F: **HOLD**
- Code changes authorized by this plan: **NO — pending §0 decisions**
- Commit/push/merge: **NONE**
- Existing uncommitted working tree must be preserved while remediation is staged deliberately.
