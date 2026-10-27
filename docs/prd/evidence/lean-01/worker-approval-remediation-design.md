# LEAN-G01 — Worker approval identity remediation proposal

**Status:** design for independent security review; **NOT authorized implementation**. Source snapshot: dirty checkout at baseline `d412ea15`. LEAN-G01 remains BLOCKED.

## Verified problem

`ApprovalStore.consumeApproved` checks worker mismatch only when both record and consumer supply `workerId`. `WorkerApprovalPort.consumeApproved` delegates without enforcing the worker bound at port construction. `PolicyGate` exact-binding reuse passes `{}` as consumer. A four-test source-level characterization suite (`tests/security/worker-approval-identity-characterization.vitest.ts`) reproduced omitted-worker consumption and cross-worker facade consumption of an already-approved record, as well as request attribution to a different worker. No real tool side effect was executed.

## Authority boundaries

1. **Operator decision:** only trusted operator authority resolves pending approvals. Never expose `resolve`, `revoke`, or `invalidate` to a worker port.
2. **Request identity:** an isolated worker's port binds every coordination request to its own worker identity; conflicting identities must fail closed. Do not silently rewrite conflicting claims. Legacy `request` has no workerId parameter; decide explicitly whether to preserve a narrowly scoped legacy path or add a typed worker-bound request API.
3. **Consumption identity:** store requires a nonempty matching `consumer.workerId` whenever record has `workerId`; the worker port supplies its bound identity and rejects conflicting caller identity. Worker attempt should be checked when record is attempt-bound, including after restart, with an explicit policy for legacy records.
4. **Invocation:** retain binding-key equality and single-use durable locking. For records carrying invocation fingerprints, require a supplied matching invocation identity, or document a separate exact-coordination-binding contract with independent verification. Avoid introducing an accidental legacy replay path.
5. **Outcome receipt:** preserve `recordExecutionOutcome` worker ownership checks and the crash-after-consume `unverified` terminal behavior. Review whether outcome attribution should include worker attempt and execution receipt identity.
6. **Visibility:** determine whether `get`, `findExact`, `findPending*`, `findResolved`, and `findByRequestId` may expose other workers' records; define metadata confidentiality separately from execution authority.

## Compatibility / rollout decision points

- Existing worker-port tests consume worker-bound records using `{}` and expect success. These are compatibility assertions that **must change** when strict identity enforcement is implemented.
- `PolicyGate` currently passes `{}` for approved coordination bindings. It must receive trusted worker context and pass it into consumption, not infer worker identity from an untrusted approval record.
- Ordinary legacy `request` / non-coordination approvals may lack worker identity. Preserve only an explicit reviewed compatibility path; avoid weakening the coordination contract to accommodate it.
- ApprovalStore mutation must continue to reload and validate under its cross-process lock. No read-then-consume split that weakens atomicity.
- Update default-worker, daemon, Inspector, and isolated-worker composition roots consistently, with special attention to previously documented optional ApprovalStore omissions.

## Acceptance gates (must fail against current behavior, pass after fix)

| Test | Required outcome |
|---|---|
| Worker-bound approval + missing consumer identity | DENY; remains approved |
| Worker A approval + worker B consumer identity | DENY; remains approved |
| Worker A approval + worker B bound port, omitted identity | DENY; remains approved |
| Worker B bound port creates request attributed to worker A | DENY without minting a record |
| Worker A correct binding and identity | Consume once; subsequent attempt denied |
| Mismatched worker attempt after restart | DENY according to versioned attempt contract |
| Invocation-bound record with omitted or changed invocation | DENY according to approved invocation contract |
| Legacy unbound approval | Explicit documented behavior, no coordination authority escalation |
| Cross-process race, crash and replay | One claim maximum; uncertain effect stays unverified |
| End-to-end PolicyGate/isolated-worker approval | Operator approval resumes only authorized worker/tool attempt |

## Review checklist

Independent reviewer must approve: identity provenance, request compatibility, worker attempt semantics, invocation matching semantics, port read visibility, migration handling for existing approvals, negative tests, and failure/restart evidence. Until then: **no production authorization edits and no LEAN-G01 promotion**.
