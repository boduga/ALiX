# ADR-0015: Keep SRAP decision evidence in the approval ledger event

- Status: Accepted for G2-C — G3 remains blocked
- Date: 2026-10-14
- Decision owners: ALiX operator and security reviewer

## Context

`ApprovalStore` already persists the complete approval record as an
`approval.updated` event in the SQLite runtime ledger. `RuntimeLedger.append()`
commits the event, entity version, and outbox row in one SQLite transaction.
The JSONL audit trail is a separate persistence system and its owning DOX
contract prohibits mirroring audit authority into the runtime ledger.

Remote approval needs one durable answer to: who made which decision, using
which authenticated credential and nonce? A success response must not exist
without that evidence. SQLite and JSONL cannot share one atomic transaction.

## Decision

The authoritative `approval.updated` payload will contain both the state
transition and a validated `remoteDecisionEvidence` object. They share the one
existing SQLite commit. No second approval authority, ledger, state machine, or
scheduler is introduced.

Evidence is minimal and bounded:

```text
decisionId, principalId, credentialRef, decision, nonce, decidedAt, transport
```

`reason` may be retained only under the existing bounded approval policy. Raw
bearer tokens, session cookies, and unbounded client metadata are forbidden.
Credential evidence is `hmac-sha256:<keyVersion>:<base64urlDigest>`, computed
over the persistent credential-record ID with a versioned secret held in the
existing credential store. Raw bearer tokens and raw credential IDs are not
evidence. Key rotation retains old versions for verification during approval
retention, with access restricted to trusted auth/audit code.

The JSONL audit record is a recoverable projection. Current outbox primitives
have no production consumer, so recovery is implementation work, not an existing
guarantee. G3 must extend existing approval reconciliation: compare committed
remote evidence with JSONL by `decisionId`, append missing rows idempotently,
report duplicates/lag, and run after inline projection failure and startup. It
cannot authorize execution or override ledger state. No new scheduler or ledger.

The endpoint may acknowledge success only after the authoritative append
returns. If the client loses the response after commit, it re-reads the approval.
An exact retry is `200` only after bearer authentication, approval-specific
authorization, and equality of principal, nonce, decision, and bounded request
content against committed evidence. Conflicts are `409`; unauthorized callers
receive no approval-state disclosure.

## Durability requirement

Every runtime-ledger connection uses WAL plus `synchronous=FULL` and verifies
both active settings. SQLite `synchronous` is connection-local, so tests inspect
the reopened ALiX connection rather than an unrelated raw connection. G2-B
probes cover rollback, commit-before-ack process death, restart, authoritative
read-back, and active settings.

This is repository-wide. Measured 3 × 250 sequential committed writes on the
workspace filesystem changed from 279.7 writes/s (3.59 ms/write) at the previous
default to 14.0 writes/s (76.86 ms/write) at FULL. G2-C must decide whether this
cost is acceptable on supported storage; durability will not be weakened.

## Consequences

- One transaction proves transition/evidence atomicity.
- Unknown HTTP outcomes are reconcilable without a duplicate transition.
- JSONL failure cannot erase or invalidate an authorized decision.
- Projection lag must be observable and repairable through existing machinery.
- Bearer-only authentication, stable `principalId`, record-level eligibility,
  and trusted-proxy TLS validation remain mandatory before remote exposure.

## Rejected alternatives

- Atomic SQLite plus JSONL write: impossible across the two stores.
- Audit-first transition: creates orphan evidence and ambiguous authority.
- A second evidence ledger or state machine: violates subsystem ownership and
  SRAP-1 scope.
- Cookie sessions in SRAP-1: current CSRF posture does not establish the needed
  guarantee.

## G2-E reconciliation (2026-10-14)

- **Normative rules moved to the owning DOX.** The live eligibility predicate,
  audit-projection contract, HMAC-key lifecycle, and canonical-workspace rule are
  maintained in `src/governance/approvals/AGENTS.md`,
  `src/governance/audit/AGENTS.md`, `src/governance/security/credentials/AGENTS.md`,
  and `src/interfaces/server/AGENTS.md`. This ADR stays the decision record;
  `docs/2026-10-14-srap-1-contract-proposal.md` and `docs/2026-10-14-srap-1-implementation-plan.md` are
  dated hand-off history, not live contracts.
- **FULL cost is storage-class-specific.** Representative concurrent-writer
  measurement (G2-E) shows the large single-append FULL penalty is a rotational
  HDD effect; `synchronous=FULL` is retained. Group commit is a *separate*
  investigation (its own ADR/PR), explicitly **not** part of SRAP-1. See
  `docs/2026-10-14-srap-g2-e-operational-verification.md`.
- **Audit-chain crash window is a prerequisite.** The projection depends on the
  audit chain; the stale-head duplicate-seq window in `AuditChainWriter` must be
  repaired (detect stale head by comparing with the JSONL tail; recover from the
  tail before allocating the next seq) before the projection relies on the chain.
