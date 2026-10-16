# SRAP-G3-ACCEPT — integrated acceptance plan (proposal)

Status: **PROPOSED — not executed.** Planning only. No acceptance run may start
until this matrix is reviewed and approved; no milestone is marked complete until
its evidence is reviewed.

Milestone identifier: **`SRAP-G3-ACCEPT`**. Collision check performed 2026-10-15
against the `boduga/ALiX` tracker and `docs/`:

| Surface | Result |
| --- | --- |
| Labels | no `SRAP*` / `G3*` / `*ACCEPT*` label exists |
| Milestones | none configured on the repository |
| Issues (open + closed) | no `SRAP-G3-ACCEPT`; the only SRAP-named issue is #954 (closed) |
| `docs/` | no reference to `SRAP-G3`, `G3-ACCEPT`, or an acceptance plan |

`SRAP-G3-ACCEPT` is therefore available and is used as-is. No historical
milestone is renumbered; if a future identifier collides, it is disambiguated
rather than renumbering the past.

## Why this gate exists — CI is not acceptance evidence

Green CI and two-axis reviews establish **implementation confidence**: unit/
integration suites, architecture guards, typechecks, and the parity/concurrency
suites all run against the merged tree.

They do **not** establish **integrated acceptance**: a real operator client
authenticating against a running Inspector, a real decision flowing through the
existing approval lifecycle, durable evidence surviving restart, and concurrent
racing decisions resolving deterministically. This plan produces that evidence,
separately from CI, and each row names its own artifact.

**Scope of the change under acceptance:** SRAP-1 G3 as merged — A/B (#959),
A′ (#961), C (#962), C remediation (#963). Remote decisions remain **default-off**;
acceptance enables the flag only in an isolated acceptance workspace.

## Execution boundaries (binding)

- No new approval authority, scheduler, ledger, or execution path.
- No changes to the merged G3 implementation **unless acceptance reveals a
  concrete defect** — in which case, stop, file it, and re-enter review; do not
  patch inside the acceptance run.
- No destructive testing against production credentials or live workloads. All
  rows run in an isolated acceptance workspace with throwaway principals,
  credentials, and approvals.
- No milestone marked complete until acceptance evidence is reviewed.

## Common prerequisites

| Prereq | Detail |
| --- | --- |
| P-ENV | Isolated acceptance workspace root; `.alix/` fresh; `ui.security.remoteDecisions.enabled = true` for this workspace only |
| P-TLS | Either direct TLS to the server, or an immediate peer inside `ui.security.trustedProxyCidrs` forwarding one unambiguous `X-Forwarded-Proto: https`; plaintext from an untrusted peer is a deny row, not a setup error |
| P-KEY | An active `srap-evidence` key exists (`alix`/credential store, version ≥ 1) |
| P-PRIN | An operator principal (`prin_*`) bound to the credential used |
| P-SCOPE | The credential's `workspaceIds` explicitly and nonempty-contains the canonical server workspace |
| P-CLIENT | A separate HTTP client from the server process (curl or equivalent), holding a bearer token — not the cookie session |
| P-APPROVAL | A pending, unexpired approval resolvable through `ApprovalStore` |

## Acceptance matrix

Each row: prerequisite → **expected** → evidence artifact → pass/fail criterion.

### 1. Authentication

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| A-1 | Valid bearer credential | P-ENV, P-TLS, P-KEY, P-PRIN, P-SCOPE, P-CLIENT, P-APPROVAL | `POST /api/approvals/:id/decision` → **200**; approval resolved to the posted decision | HTTP response + `approval.updated` ledger record + `credential.key_read` audit record | pass iff 200 **and** ledger shows the decision **and** one key-read record exists |
| A-2 | Invalid bearer token | A-1 setup, token mutated | **401** `authentication_required`; no approval state touched | HTTP response; approval still `pending` | pass iff 401 and approval unchanged |
| A-3 | Missing credential | no `Authorization` header | **401**; no state disclosure | HTTP response | pass iff 401 and body carries no approval fields |
| A-4 | Revoked credential | revoke the credential first (`alix inspector auth revoke`) | **401** (denied by the G3-A′ authentication layer before the route) | HTTP response + `token.revoked` audit record | pass iff 401 and no `credential.key_read` emitted |

### 2. Principal identity (G3-A′)

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| B-1 | Active principal | A-1 setup | **200**; the decision's `principalId` equals the bound principal and appears as the audit `actor` | HTTP response + ledger evidence + audit record | pass iff 200 and `principalId` matches on both |
| B-2 | Disabled principal | disable the principal (`alix inspector auth principal disable`) | **401/403** — every bound credential denied **all** authentication (bearer and cookie) | HTTP responses (bearer + cookie) + `principal.disabled` audit record | pass iff both transports denied and no decision applied |
| B-3 | Missing principal | delete `principals.json` (or bind to a non-existent principal) | **401/403** fail closed; no decision; no key-read record with an actor | HTTP response + absence of `credential.key_read` for this attempt | pass iff denied and no decision/evidence persisted |

### 3. Workspace authorization

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| C-1 | Authorized workspace | `workspaceIds` contains the canonical workspace | **200** | HTTP response + ledger record | pass iff 200 |
| C-2 | Unauthorized workspace | `workspaceIds` nonempty, excludes the canonical workspace | **403** `workspace_scope_required`; no state read | HTTP response; approval `pending` | pass iff 403 and approval unchanged |
| C-3 | Missing/empty workspace scope | legacy unscoped credential; and explicitly empty scope | **403** for both (`[]` never means "all") | HTTP response ×2 | pass iff both 403 |

### 4. Remote decisions

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| D-1 | Approve | A-1 setup | **200**; approval `approved` | ledger `approval.updated` + audit record | pass iff 200 and status `approved` |
| D-2 | Deny | fresh pending approval | **200**; approval `denied` | ledger `approval.updated` | pass iff 200 and status `denied` |
| D-3 | Exact retry | repeat D-1 with identical `principalId`+`nonce`+`decision` | **200** `{ idempotent: true }`; **no** second ledger transition | HTTP body + exactly one `approval.updated` for the decision | pass iff idempotent 200 and exactly one transition |
| D-4 | Conflicting retry | same approval, different `decision` (or different `nonce`) | **409** `conflict`; no state echoed | HTTP response | pass iff 409 and body is `{error:"conflict"}` |

### 5. Durable evidence

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| E-1 | Successful audit | A-1 setup | one `credential.key_read` record: `keyVersion`, `keyOperation:"sign"`, `keyOutcome:"ok"`, timestamp, non-secret `actor` — **no** key material, credential id, or payload | `alix audit by-action credential.key_read` (or the audit chain) | pass iff the record exists, is complete, and a secret scan of it is clean |
| E-2 | Audit failure | make the audit log unwritable for the acceptance workspace | **503** `evidence_unavailable`; approval stays `pending`; a bounded diagnostic is emitted | HTTP response + approval still pending + stderr line | pass iff 503, pending, **and** no decision/evidence persisted |
| E-3 | Evidence integrity | A-1 setup | the projected audit chain verifies (`alix audit verify`); the projected evidence matches the ledger record for the same `decisionId` | `alix audit verify` output + the projected record | pass iff the chain verifies and the projected `decisionId`/`credentialRef`/decision match the ledger |
| E-4 | Projection repair | disable/never-run inline projection, then `alix approval project` | the projection is applied idempotently; a re-run projects nothing new; lag returns to 0 | `alix approval project` output (counters) | pass iff first run projects the outstanding decision(s) and the second is a no-op with `lag 0` |

### 6. Concurrency

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| F-1 | Concurrent identical retries | fire N identical decisions concurrently | exactly one transition; the rest idempotent **200**; one key-read record per *actual* key read | HTTP responses + ledger count + audit count | pass iff exactly one transition and no conflicting 409 for identical requests |
| F-2 | Cross-principal conflict | principal A decides; principal B replays the same `nonce`+`decision` | B → **409**; A's decision intact | HTTP response + ledger record | pass iff 409 and the committed evidence is A's |
| F-3 | Racing decisions | two **different** decisions race the same approval | exactly one wins (200); the loser **409** with no evidence of its own committed | HTTP responses + ledger evidence retry identity | pass iff one transition, the committed evidence matches the winner, loser emitted no evidence |
| F-4 | Disablement vs decision race | disable the principal while a decision is in flight | deterministic: either the decision completes under an active principal, or it is denied — never a decision attributed to a disabled principal | HTTP responses + `principal.disabled` record + ledger evidence | pass iff no decision is attributed to a disabled principal |

### 7. Restart recovery

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| G-1 | Pending approvals survive restart | a pending approval; restart the Inspector | the pending approval is still resolvable after restart | pre/post restart `GET /api/approvals` | pass iff the approval is present and still `pending` |
| G-2 | Persisted decisions survive restart | complete D-1; restart | the decision and its evidence persist | ledger records + `credential.key_read` after restart | pass iff both survive unchanged |
| G-3 | Projection resumes | leave an unprojected decision, restart the Inspector | the bounded startup trigger projects it (or is idempotent if already projected) | startup log + projection state (`lag 0`) | pass iff the decision is projected exactly once |
| G-4 | Resumed execution | an approval belonging to a coordination run; decide it, then restart | the existing approval lifecycle resumes through the **existing** path — no parallel execution path is created | coordination run state + worker outcomes | pass iff the run resumes via the existing lifecycle and no new execution surface appears |

### 8. End-to-end lifecycle

| ID | Test | Prereqs | Expected | Evidence artifact | Pass/fail |
| --- | --- | --- | --- | --- | --- |
| H-1 | Separate client → decision → lifecycle resumes | P-CLIENT on a different host/process than the server; a run blocked on an approval | the operator authenticates from the separate client, posts the decision, and the **existing** approval lifecycle (not a parallel path) observes the resolution and continues | client transcript + server log + run state | pass iff the run continues via the existing lifecycle, with the operator principal and evidence attributed end-to-end |
| H-2 | Default-off verified | acceptance workspace with the flag unset | every request → **404**; no evidence, no audit record | HTTP response | pass iff 404 and no side effects |
| H-3 | No new authority | full run | `detect-changes`-equivalent review of the acceptance run shows no new approval authority, scheduler, ledger, or execution path | change/authority checklist | pass iff none added |

## Evidence review

Acceptance completes when every row has: a recorded artifact, a pass/fail
verdict against its criterion, and a reviewer's sign-off. CI results are attached
as supporting context, never as the acceptance evidence itself. Any failing row
stops the run: file the defect, re-enter review, and re-run the affected rows
only after the fix is merged.

## Open questions for the operator (resolve before the run)

1. Acceptance workspace location and whether it is a scratch repo or a fixture.
2. How the trusted-proxy TLS path is provided in the acceptance environment
   (real proxy vs a loopback CIDR fixture) — D-rows and the deny rows must both
   be exercised.
3. Whether G-4/H-1 use a purpose-built coordination run or an existing fixture.
4. Who reviews the evidence, and where the artifacts are stored.
