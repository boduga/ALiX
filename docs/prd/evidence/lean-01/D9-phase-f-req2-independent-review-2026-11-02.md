# D9 Phase F — REQ 2 independent review, attempt 1

Date: 2026-11-02 (UTC)
Reviewer: Codex / `gpt-6.1-sol`, `codex-cli 0.166.0`, `--sandbox read-only`
Reviewed HEAD: `e2e893764c69d61fea0d3d5033480e0e7d5b1e2a`
**Verdict: NO — not acceptable as coverage.**

| Artefact | SHA-256 |
|---|---|
| `2026-11-02-codex-d9-req2-review-prompt.md` | `25a7c673c4e3f0577d945b09c5cb5f7a62b4e8e7342af94f318c956fb6fdf29d` |
| `2026-11-02-codex-d9-req2-review.txt` | `d1b60f06de055d007b02a30e0acb7cd7697fa9ae0dfe6c4066c8b196d20bc608` |

## Independence class — read this before citing

**Model-independent, NOT human independence.** This satisfies the *spirit* of
REQ 2 (separate verifier/critic authority, not author self-certification) but it
**cannot** satisfy REQ 2 on its own. The reviewer states this itself:

> "This verdict may be cited as independent model criticism. It may not be cited
> as human independence, human qualification, or affirmative Gate E/Phase F
> clearance."

REQ 2 therefore remains **open**. What this review supplies is a named, hashed,
reproducible adversarial assessment — not a sign-off by an accountable person.

## Clause verdicts

| Clause | Verdict | Basis |
|---|---|---|
| GE-01 F8b self-approval | **PARTIAL** | facade and worker identity real; constructor-enforcement untested |
| GE-02 authority | **PARTIAL** | D1/D11 closed; malformed-policy fail-open and ask-before-evasion-deny remain |
| GE-03 crash/recovery | **PARTIAL** | D3/D4/D5 closed; coordination replay retains pending rather than unverified |
| GE-04 ownership | **NOT QUALIFIED** | symlink escape into unowned/protected dirs |
| GE-05 denied-action | **PARTIAL** | executor-level absence checks now real; universal absence not established |

## Findings I verified independently

I did not take these on trust. Each was reproduced or read directly:

**CONFIRMED — defect 4 (my own error).** The REQ 1 evidence committed only
**3 of 16** artefacts: `.gitignore:15` (`*.log`) silently dropped the 13
execution logs. `SHA256SUMS` listed and verified them locally, so nothing looked
broken, but a fresh checkout could not inspect any claimed execution. Hashes
cannot reconstruct missing bytes. This is the exact failure the log-retention
fix now addresses.

**REPRODUCED — defect 2 (ownership escape).** `isWithinOwnedScope`
(`path-scope.ts:204`) is purely lexical; it never canonicalizes. Counterexample
run locally:

```
ownedPaths = ["owned/**"]
owned/link -> ../unowned        (directory symlink)
isWithinOwnedScope(".../owned/link/new.txt") -> true
write lands at                  .../unowned/new.txt
```

`isCanonicalPathWithinWorkspace` does resolve symlinks — the ownership predicate
does not. GE-04's "every declared-scope write" claim therefore does not hold.
This one is a live bypass, not a documentation gap.

## Findings accepted on the reviewer's evidence

- **Defect 1 (major):** a same-user child can construct `ApprovalStore` or invoke
  the approval CLI directly; environment filtering does not remove filesystem
  authority. The facade is a narrowing, not a boundary.
- **Defect 3 (major):** the record validator accepts fabricated records. The
  reviewer reports running a read-only probe with a nonexistent commit, fabricated
  counts, and one file as every clause's evidence, and obtaining
  `QUALIFIED-INDEPENDENT`. I did not re-run that probe; it is recorded as the
  reviewer's executed evidence.
- **Defects 5–10:** malformed-policy fail-open, mkdir-lock reclaim race,
  ask-before-evasion ordering, coordination pending-vs-unverified, stranded
  preconsumed approval, and stale record text.

- **Vacuous assertions:** the most valuable section. Notable: the
  constructor-enforcement test calls the guard directly, so deleting the
  constructor's invocation at `worker-approval-port.ts:211` leaves it green.

## What this changes

REQ 2 status: **attempted, failed, retained.** Three consequences:

1. **REQ 1 evidence is rebuilt** — logs now tracked, build identity added,
   verbose test names retained. Without this review I would not have noticed the
   logs were missing.
2. **GE-04 is downgraded to NOT QUALIFIED**, and the reason is a reproduced
   bypass, so it is not a review opinion.
3. **Phase F verdict remains HOLD**, now with a documented failed attempt rather
   than an unattempted requirement.

## What an independent HUMAN qualifier must still do

Per the reviewer, and not satisfiable by any model:

- adjudicate the threat model and accept or reject the remaining gaps
- obtain the complete retained logs and build identities (now tracked)
- authorize and reproduce the source-derived counterexamples in a disposable
  environment
- mutation-check the actual construction and dispatch boundaries
- issue an artifact-bound decision under separate authority
