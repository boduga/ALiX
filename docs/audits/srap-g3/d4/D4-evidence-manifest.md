# SRAP-G3-ACCEPT — D4 closure evidence manifest (rev 5)

**Status: SUBMITTED FOR INDEPENDENT REVIEW — NOT CLOSED.**

Rev 5 addresses six successive independent reviews, each of which returned
**D4 FAIL**. Every blocking condition raised is now either fixed with a new
artifact or recorded as an explicit limitation. Three of those reviews caught me
making false claims about the fixture verifier; the verifier section below states
its real limits rather than a capability claim. I have been wrong about the fixture verifier three times; every claim
below is limited to what an artifact in this directory shows.

- **Pinned commit:** merged `main` `f3259004` (documentation HEAD). The
  **binary that produced the runs** is the build at `93437e6f`; `git log
  93437e6f..f3259004 -- src/` is empty, so the two are identical in product code.
  No build stamp was recorded in the fixture logs, so the binary identity is
  inferred from the empty diff, not attested by an artifact.
- **Fixture root:** `/tmp/opencode/alix-srap-accept/20261017T164036Z-309922`
- **Run dir:** `$ROOT/runs/20261017T164036Z/`
- **Audit chain (authoritative):** **276** records, tip seq 276 `1d305c9fc456…`,
  `alix audit verify` → **OK, 0 findings**; export **byte-identical** to live.
  (Counts embedded in the earlier sweep files are historical — see
  `SUPERSEDED-note.md`.)
- **Actions:** `integrity_enabled` 1, `credential.key_read` 209,
  `approval.approved` 65, `approval.denied` 1.
- **Projection:** 172 evidence-carrying approvals, 62 distinct projected
  decisionIds, 0 unprojected (see §3 for the granularity caveat).

## 1. Blocking conditions from review 4 — disposition

| # | Condition | Status |
| --- | --- | --- |
| 1 | Verifier default-to-true (prose accepted; missing `wantText` → true) | **FIXED** — `!wantFile \|\| !wantText` fails closed; tool evidence must match the runtime's real `Tool <name>, call <id>:` record shape. Five cases re-proved, incl. the prose-containing-"tool" bypass (§2). |
| 2 | E-2 pending-state unproven | **FIXED** — `state-proofs.txt`: pending → **503** → still pending, read through the authoritative CLI, with the diagnostic line. |
| 3 | C-2 approval-unchanged unproven | **FIXED** — `state-proofs.txt`: pending (no evidence) → **401** → pending (no evidence). |
| 4 | H-3 artifact contradicted §4 | **FIXED** — `h3-routes.txt` generated from `route-policy.ts` + handler guards; six POST routes. |
| 5 | H-1 transcript not reproducible (missing nonce) | **FIXED** — `state-proofs.txt` H-1 block includes `nonce` and the 200 + resulting approved state. |
| 6 | Stale 139/184/192 chain verifies | **DISCLOSED** — `SUPERSEDED-note.md` explains those are historical sweep captures; `audit-verify.txt` is authoritative. |
| 7 | Projection granularity overstated | **FIXED** — `projection-granularity.txt` states it plainly (below). |

## 2. Verifier behaviour (five cases, `verifier-cases.txt`) — and its real limits

Against an `## Assigned worker objective` of
`Create the file src/srap-g7-output.txt containing the text srap-g7-verified`:

| Case | Verdict |
| --- | --- |
| empty evidence | `satisfied:false` — file, content, and no executed tool evidence |
| prose only | `satisfied:false` — no executed tool evidence |
| prose containing the word "tool" | `satisfied:false` — no executed tool evidence |
| **wrong** file + a real tool-result record | `satisfied:false` — required file not evidenced |
| assigned file + a real tool-result record | `satisfied:true` |

Fail-closed conditions: an unparseable objective, or one with no file/text
deliverable, returns `satisfied:false`.

**Genuine negative control** (`negative-control.txt` summary + `NEG-after.json` worker error): a run whose planner emitted
required content `WRONG-CONTENT` while the root goal required `NEG-EXPECTED`, with
the write **inside** the owned scope, ended
`Objective review: required content "WRONG-CONTENT" not evidenced` → run
**failed**. That is a verifier rejection, not an ownership denial.

**This is a deterministic string/evidence matcher, not a semantic judge.** Its
known residual holes, which I am not claiming it closes:

- substring matching — `src/srap-g7-output.txt.bak` satisfies a required
  `src/srap-g7-output.txt`, and a superstring satisfies required content;
- any tool record of the right shape counts, regardless of which tool ran or
  whether it succeeded;
- a forged `Tool …, call …:` string inside untrusted evidence would satisfy the
  tool check;
- it cannot judge quality, correctness, or intent.

It is adequate to prove **"the worker produced the assigned file containing the
assigned text, via a tool call, inside the owned scope"** — which is what G-4/H-1
needs — and nothing stronger.

## 3. Projection granularity (review condition 7)

`projection-granularity.txt`:

- evidence-carrying approvals: **172**
- distinct decisionIds: **62**, of which **62 projected**, **0 unprojected**
- decisionIds shared by more than one approval: **19** (max 34 approvals share one)

The audit projection is keyed by `decisionId`, so a shared `decisionId` produces
**one** audit row covering several approvals. "Projected" is therefore proven at
**decisionId granularity**, not per-approval. This is by design (the ledger
dedups on `decisionId`) but is stated here so it is not over-read.

## 4. G-4 / H-1

- Negative control (`negative-control.txt` and `NEG-after.json`): planner emitted required content
  `WRONG-CONTENT` under a root goal requiring `NEG-EXPECTED`, with the write
  **inside** the owned scope. The run failed with
  `Objective review: required content "WRONG-CONTENT" not evidenced` — a verifier
  rejection, not an ownership denial.
- Earlier control `coord_924e0808` failed on an ownership-scope denial
  (`file.create denied`), **not** on verifier rejection; it is not cited as
  verifier evidence.
- Accepted run `coord_a3a0758d-b7d3-4337-a0ce-fee68bdc19cf`: `rootGoal` == worker
  `goalPrompt` == `Create the file src/srap-g7-output.txt containing the text srap-g7-verified`;
  deliverable `srap-g7-verified`; status `completed`, outcome `success`;
  `hostKind daemon`, `sessionMode ask`, `executionOwnerId daemon-326553`.
- H-1 client request (with `nonce`) → 200 → approval `approved` with evidence.

## 5. F-4

`f4-final-v2.json`: 20/20 valid, **0 fails**; 10 committed (**all** dispatched
before the disable; `ivOk:true` on all, post-commit re-read `disabled` with
`disabledAt` ≥ dispatch); 10 denied (**all** dispatched after). `f4-order1.txt`:
disable-completes-then-dispatch → **401 `principal_disabled`**, approval
`pending`, key-read delta **0**.

## 6. H-3 — POST surface (`h3-routes.txt`, from source)

`POST /api/auth/session` · `POST /api/auth/logout` ·
`POST /api/coordination/run` · `POST /api/coordination/:runId/cancel` ·
`POST /api/security/evidence/verify` · `POST /api/approvals/:id/decision`.

One approval authority (`ApprovalStore.resolveWithEvidence`).

**Product-change window, stated precisely.** After the fixture was pinned at
`93437e6f`, `git log 93437e6f..f3259004 -- src/` is **empty** — **zero** product
changes during the D4 evidence window.

Across the wider gate window (since 2026-10-16) the `src/` commits on `main` are
**7**: `cb13fc0e`, `86855978`, `05b2dcce`, `0d4cece9`, `9a5be953`, `ea629183`,
`e603e15d` (D1/D2 work, all merged before D3 was authorized) plus `2f10894e`,
`d6f126e7` (#976). `e603e15d` touches coordination authorization/scheduler
internals — again **D2 work, pre-dating the D3 authorization**, not a change made
during acceptance. **No commit in the D4 evidence window touched `src/` at all**,
and none of the gate-window commits adds a new approval authority, ledger, or
execution path.

## 7. E-4 disclosure (unchanged from rev 4)

First repair projected the outstanding decision (`1 projected`, `lag 11`); the
re-run was a no-op (`0 projected`, `lag 0`). **The outstanding decision was
hand-seeded** (`policyRevision manual`, `bindingKey bk-e4live-…`,
`credentialRef hmac-sha256:v1:AAAA…`, no `credential.key_read`): it exercises the
projection machinery, not the signing path, and must not be counted as a real
operator decision.

## 8. Row verdicts

| Group | Rows | Status |
| --- | --- | --- |
| Auth | A-1, A-2, A-3 | SUPPORTED |
| Auth | A-4 | SUPPORTED (`A4-revoked-credential.txt`: 401 `token_revoked`, `token.revoked` bound to `prin_uWXSJw6eQuUB`, key-read delta 0, approval still `pending` in the ledger) |
| Principal | B-1, B-2, B-3 | SUPPORTED |
| Workspace | C-1, C-3a | SUPPORTED |
| Workspace | C-2, C-3b | SUPPORTED\* — **deviation needing explicit acceptance**: plan requires 403, product returns 401 `workspace_mismatch`; same fail-closed outcome, `[]` never means all |
| Decisions | D-1, D-2, D-3, D-4 | SUPPORTED |
| Evidence | E-1, E-2, E-3 | SUPPORTED (`E1-key-read.txt` (scoped to key-read records); `state-proofs.txt`) |
| Evidence | E-4 | SUPPORTED with §7 disclosure |
| Concurrency | F-1, F-2, F-3 | SUPPORTED (`F1-raw-clean.json` 8×200 / one commit; `F2-cross-principal-artifact.txt` 409 + A's evidence retained; `F3-raw-clean.json` one 200 / one 409) |
| Concurrency | F-4 | SUPPORTED (incl. criterion (iv)) |
| Restart | G-1, G-3, G-4 | SUPPORTED |
| Restart | G-2 | SUPPORTED (`G2-restart-artifact.txt`: evidence + `credentialRef` byte-identical across a restart with the port verified free; key-read and chain unchanged) |
| Lifecycle | H-1, H-2, H-3 | SUPPORTED (`H1-client-transcript.txt`: nonce, headers, body, 200, terminal `completed`/`success`, rootGoal == goalPrompt == deliverable; `h3-routes.txt`) |
| Untrusted-peer | — | SUPPORTED (403 from a source outside `127.0.0.1/32`; trusted control 200) |

## 9. Artifact index

`row-evidence.txt`, `missing-row-artifacts.txt`, `remaining-artifacts.txt`,
`verifier-cases.txt`, `state-proofs.txt`, `h3-routes.txt`, `negative-control.txt`,
`E1-key-read.txt`, `NEG-after.json`, `H1-after.json`,
`projection-granularity.txt`, `audit-chain.jsonl`, `audit-head.json`,
`audit-verify.txt`, `decisions.json`, `G1-pre.txt`, `G1-post.txt`,
`G3-projection.txt`, `G4-before.json`, `G4-after.json`,
`H1-client-transcript.txt`, `f4-final-v2.json`, `f4-order1.txt`,
`SUPERSEDED-note.md`, `d3-execution-report-rev2.md`, `d3-f4-untrusted-peer.md`.

Secret/identifier scan over the exported chain: **CLEAN**.

## 10. Known limitations (not waived)

1. The objective reviewer is the deterministic fixture model (§2).
2. F-1/F-2/F-3 raw harness output was not retained (LIMITED).
3. G-2 has no restart log line; the claim rests on snapshot comparison.
4. E-4 uses a hand-seeded decision (§7).
5. The fixture root is disposable and was mutated across review rounds; running
   artifacts (chain, approvals) grow between manifests. Each manifest states its
   own authoritative counts.
6. **C-3a artifact contains two results** — `row-evidence.txt` line 14 shows
   `409` (an earlier attempt against an already-decided approval) and line ~56
   shows the valid `403 workspace_scope_required`. The 403 line is the C-3a
   result; the 409 is retained for auditability.
7. **A-2 message differs from the plan** — observed `401 invalid_token`; the plan
   text says `401 authentication_required`. Same denial class, different code.
8. **A-4 attribution** — the `token.revoked` record carries the revoked
   credential's own principal (`prin_WeiFXPP6yNoJ`), not the operator principal
   used for the decision rows. It is the correct credential's audit record, but
   the principals differ by design (a throwaway credential was revoked).
9. **G-4 artifact #2 is not in the audit chain.** The chain contains **0**
   `approval.created` and **0** `approval.updated` records — its actions are only
   `audit.integrity_enabled`, `credential.key_read`, `approval.approved`,
   `approval.denied`. The creation and transition facts live in the **approval
   ledger** (`createdAt` / `remoteDecisionEvidence`), not in the exported chain.
   The plan's G-4 item 2 asks for both; they are evidenced via the ledger and the
   projected `approval.approved` record, not as `approval.created`/`updated` rows.
10. **Harness interference (important).** An early F-1 run produced 1×200 +
    7×409. The cause was **my own harness**: the long-lived daemon ticks and
    *consumes* the single-use approval mid-barrier, so later requests see a
    consumed approval. With the daemon stopped, F-1 is 8×200 and one commit. This
    is a test-methodology trap, not a product defect — but it also means an F-1
    run against a live daemon is invalid. The retained `F1-raw.json` (7×409) and
    `F1-raw-clean.json` (8×200) are both kept so the discrepancy is auditable.
11. The untrusted-peer test uses loopback source addresses (`127.0.0.2`) against a
   `127.0.0.1/32` trust list, not a physically separate host.

## 11. Reviewer sign-off (required for D4 closure)

| Item | Reviewer |
| --- | --- |
| Row verdicts and deviations accepted | _pending_ |
| Artifact integrity and secret scan re-checked | _pending_ |
| H-3 authority checklist confirmed | _pending_ |
| E-4 method accepted or re-run required | _pending_ |
| Known limitations (§10) accepted as out of scope | _pending_ |
| Final D4 verdict | _pending_ |

**This manifest does not close D4.**
