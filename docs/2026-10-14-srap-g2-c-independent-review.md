# SRAP-1 G2-C independent architecture and security review

- Review date: 2026-10-14
- Baseline: `main` / `origin/main` / `HEAD` at `2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e`
- Verdict: **BLOCKED**
- Scope: G2-B durability remediation, contract reconciliation, DOX amendments,
  and independent plan review. No SRAP endpoint was implemented.

## 1. Durability proof

The authoritative `RuntimeLedger` connection now pins `journal_mode=WAL` and
`synchronous=FULL`, reads both settings back, and refuses to open if either is
not active. Because `synchronous` is connection-local, every ledger open
performs this setup and verification.

| Probe | Result | Proven property |
| --- | --- | --- |
| Authoritative read-back | PASS | transition and `remoteDecisionEvidence` survive close/reopen |
| Injected transaction failure | PASS | failure at outbox insertion rolls back event, entity version, evidence, and outbox |
| Commit-before-ack SIGKILL/restart | PASS | committed decision survives process death before client acknowledgement |
| Reopened settings | PASS | reopened ledger reports WAL and synchronous level `2` (`FULL`) |

These prove ALiX transaction/restart behavior in the tested local environment.
They do not simulate host power loss or prove filesystem/storage-controller
guarantees.

## 2. Runtime-ledger performance

Representative sequential benchmark, three rounds of 250 single-event commits:

| Setting | Mean writes/s | Mean ms/write |
| --- | ---: | ---: |
| WAL + NORMAL baseline | 279.7 | 3.59 |
| WAL + FULL | 14.0 | 76.86 |
| Difference | -95.0% | +2,042% |

FULL rounds ranged from 9.2 to 16.4 writes/s. The reproducible FULL benchmark is
`scripts/benchmark-runtime-ledger.mjs`. This is a runtime-ledger-wide cost.
Supported-filesystem, concurrent/multi-process, reader-latency, and WAL
checkpoint tests remain required before G3.

## 3. Identity and authorization

Approved design:

- Extend Inspector authentication with persistent operator records; do not
  create an approval-user authority.
- `principalId` is stable and separate from credential identity and role.
- Enrollment creates a principal and first credential; rotation preserves the
  principal; credential revocation does not disable the principal; principal
  disablement rejects every bound credential; legacy unbound credentials cannot
  decide approvals.
- A remote decision requires bearer authentication, `approvals:decide`, active
  principal, explicit workspace scope, and approval-specific eligibility.
- Authorization precedes approval-state disclosure and also gates exact retries.

Blocking gap: ALiX has ownership and approval-binding facts, but no existing
operator-to-approval grant. `ApprovalScope` lacks a deterministic predicate.
G2-B may not silently invent an approval ownership model. Operator must choose:

1. **Recommended:** a workspace-scoped eligible operator may decide a pending
   approval only while existing session/run/worker/binding and ownership facts
   remain valid. This adds no principal-specific approval authority.
2. Add a principal allowlist/grant to each approval. This is a new approval
   ownership authority and is outside current constraints.

## 4. Credential evidence

Evidence stores `credentialRef = hmac-sha256:<keyVersion>:<digest>` over the
credential record identifier, never a bearer secret. Stable `principalId`
remains the human audit-correlation key.

Blocking gap: Inspector auth is hash-only and does not own secret-key lifecycle.
The contract must assign an existing credential-store namespace and define key
generation, activation, rotation overlap, retirement/deletion after retention,
unavailable-key failure, and key-access authorization/audit. Putting this key in
Inspector's hash-only auth store or creating another secret authority is rejected.

## 5. Trusted proxy

Forwarded TLS/client-address evidence is accepted only when the socket's
immediate peer is in an explicitly configured trusted-proxy CIDR. Parsing
requires one unambiguous HTTPS scheme, validates the full forwarded-address
chain, rejects malformed/overlong/conflicting values, and fails closed. Direct
TLS remains valid. Tests must cover direct TLS, trusted proxy, spoofed untrusted
peer, mixed schemes, duplicates, malformed chains, IPv4/IPv6, and multi-hop
trust. Design is ready; production code is not implemented.

## 6. Audit projection recovery

SQLite decision evidence is authoritative. JSONL is a projection and cannot
control or reverse an approval. The current runtime outbox has no production
audit projector; its generic delivery flag is not multi-consumer state.

Blocking gap: the approval reconciler is read-only and the audit writer lacks
atomic idempotent append keyed by `decisionId`. The plan must assign mutation to
the audit subsystem and specify:

- audit-owned idempotent append/deduplication;
- inline post-commit attempt plus bounded startup/operator repair trigger;
- checkpoint/cursor and retry semantics;
- missing, duplicate, corrupt, and lag detection/alerting;
- canonical duplicate handling without marking generic outbox delivery.

Existing ledger, reconciliation, and audit infrastructure can be extended. No
new ledger, scheduler, or approval authority is authorized.

## 7. Contract, ADR, and DOX

- Contract, plan, and ADR agree on one authoritative `approval.updated` commit,
  bearer-only access, stable principals, HMAC credential references, strict
  proxy trust, FULL durability, and JSONL as projection.
- Approval/server DOX permit one default-off, non-executing decision POST. They
  do not broaden browser-write or agent-execution authority.
- Storage DOX records the repository-wide WAL/FULL invariant.
- `check:dox` passes outside the filesystem sandbox. The earlier `HEAD` failure
  was reproduced as sandbox denial of Node's nested `git`, not a tooling defect;
  no tooling change was made.
- Live contract/plan files remain at the docs root despite that directory's
  historical-material convention. Their durable owning location must be
  approved before G3; they were not moved silently.

## 8. Remaining gates

G3 stays closed until:

1. Operator approves the exact `ApprovalScope` predicate.
2. Existing credential-store ownership and complete HMAC-key lifecycle are contracted.
3. Audit-owned idempotent projection repair and triggers are exact.
4. FULL cost is accepted after supported-storage concurrency/checkpoint/reader tests.
5. Contract/plan document ownership is reconciled with DOX.
6. Independent G2-C re-review returns READY.

No production remote endpoint, new authority, ledger, state machine, scheduler,
WebAuthn, biometric, push flow, or device enrollment was implemented.
