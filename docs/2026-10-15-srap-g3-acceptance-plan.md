# SRAP-G3-ACCEPT — integrated acceptance plan (rev 2)

Status: **PROPOSED (rev 2) — not executed.** Planning only. No acceptance run may
start until this revision is approved; no milestone is marked complete until its
evidence is reviewed.

Milestone identifier: **`SRAP-G3-ACCEPT`**. Collision check performed 2026-10-15
against the `boduga/ALiX` tracker and `docs/`:

| Surface | Result |
| --- | --- |
| Labels | no `SRAP*` / `G3*` / `*ACCEPT*` label exists |
| Milestones | none configured on the repository |
| Issues (open + closed) | no `SRAP-G3-ACCEPT`; the only SRAP-named issue is #954 (closed) |
| `docs/` | no reference to `SRAP-G3`, `G3-ACCEPT`, or an acceptance plan |

`SRAP-G3-ACCEPT` is available and used as-is. No historical milestone is
renumbered; a future collision is disambiguated, not renumbered.

**Rev 2 closes the five review findings** (F-4 linearization boundary, E-2
deterministic failure fixture, G-4/H-1 exact run lifecycle, E-3 field placement,
F-1 concurrency parameters) and **resolves the four environment questions** with
the operator's chosen configuration.

## Why this gate exists — CI is not acceptance evidence

Green CI and two-axis reviews establish **implementation confidence**: unit/
integration suites, architecture guards, typechecks, and the parity/concurrency
suites run against the merged tree.

They do **not** establish **integrated acceptance**: a real operator client
authenticating against a running Inspector, a real decision flowing through the
existing approval lifecycle, durable evidence surviving restart, and racing
decisions resolving deterministically. This plan produces that evidence,
separately from CI, and each row names its own artifact.

**Change under acceptance:** SRAP-1 G3 as merged — A/B (#959), A′ (#961), C
(#962), C remediation (#963). Remote decisions remain **default-off**; acceptance
enables the flag only inside the isolated acceptance workspace.

## Execution boundaries (binding)

- No new approval authority, scheduler, ledger, or execution path.
- No changes to the merged G3 implementation **unless acceptance reveals a
  concrete defect** — then stop, file it, and re-enter review; do not patch inside
  the acceptance run.
- No destructive testing against production credentials or live workloads. All
  rows run in the isolated acceptance environment below.
- No milestone marked complete until evidence is reviewed.

## Environment (resolved — operator decision)

| Question | Resolved configuration |
| --- | --- |
| Workspace | A fresh, disposable ALiX **acceptance fixture** outside the production state directory. The run sets its own state root (`XDG_STATE_HOME` / the platform override) and project root; nothing reads or writes `~/.config/alix`, `~/.local/state/alix-inspector`, or any production approval/credential store. |
| Transport | A **real local TLS reverse proxy** terminating HTTPS and forwarding to the Inspector with `X-Forwarded-Proto: https`, with the proxy's immediate peer CIDR added to `ui.security.trustedProxyCidrs`. Untrusted-peer and ambiguous/protocol-mismatch denials are explicit rows. |
| Coordination fixture | A **purpose-built, deterministic coordination run** with a genuine approval gate and observable worker continuation (not a synthetic state file). |
| Evidence | Versioned acceptance artifacts under a dedicated run directory (`<acceptance-root>/runs/<timestamp>/`…), **secrets redacted**, with a reviewer **sign-off manifest** listing every row → artifact → verdict. |

## Common prerequisites

| Prereq | Detail |
| --- | --- |
| P-ENV | Isolated acceptance fixture root; fresh `.alix/`; `ui.security.remoteDecisions.enabled = true` for this workspace only |
| P-TLS | Real local TLS reverse proxy (trusted CIDR) for the allow rows; direct-TLS and untrusted-peer paths exercised separately |
| P-KEY | An active `srap-evidence` key exists (version ≥ 1) |
| P-PRIN | An operator principal (`prin_*`) bound to the credential used |
| P-SCOPE | The credential's `workspaceIds` explicitly and nonempty-contains the canonical server workspace |
| P-CLIENT | A separate HTTP client process from the server, holding a bearer token |
| P-APPROVAL | A pending, unexpired approval resolvable through `ApprovalStore` |

## Linearization boundary (review finding 1, normative)

Authentication reads the credential's current principal on **every** request
(A′); the effect of a disablement is therefore the **next request boundary**.
Precisely:

- A request is **authorized** iff its principal read observed `status: "active"`.
- The **commit point** is the authoritative `ApprovalStore.resolveWithEvidence`
  ledger append.
- A decision committed from an `active` authorization read is **legitimate and
  terminal** — a later disablement never reverses it (decisions are terminal;
  disablement gates *future* requests only).
- A decision **must not** commit when its authorization read observed
  `disabled`/missing/unreadable.
- Disablement is **authoritative** once its principal write completes.

Acceptance must demonstrate the two sequential orders deterministically, and show
a concurrent run always resolves to one of them — **never** a commit whose
decision evidence is attributed to a principal disabled before that request's
authorization read.

## Acceptance matrix

Each row: prerequisites → **expected** → evidence artifact → pass/fail criterion.

### 1. Authentication

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| A-1 | Valid bearer credential | P-ENV, P-TLS, P-KEY, P-PRIN, P-SCOPE, P-CLIENT, P-APPROVAL | **200**; approval resolved to the posted decision | HTTP response + `approval.updated` ledger record + `credential.key_read` audit record | pass iff 200 **and** the ledger shows the decision **and** one key-read record exists |
| A-2 | Invalid bearer token | A-1 setup, token mutated | **401** `authentication_required`; no approval state touched | HTTP response; approval still `pending` | pass iff 401 and approval unchanged |
| A-3 | Missing credential | no `Authorization` header | **401**; no state disclosure | HTTP response | pass iff 401 and body carries no approval fields |
| A-4 | Revoked credential | revoke the credential first | **401/403** (denied by the A′ layer before the route) | HTTP response + `token.revoked` audit record | pass iff denied and no `credential.key_read` emitted |

### 2. Principal identity (G3-A′)

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| B-1 | Active principal | A-1 setup | **200**; decision `principalId` equals the bound principal and is the audit `actor` | HTTP response + ledger evidence + audit record | pass iff 200 and `principalId` matches in both |
| B-2 | Disabled principal | disable the principal first | **401/403** — every bound credential denied **all** authentication (bearer **and** cookie) | HTTP responses (both transports) + `principal.disabled` audit record | pass iff both transports denied and no decision applied |
| B-3 | Missing principal | delete `principals.json` (or bind to a non-existent principal) | **401/403** fail closed; no decision; no key-read record with an actor | HTTP response; absence of `credential.key_read` for the attempt | pass iff denied and no decision/evidence persisted |

### 3. Workspace authorization

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| C-1 | Authorized workspace | `workspaceIds` contains the canonical workspace | **200** | HTTP response + ledger record | pass iff 200 |
| C-2 | Unauthorized workspace | nonempty `workspaceIds` excluding the canonical workspace | **403** `workspace_scope_required`; no state read | HTTP response; approval `pending` | pass iff 403 and approval unchanged |
| C-3 | Missing/empty scope | legacy unscoped credential; and explicitly empty scope | **403** for both (`[]` never means "all") | HTTP response ×2 | pass iff both 403 |

### 4. Remote decisions

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| D-1 | Approve | A-1 setup | **200**; approval `approved` | ledger `approval.updated` + audit record | pass iff 200 and status `approved` |
| D-2 | Deny | fresh pending approval | **200**; approval `denied` | ledger `approval.updated` | pass iff 200 and status `denied` |
| D-3 | Exact retry | repeat D-1 with identical `principalId`+`nonce`+`decision` | **200** `{ idempotent: true }`; **no** second transition | HTTP body + exactly one `approval.updated` for the decision | pass iff idempotent 200 and exactly one transition |
| D-4 | Conflicting retry | same approval, different `decision` (or `nonce`) | **409** `conflict`; no state echoed | HTTP response | pass iff 409 and body is `{error:"conflict"}` |

### 5. Durable evidence

**Field placement (review finding 4, normative).** Two different authoritative records carry
two different field sets; acceptance must not conflate them:

| Record | Store | Carries | Must NOT carry |
| --- | --- | --- | --- |
| **Key-read audit** (`credential.key_read`) | audit chain (`.alix/audit`) | key version, operation, outcome, timestamp, non-secret actor | key material, credential record id, **`credentialRef`**, request payload |
| **Decision evidence** (`approval.updated` → projected `AuditRemoteDecision`) | approvals ledger → audit projection | `decisionId`, `principalId`, **`credentialRef`** (the HMAC), `transport`, `decidedAt` | key material, raw bearer token, cookie, raw credential id |

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| E-1 | Successful audit | A-1 setup | one `credential.key_read` record: `keyVersion`, `keyOperation:"sign"`, `keyOutcome:"ok"`, timestamp, non-secret `actor`; **no** `credentialRef`, key material, credential id, or payload | `alix audit by-action credential.key_read` | pass iff the record exists, is complete, and a secret/identifier scan of it is clean |
| E-2 | Audit failure (deterministic) | replace the audit-log **file** with a **directory** at `.alix/audit/audit.jsonl` (EISDIR) — privilege-independent, no mock, no open-fd assumption | the **real** append fails → **503** `evidence_unavailable`; approval stays `pending`; a bounded diagnostic is emitted | HTTP response + approval still pending + the stderr diagnostic line | pass iff 503, pending, **and** no decision/evidence persisted |
| E-2n | Failed-audit nuance (normative) | E-2 setup | a rejected sink fails the operation **closed** and emits a bounded diagnostic, but **cannot guarantee a durable record of the failed write itself** — the plan does not assert one | absence of a `credential.key_read` record for the attempt | pass iff the lack of a record is treated as expected, not as a failure |
| E-3 | Evidence integrity | A-1 setup | `alix audit verify` passes; the projected **decision** record's `decisionId`/`credentialRef`/decision match the ledger; the **key-read** record carries none of those | `alix audit verify` output + both records | pass iff the chain verifies, the decision record matches the ledger, and the key-read record is clean per the placement table |
| E-4 | Projection repair | skip/never-run inline projection, then run `alix approval project` | the outstanding decision(s) project idempotently; a re-run is a no-op with `lag 0` | `alix approval project` counters ×2 | pass iff the first run projects the outstanding decision(s) and the second reports nothing new with `lag 0` |

### 6. Concurrency

**Parameters (review finding 5, normative).** Concurrency level **N = 8**. All N requests are
released through a single barrier (the client opens all connections and fires the
bodies at the same instant). Client timeout: **30 s per request** (well above the
worst-case serialized commit budget: N × per-commit time, each bounded by the
store lock's 5 s acquisition timeout plus the audit/ledger appends). Retry policy:
a request that times out is **not** auto-retried inside the trial; the trial fails
and is recorded, then the row may be re-run once. A client must never observe a
partial commit.

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| F-1 | N=8 identical decisions, one barrier | A-1 setup | **exactly one** `approval.updated` transition; **all** 8 → **200** (the winner plus 7 idempotent `{idempotent:true}`); **no** 409; **no** request times out; key-read records = the number of requests that actually performed a key read (1 ≤ k ≤ N, each a pre-commit retry that committed nothing) | HTTP responses ×8 + ledger count + `credential.key_read` count | pass iff exactly one transition, eight 200s, zero 409s/timeouts, and no additional committed evidence |
| F-2 | Cross-principal conflict | principal A decides; principal B replays the same `nonce`+`decision` | B → **409**; A's decision intact | HTTP response + ledger record | pass iff 409 and the committed evidence is A's |
| F-3 | Racing decisions | two **different** decisions race the same approval | exactly one wins (**200**); the loser → **409** and commits **no** evidence of its own | HTTP responses + ledger evidence retry identity | pass iff one transition and the committed evidence matches the winner |
| F-4 | Disablement vs decision | run the two sequential orders, then T = 20 barrier-raced trials of {disable, decision} | Order 1 (disable first) → denied, no commit, no key read. Order 2 (decision first) → commit retained; a subsequent request denied. Every raced trial resolves to exactly one order | HTTP responses + `principal.disabled` record + decision `decidedAt` + harness-recorded disable-completion time | pass iff no commit's `decidedAt` is later than the disable-completion time of its trial, and a post-commit re-read shows the principal still `active` **or** `disabled` with `disabledAt ≥ decidedAt` (see Linearization boundary) |

### 7. Restart recovery

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| G-1 | Pending approvals survive restart | a pending approval; restart the Inspector | the approval is still resolvable after restart | pre/post restart `GET /api/approvals` | pass iff present and still `pending` |
| G-2 | Persisted decisions survive restart | complete D-1; restart | decision **and** its evidence persist | ledger records + `credential.key_read` after restart | pass iff both survive unchanged |
| G-3 | Projection resumes | leave an unprojected decision, restart | the bounded startup trigger projects it (or is idempotent if already projected) | startup log + projection state (`lag 0`) | pass iff the decision is projected exactly once |
| G-4 | Resumed **run** lifecycle | see below | the blocked run resumes through the **existing** lifecycle | see artifact list below | pass iff all of the following are recorded and consistent |

**G-4 / H-1 required artifacts (review finding 3, normative).** A synthetic state file is not
acceptable. The fixture is a purpose-built deterministic coordination run that
**genuinely blocks on an approval**; the run must record, before and after the
decision:

1. `coordinationRunId` and the blocking `approvalId`.
2. The approval's transition evidence: `approval.created` (pending) and the
   `approval.updated` produced by the decision.
3. **Worker continuation**: the worker(s) gated by that approval showing
   `blocked`/`pending` → `running` → `completed` (state snapshots before/after).
4. The **final run outcome**: terminal run status and, where produced, the
   coordination aggregate/result, resolved by run identity.
5. **Proof of the existing path**: the run resumes via the documented
   approval-resolution / `shouldReclaimWorker` path with its original
   `hostKind`/`sessionMode`; no new execution surface appears (compare the
   authority checklist in H-3).

Read-back uses the sanctioned tools (`alix_coordination_status` /
`alix_coordination_list` / `alix_coordination_results`).

### 8. End-to-end lifecycle

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| H-1 | Separate client → decision → lifecycle resumes | P-CLIENT on a different process than the server; the G-4 blocked run | the operator authenticates from the separate client, posts the decision, and the **existing** approval lifecycle observes the resolution and continues the run (worker continuation + terminal outcome per G-4) | client transcript + server log + G-4 artifact list + run state | pass iff the run continues via the existing lifecycle with the operator principal and evidence attributed end-to-end |
| H-2 | Default-off verified | flag unset | every request → **404**; no evidence, no audit record | HTTP response | pass iff 404 and no side effects |
| H-3 | No new authority | full run | no new approval authority, scheduler, ledger, or execution path is introduced | authority checklist (`detect-changes`-equivalent review of the acceptance run) | pass iff none added |

## Evidence review

Acceptance completes when every row has a recorded artifact, a verdict against
its criterion, and a reviewer's sign-off in the manifest. CI results are attached
as supporting context, never as the acceptance evidence itself. Any failing row
stops the run: file the defect, re-enter review, and re-run the affected rows only
after the fix is merged.

## Out of scope

- Running acceptance (this document authorizes nothing until approved).
- Any change to G3 runtime behaviour, approval authority, ledger, or execution.
- New approval/audit mechanisms; the key-read audit reuses the existing chain.
