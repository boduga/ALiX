# LEAN-G01 — D1–D9 proposed technical resolution

**State:** Design resolution for independent review, NOT independent sign-off, NOT authorization for production edits. LEAN-G01 BLOCKED.

| Decision | Proposed resolution | Required proof |
|---|---|---|
| **D1 — Identity provenance** | Trusted host/worker execution context supplies worker ID, attempt, run and session. Treat prompt/tool arguments and arbitrary consumer payload as untrusted; worker-bound port derives its own identity from immutable construction context. | Forged worker ID cannot create/consume another worker's grant. |
| **D2 — Worker-bound consumption** | Deny a worker-bound approval if consumer worker ID is missing or different; no state transition on denial. Do not treat possession of binding key as sufficient authority. | Existing RED missing-ID and cross-worker acceptance tests turn GREEN. |
| **D3 — Attempt identity** | If approval has `workerAttempt`, require consumer attempt present and exactly equal (including attempt zero); missing/different fails closed. | Wrong/missing attempt denied; correct attempt allowed once. |
| **D4 — Request attribution** | Restricted worker port rejects conflicting request `workerId` rather than silently rewriting; missing worker identity is filled only from trusted bound context. Verify request/reuse cannot return another worker's pending record by binding-key collision. | Spoof request rejected; correct worker pending record attributed correctly. |
| **D5 — Invocation validation** | For an invocation-bound record, require supplied trusted invocation and exact fingerprint match. If fingerprint is absent on an invocation-requiring route, reapproval is required. Ensure host-derived capability/tool/workspace/args/session/agent fields. | Omitted or changed invocation denied; matching invocation consumed once. |
| **D6 — Legacy compatibility** | Explicitly distinguish legacy non-worker approvals from worker-bound approvals. Preserve legacy flows only through reviewed, scoped compatibility behavior; never weaken common worker-bound consumption. | Legacy non-worker approval remains single-use; worker-bound missing identity denied. |
| **D7 — Read visibility** | Restricted port returns only records within worker scope (and explicitly allowed legacy non-worker records). Apply to get, loadFresh, findExact, pending/resolved/request-ID lookups; do not expose operator mutation methods. | Worker B cannot read Worker A's approval metadata or mutate its outcome. |
| **D8 — Migration** | Preexisting worker-bound approved records lacking required proof cannot be consumed; mark for explicit operator reapproval or a separately reviewed migration. No implicit upgrade of authorization. | Persisted old records fail closed after restart; new approved records still work. |
| **D9 — Evidence** | Require behavior-level tests at ApprovalStore, restricted port, PolicyGate, Inspector and daemon, plus isolated child worker and crash/restart. Verify persisted approval/worker/attempt/invocation/outcome and absence of unauthorized side effects. | Full negative and happy-path E2E evidence with commands, revision, reviewer and gate verdict. |

## Implementation dependency order (once separately authorized)

1. Agree and version trusted worker/attempt/invocation context and legacy classification (D1, D3, D5, D6, D8).
2. Enforce atomic store consumption checks (D2, D3, D5) and preserve approved state on denial.
3. Enforce bound worker-port request, consumption, read, and outcome scope (D4, D7).
4. Wire the same approval authority across host composition roots and child isolation, without broadening privileges.
5. Execute D9 end-to-end, restart, cancellation and crash-negative suites; independent reviewer signs D1–D9.

## Current observed baseline

- Prospective acceptance: **7 RED / 3 GREEN** across host injection, worker identity and attempt/invocation suites.
- Characterization tests that intentionally reproduce defects are not security acceptance.
- Host-level approval wiring is not fixed; independent reviewer record remains blank.

**Important:** These are proposed engineering choices. The independent reviewer must independently validate or amend each decision in `worker-approval-independent-review-packet.md`; this document does not fill in the reviewer identity, verdict or sign-off.
