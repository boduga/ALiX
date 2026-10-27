# Harness closeout — operator authorization record

Date: 2026-10-23
Operator statement: "Everything is now authorised" (in response to a listed
blocking set: 23 unreconciled acceptance rows, Gates B/C/D/E/F HOLD, human
review n=0, P0-E unauthorized).

## What this record does

It records that the operator authorized the **work**, so nothing below is
blocked on permission any more. It does **not** record that any result was
obtained. An authorization is not evidence, and this file must never be cited as
though a gate passed.

## Authorized by this record

| Previously blocked on | Now permitted | Still requires its own evidence |
|---|---|---|
| P0-E ablations (Gate C) | Running paired ablation arms | A completed paired run with both arms and an accept/retain verdict |
| Gate B evidence collection | Paid real-model measurement, repetitions, deny-case rerun | Qualified corpus, uncertainty rationale, signed acceptance |
| Gate D migration (MP-01…MP-03) | Implementation work | Implemented packages, reader/writer parity, Q04/Q05 owner approval |
| Gate E / F8b qualification | **Executed, then REJECTED by independent review** — 0 of 5 clauses qualified ([qualification](2026-10-24-gate-e-qualification.md), [review](evidence/2026-10-25-codex-gate-e-review.txt)) | Remediation of the eleven review defects, then mutation-checked proof per clause. Independence was obtainable and was used; it returned NO, so the gate stays HOLD. F8b release clearance remains a separate security track (P0-G) |
| Gate F technical packet | Assembling the qualification packet | Independent security clearance and maintainer signature |
| Gate F release decision | **Nothing further, mechanically** — the validator, its 18 tests and the recorded artifact are committed | The two authorities themselves: an independent clearance and the maintainer's decision. `release-clearance-record.mjs` computes `HOLD` until both exist for the exact commit |
| Row reconciliation | Re-reviewing all 32 rows at HEAD | The re-review itself |

## Not granted by an authorization, because it is not the operator's to grant

- **Gate E — independent qualification.** Independence means the qualifier is not
  the author. An operator waiving that does not create a second party; it records
  a decision to accept author-only testing, which is a different and weaker claim
  and must be labeled as such wherever it is used.
- **Human review observations (PRE-R017, PRE-R031).** `n=0` is a fact about how
  many humans reviewed, not a permission setting. Only actual review sessions
  change it.
- **Measured numbers.** Repetition counts, RTO values, cost-per-success and
  missed-risk rates come from runs, not approvals. Any row that needs a number
  stays open until a run produces it.
- **Gate F release clearance.** Q13 requires a documented independent security
  publication clearance and the authorized repository maintainer's decision for
  the exact artifact. An authorization cannot manufacture either. Unlike the
  Gate B measurement waiver, there is no waiver path: the clearance and the
  decision *are* the requirement, so waiving them removes it rather than
  substituting for an unmeasurable quantity.
  [`release-clearance-record.mjs`](../../benchmark/evidence/release-clearance-record.mjs)
  computes `HOLD` and refuses any record that carries a waiver.

## Consequence for the acceptance matrix

Rows must now be split by *why* they were open:

- **was blocked on authority** → reclassify to authorized, and state the run that
  still has to happen.
- **was blocked on missing evidence** → unchanged; authorization does not fill it.
- **was blocked on a third party or on humans** → unchanged, with the reason.

Collapsing all three into "authorized" would convert an approval into a PASS,
which is the failure this matrix exists to prevent.
