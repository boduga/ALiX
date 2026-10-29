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

The parent plan is
`docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md`. It requires
five contract decisions before runtime implementation resumes.

## Decision

### 1. Supported platforms

Phase F targets **Linux, macOS, and native Windows** as supported execution
platforms.

A platform must not silently downgrade to best-effort replay protection. If a
required persistence or process-control primitive cannot satisfy this contract,
the affected guarded capability must fail closed with an explicit unsupported-
capability result until that backend is qualified.

CI collection by itself is not platform qualification; the claimed execution
and failure semantics must be exercised natively.

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

Implementation agents, automated reviewers, CI, and `alix security gate`
provide evidence but **cannot clear Phase F or accept residual risk**.

For D9:

- reviewers may propose technical finding classifications;
- platform exclusions, residual-risk acceptance, and Phase F clearance require
  an explicit **operator-owned decision** preserved in the Phase F evidence;
- a future named security approver may be added as a co-approver, but authority
  never falls implicitly to the implementation agent.

Until an explicit operator decision clears it, Phase F remains `HOLD` even when
CI is green.

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
4. Linux, macOS, and native Windows have explicit qualification for the
   guarantees claimed here.
5. Unknown outcomes remain quarantined after ALiX process restart.
6. Evidence distinguishes process-crash safety from kernel/power-loss claims.
7. Independent review finds no unresolved violation of this ADR, or any residual
   issue has an explicit operator disposition.

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

## Related Records

- `docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md`
- `docs/2026-10-28-d9-effect-replay-hardening.md`
- `docs/2026-10-28-review-finding-classification-proposal.md`
- `docs/prd/evidence/lean-01/D9-R4.2-phase-f-codex-gate-assessment-2026-10-28.md`
- `docs/prd/evidence/lean-01/D9-R4.2-phase-f-final-evidence-reconciliation-2026-10-28.md`
