# Gate F / Q13 — every clause, and which ones a machine can actually observe

**Date:** 2026-10-24
**Scope:** the release gate, decomposed clause by clause against the same rule used
for Gate B: a human check is replaced only when an agent or machine can observe
**the same quantity**. Where it cannot, the check becomes a recorded decision —
never a substituted number.
**Artifact:** [release-clearance record](2026-10-24-gate-f-release-clearance-record.json),
validated by [`benchmark/evidence/release-clearance-record.mjs`](../../benchmark/evidence/release-clearance-record.mjs).

## 1. What the gate actually says

Q13 is stated as a set of **negative** tests, which is why part of it is
mechanical at all:

> "Negative tests reject release on missing/expired clearance, absent maintainer
> approval, mismatched artifact, or technical FAIL; immutable auditable decision
> evidence." — PRD-R082

Sources, all consistent:

| Source | Clause |
|---|---|
| `docs/ALiX_MASTER_PRD_v2.8.md` PRD-R082 (L247) | Gate publication on technical qualification + cleared independent security restrictions + explicit maintainer approval; persist both against the exact artifact; negative tests. |
| §14 Stage 1 (L528) | "Technical PASS does not authorize publication." Maintainer approves **after** restrictions are cleared; a maintainer decision cannot override an uncleared restriction. |
| §14 Stage 7 exit (L565) | Same three conditions at release; no automatic publication from passing tests. |
| §21 item 3 (L688) | Gate 7 stays HOLD; PRD approval does not lift it. |
| Q13 decision (L920) | Explicit authorized maintainer approval after technical qualification and clearance; record identity, scope, time, exact artifact. |
| §29.3 (L852) | "Neither a factory benchmark PASS nor a green CI suite clears an independent publication hold." |
| `ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §9 (L198) | Gate F — Release: technical evidence, independent security restriction clearance, explicit authorized maintainer approval tied to exact artifact. |
| `2026-10-23-harness-acceptance-matrix.md` (L109) | "Authorized to assemble; signature outstanding." |

## 2. Clause-by-clause: can a machine observe the same quantity?

| # | Clause | Agent/machine observes the same quantity? | Mechanism | What remains outside |
|---|---|---|---|---|
| 1 | Documented technical qualification | **Partly.** Mechanical gates are observable; a *release* qualification verdict is not — it is downstream of Gate B and Gate E | `technical.verdict` must be `pass`; `partial` and `fail` are both refused, with distinct reasons | The judgement that the qualification is complete enough to release |
| 2 | Clearance of every applicable independent security publication restriction, through its designated process | **No.** A second party must perform it | Presence, named authority, named process, expiry, and evidence-file existence are all checked | The review and the clearance. No agent can be the designated process |
| 3 | Explicit authorized maintainer approval | **No.** It is an authority, not a measurement | Presence, `signerClass`, identity named *inside* the cited artifact, scope, timestamp | The decision itself |
| 4 | Both decisions tied to the exact release artifact | **Yes** | Full 40-hex commit must match across all three blocks; `sha256` mismatch rejected; abbreviated or absent commit rejected | — |
| 5 | Negative: missing clearance | **Yes** | `clearance: null` → HOLD | — |
| 6 | Negative: expired clearance | **Yes** | `expiresAt <= now` → HOLD | — |
| 7 | Negative: absent maintainer approval | **Yes** | `approval: null` → HOLD | — |
| 8 | Negative: mismatched artifact | **Yes** | commit/sha256 disagreement → HOLD | — |
| 9 | Negative: technical FAIL | **Yes** | `verdict: "fail"` → HOLD even with clearance and approval present | — |
| 10 | Immutable auditable decision evidence | **Partly** | Cited evidence must exist, and the approval artifact must **name the signer** | That the committed evidence is genuinely immutable; that the signer read it |
| 11 | Maintainer cannot override an uncleared restriction | **Yes** | Self-cleared restriction (authority == approver) → HOLD; approval timestamped before clearance → HOLD | — |

### 2.1 One clause the validator does **not** prove

§29.3 says a green CI suite does not clear a publication hold. The validator reads
`technical.verdict` and cannot tell whether someone derived it from suite output.
It refuses `partial` and `fail`, and the committed record states `partial` — but the
honest limit is that **the verdict's provenance is not machine-verified**. It is a
declared input, and this document does not claim otherwise.

## 3. Why Gate F has no waiver path

Gate B closed with a waiver because GB-11 asked for a *measurement* — operator
review minutes — that no agent could take. Waiving it disposed honestly of an
unmeasurable quantity; a substitute number would have measured something else.

Q13 is different in kind. Its requirement **is** the clearance and the maintainer
decision. Waiving them would not substitute a different measurement for an
unmeasurable quantity — it would delete the requirement. So the validator rejects
any record carrying a `waiver`, and there is no `CLOSED-WITH-WAIVER` release
outcome. The vocabulary is deliberately:

```
RELEASE-AUTHORIZED                  — clearance from a distinct authority + maintainer decision
RELEASE-AUTHORIZED-SCOPE-DECISION   — maintainer determined no restriction is applicable; labelled weaker
HOLD                                — everything else
```

`RELEASE-AUTHORIZED-SCOPE-DECISION` exists because "no independent publication
restriction applies here" is a legitimate outcome *when an authorized party
determines it and signs it*. It is not independent clearance, and the rendered
report says so on its own line.

## 4. What an agent still cannot do

Two things, and neither is a failed measurement:

1. **Perform the independent security review.** Independence means the reviewer is
   not the author. A model reviewing a model's work is model-independent — the same
   weaker class already labelled throughout Gate B. It is not independent security
   publication clearance, and asserting that it were would be the fabrication this
   gate exists to prevent.
2. **Sign as the authorized maintainer.** `signerClass: "model"` is rejected with an
   explicit reason. A model recorded in the maintainer field is the "fill in another
   party's signature" failure mode, mechanised against.

## 5. Current computed state

```
artifact: ea863a25b5dd0e014d275bc1c4b979b7b7d5afee (no packaged sha256)
technical: partial
clearance: none
approval: none
release: HOLD
```

Three problems, each a fact rather than a missing checkbox:

| Problem | Reason |
|---|---|
| Technical qualification is PARTIAL | Gate B is `CLOSED-WITH-WAIVER` (GB-11 unmeasured) and Gate E independence is absent, so no technical PASS exists |
| Security clearance is MISSING | No designated independent process has cleared publication restrictions |
| Maintainer approval is ABSENT | No maintainer decision exists for this artifact |

Gate B's mechanical gates all ran green at this commit — build, `typecheck:unused`
(0), `check:dead`, full vitest (708 files / 7749 passed / 7 skipped), `check:dox`
(107 claims), `detect-changes` (low risk). None of that is a technical PASS, and
recording one because the suite is green is precisely what PRD-R082 forbids. That
is why the record says `partial`.

## 6. What changed, mechanically

Before: "Gate F — signature outstanding" was prose in the acceptance matrix and the
readiness report. Nothing could contradict it, and nothing could detect a record
that *looked* cleared.

Now: the outcome is computed. Eighteen tests pin the contract, five of them being
PRD-R082's own negative list, and the further eight closing the ways a record can
look cleared without being cleared — a model in the maintainer field, a maintainer
clearing their own restriction, approval backdated before clearance, an abbreviated
commit, a citation to nothing, an approval artifact with a blank signature line.

This does not close Gate F. It makes the distance to closure **enumerable** instead
of asserted: one partial qualification and two absent authorities.

## 7. Reproduce

```sh
node benchmark/evidence/release-clearance-record.mjs docs/audits/2026-10-24-gate-f-release-clearance-record.json
node --test benchmark/evidence/release-clearance-record.test.mjs
```

Exit 1 on the record is the current, correct result. It becomes 0 only when a real
clearance and a real maintainer decision exist for the exact commit.

## 8. What this does not claim

- Not independent security qualification. No clearance was obtained.
- Not maintainer approval. It is absent and was not filled in.
- Not a technical PASS. The record says `partial` and the validator refuses it.
- Not a Gate F closure, and therefore not a pre-2.0 release authorization.
- Not a waiver. Gate F has none.
