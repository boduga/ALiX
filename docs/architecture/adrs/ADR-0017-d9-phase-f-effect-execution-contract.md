# ADR-0017: D9 Phase F Effect Execution and Replay Contract

## Status

Proposed — 2026-10-28. This records the implementation contract for the
D9 R4.2 Phase F remediation plan. It does not clear Phase F, accept residual
risk, or authorize a release.

## Context

D9 R4.2 Phase F qualification exposed coupled defects across shell completion,
approval exemption, replay protection, crash recovery, and cross-platform
durability. The retained design audit showed these properties span the full
effect-execution boundary and cannot be safely repaired as isolated patches.

The immediate implementation plan is
`docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md`. This ADR is governed by a dual requirement chain:

1. `docs/prd/ALiX_MASTER_PRD_v2.9.md` → `docs/prd/ALiX_PRE_2_0_MASTER_PRD_v1.1.md`, where D9 is an already-active dependency-resolution lane and LEAN-R006 requires preservation of durable transition, effect reconciliation, authorization, audit, and Q01–Q15 invariants; and
2. `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (document version **1.2**), whose Gate E requires independent qualification of authority, crash/recovery, ownership, denied-action behavior, and whose stop rules forbid non-idempotent retry after uncertain effects.

The PRE-2.0 Master PRD is scoped-frozen for new work. That freeze does **not** stop this D9 remediation because D9 predates the freeze and is a blocker shared by the PRE-2.0 program and the Harness v1.2 closeout. This ADR grants no authority to advance unrelated LEAN work.

The implementation plan requires five contract decisions before runtime implementation resumes.

## Decision

### 1. Supported platforms

Per Master PRD v2.9 Q10/NFR-11, Phase F certification is required for **Linux
x86-64 and Linux ARM64**. macOS, native Windows, and containerized deployment are
**deferred certification targets** and are not required to clear this first-release
Phase F gate. Development behavior on those platforms must still fail closed where
the guarded durability/process contract is unavailable; it must not be advertised
as qualified support.

A required Linux architecture must not silently downgrade to best-effort replay
protection. If a required persistence or process-control primitive cannot satisfy
this contract, the affected guarded capability fails closed until that backend is
qualified. CI collection by itself is not platform qualification; claimed execution
and failure semantics must be exercised natively on both certified Linux
architectures.

### 2. Durability target

The mandatory Phase F guarantee is **ALiX process-crash and restart safety** for
local effect state.

The contract requires:

- durable claim recording before adapter entry;
- ambiguous/started effects remain quarantined across ALiX process death and
  restart;
- durable terminal outcome recording before replay quarantine is released;
- persistence failure never turns an unknown or already-applied effect into an
  automatically retryable path.

**Kernel-crash and sudden power-loss durability are not claimed globally by
Phase F** unless a platform/filesystem backend is separately qualified for that
stronger property. Documentation must keep these guarantees distinct.

### 3. Threat model

In scope:

- untrusted model output;
- untrusted repository/project content;
- untrusted plugin/MCP inputs and responses;
- malformed or adversarial shell commands;
- ALiX process crashes, cancellation, timeouts, lost adapter responses, and
  restart;
- concurrent ALiX workers/processes contending for the same effect identity;
- workspace aliases and namespace races that ALiX can reasonably bind or
  validate.

A **hostile same-user process with unrestricted direct write access to ALiX
state or workspace files is not a Phase F integrity boundary**. Such a process
can generally rewrite the repository or state directly. ALiX must still use
restrictive permissions, canonical identities, containment/no-follow checks
where available, and fail closed on detected inconsistencies. This exclusion
does not excuse races created by ALiX itself.

### 4. Completion authority

For a guarded mutating effect, adapter return alone is **not** terminal success.

Terminal success requires both:

1. execution completed without timeout, cancellation, signal termination,
   protocol ambiguity, or unknown provider outcome; and
2. the effect journal durably records `terminal_success` for the same canonical
   effect identity.

The journal, not telemetry and not worker prose, is the durable replay
authority.

Required logical states:

```text
not_started
  -> claimed
  -> started_unknown
  -> terminal_success
  -> terminal_failure
  -> reconciled_success | reconciled_not_applied
```

The implementation may refine transition mechanics, but no transition may make
an ambiguous effect automatically retryable.

### 5. Risk and clearance authority

Harness/D9 technical qualification is agent-driven, but **no agent may accept or
waive residual security risk**. Implementation agents also cannot self-clear their
own findings.

For D9:

- implementation agents produce changes and evidence;
- deterministic/native qualification oracles produce machine-verifiable results;
- an independent verifier/critic agent may issue the technical Phase F verdict only
  when all required evidence is present and no unresolved blocker remains;
- any unresolved residual risk, missing native-platform evidence, or ambiguous
  effect outcome forces durable `HOLD`/`BLOCKED`; there is no in-loop waiver path;
- Linux x86-64/ARM64 are required by the governing Master PRD, while macOS/Windows
  are already deferred by Q10 and therefore need no D9 platform-exclusion waiver.

This technical verdict does **not** replace Q13 release/publication authority.
Actual release remains subject to the Master PRD's separately recorded maintainer
and independent-publication-clearance requirements.

## Consequences

- Routed shell commands move to **one fresh OS process per command**; no harness
  completion trailer/protocol is exposed on command stdin.
- Exit code and termination signal are both inputs to completion classification.
- Approval exemption uses a conservative non-mutating classifier distinct from
  safe parsing/routing.
- A durable effect journal replaces delete-on-success transient claim semantics.
- Recovery/reconciliation is explicit and audited; age, PID, a new approval, or
  a new invocation ID cannot clear uncertainty.
- Platform-specific persistence and process-tree termination may use different
  backends, but all must implement the same logical contract.
- Arbitrary external systems are not magically exactly-once. Stronger guarantees
  require adapter/provider idempotency keys or reconciliation.

## Acceptance Criteria

Before the remediation PR may be described as Phase F ready:

1. Counterexample tests cover the reproduced premature-completion and
   signal-as-success mechanisms.
2. Authorization tests prove effect-capable shell forms do not receive a
   read-only approval exemption merely because their command family is usually
   read-oriented.
3. Crash-injection tests cover each journal boundary from durable claim through
   terminal outcome recording.
4. Linux x86-64 and Linux ARM64 have explicit native qualification for the
   guarantees claimed here; macOS/Windows remain deferred per Q10.
5. Unknown outcomes remain quarantined after ALiX process restart.
6. Evidence distinguishes process-crash safety from kernel/power-loss claims.
7. Independent verifier/critic review finds no unresolved violation of this ADR;
   any unresolved residual issue keeps Phase F on HOLD because D9 has no risk-waiver path.

## Alternatives Considered

- **Patch the existing transient marker and persistent shell independently.**
  Rejected: prior review found coupled completion, authorization, and replay
  gaps; local patches repeatedly changed one assumption while leaving another
  unsafe.
- **Keep routed persistent shells and harden the marker protocol.** Rejected:
  sharing interpreter stdin/state with untrusted commands adds avoidable proof
  obligations and enabled the reproduced premature-success mechanism.
- **Treat all supported filesystems as power-loss durable after ordinary
  `fsync`.** Rejected: the guarantee is platform/filesystem dependent and was
  not established by Phase F evidence.
- **Use reviewer P0-P3 priority as release authority.** Rejected: reviewer
  priority is triage evidence, not ALiX risk acceptance or operator clearance.

## Requirement Traceability

- **Master PRD v2.9:** top-level authority remains unchanged; this ADR may close execution/recovery gaps but cannot alter product-level authorization or release authority.
- **PRE-2.0 Master PRD v1.1:** D9 remains active under the scoped freeze; relevant constraints include LEAN-R006 and the LEAN-G01 dependency relationship already recorded in D9 evidence. No unrelated LEAN gate is advanced by this ADR.
- **Harness PRD v1.2:** this ADR supports Gate E execution/security closeout and preserves PRE-R012 authorization independence plus the explicit stop rule against non-idempotent retry after uncertain effects. It does not itself close PRE-R001–PRE-R032 or Gate F.
- **Existing ADRs:** ADR-0009 and ADR-0013 supply security/audit and capability/provider invariants. ADR-0012 applies where filesystem mutation is involved. ADR-0015/0016 do not automatically govern the effect journal unless a later explicit decision places it in the runtime ledger.

## Related Records

- `docs/prd/ALiX_MASTER_PRD_v2.9.md`
- `docs/prd/ALiX_PRE_2_0_MASTER_PRD_v1.1.md`
- `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (document version 1.2)
- `docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md`
- `docs/2026-10-28-d9-effect-replay-hardening.md`
- `docs/2026-10-28-review-finding-classification-proposal.md`
- `docs/prd/evidence/lean-01/D9-R4.2-phase-f-codex-gate-assessment-2026-10-28.md`
- `docs/prd/evidence/lean-01/D9-R4.2-phase-f-final-evidence-reconciliation-2026-10-28.md`
