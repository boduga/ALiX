# D9 Phase F — REQ 4 historical Vitest evidence reconciliation

Date: 2026-11-02 (UTC)
Status: **INCONCLUSIVE — retained, not reconstructed**

## What REQ 4 asked

> "Reconcile historical missing Vitest evidence explicitly as INCONCLUSIVE or
> supersede the *specific* acceptance obligation with independently retained new
> evidence, without claiming historical hash verification."

Two paths were permitted. This record takes **both**, in this order: declares the
historical artefact INCONCLUSIVE, then supersedes the specific obligation with
newly retained evidence — and is explicit that the second does not repair the
first.

## The historical artefact

```
SHA-256  dd9901e79ceb2838787c8836641c476894e8c547315d2d90afce7fade35472e7
path     review-artifacts/D9-phase-f-independent-vitest-inconclusive-09f95641.log
```

Two historical evidence documents record this hash. The bytes were never
retrievable.

Re-checked on 2026-11-02, not carried forward on trust:

| Probe | Result |
|---|---|
| `git cat-file -t dd9901e7…` | `fatal: Not a valid object name` |
| Working tree search for `*independent-vitest*` | no match outside `node_modules` |

The prior packet also ran a bounded unreachable-object scan (193 dangling blobs)
and found no blob whose raw SHA-256 matched. Nothing since has changed that.

**Disposition: INCONCLUSIVE.** Not PASS, not FAIL. The claim "these tests passed
on that historical tree" is unverifiable, and no amount of later test execution
can make it verifiable retroactively. A hash recorded without retrievable bytes is
a pointer to nothing.

## Supersession — what replaces it, and what it does not replace

The *specific acceptance obligation* was: demonstrate that the Vitest-scoped
security and crash/recovery suites pass on a named candidate tree, with retained
evidence.

That obligation is now met by execution on a tree that still exists:

- `D9-phase-f-req1-x86-64-qualification-2026-11-02.md`
- `evidence/d9-x86-64-2026-11-02/` — 16 retained artefacts, `SHA256SUMS` verified
- Commit `f0e0d89e221c8dcb61a4fe1868102de5b9c7e721`, tree `577f3831…`
- Lockfile and `package.json` SHA-256 recorded, so the dependency graph is pinned,
  not inferred

**This supersedes the obligation. It does not reconstruct the historical
artefact.** The distinction is load-bearing:

- The fresh evidence says: *these suites pass on this tree, now, verifiably.*
- It does **not** say: *they passed on the historical tree, and here are the
  bytes.* That claim remains INCONCLUSIVE and always will.

No document in this repository should cite the fresh run as verification of the
historical result. If a future reader needs the historical claim, the answer is
"unverifiable", not "check the 2026-11-02 logs".

## Why not simply delete the historical claim

Because deleting it would remove the only record that the gap existed. An
INCONCLUSIVE row that names its own hash is more honest than an absent row: it
tells the next auditor exactly which artefact cannot be produced and why the
acceptance obligation was re-based rather than satisfied.

## Effect on the Phase F verdict

REQ 4 is reconciled **as a documented INCONCLUSIVE with a scoped supersession**.
That is the outcome REQ 4 explicitly allowed.

It does **not** clear Phase F. The verdict remains **HOLD** pending:

- REQ 2 — independent review (in progress, delegated; a model review is not human
  independence)
- REQ 3 — owner security-exception clearance
- REQ 5 — Harness Gate E clause-by-clause reconciliation
- REQ 6 — re-assertion of the zero-loss / fail-closed / Q13 invariants
