# Gate B independent scoring record — TEMPLATE (unscored)

**Status: BLANK TEMPLATE. NO SCORING HAS HAPPENED. GATE B HOLD.**
**Created:** 2026-10-23
**Companion:** [Gate B collection proposal](2026-10-23-gate-b-collection-proposal.md) §7,
[Gate B acceptance packet](2026-10-23-gate-b-acceptance-packet.md) GB-12
**Validator:** `node benchmark/evidence/gate-b-scoring-record.mjs <record.json>`

This template exists so an independent reviewer has a fixed shape to fill, and so a
half-filled record cannot be mistaken for a scored one. It is not a scoring record:
the reviewer fields below are blank, and every requirement is listed with no verdict.

## Who may fill this in

Only a reviewer who is not the author. Author-only scoring is a weaker labeled claim
that leaves GB-12 open and Gate B on HOLD; the validator rejects a reviewer identity
that matches the author, including the same email under a different display name.

## Inputs the reviewer must be given

1. The frozen artifact set, named by commit and file path in `artifactSet`.
2. Retained guard evidence and final state per run — not model prose.
3. The frozen requirement list in the validator (`FROZEN_REQUIREMENTS`, GB-01..GB-14).
4. The §3 frozen-input pins and §4 capture fields for every admitted run.

An infrastructure or transport failure is `inadmissible`, never a refusal or a
success. Per §7, a run with an incomplete pin set is not Gate B evidence and must not
be scored.

## Record shape

```json
{
  "author": "Author Name <author@example.org>",
  "reviewer": "Independent Reviewer <reviewer@example.org>",
  "scoredAt": "YYYY-MM-DDTHH:MM:SSZ",
  "artifactSet": "<commit + paths scored>",
  "requirements": [
    { "id": "GB-01", "verdict": "met|partial|missing|not-applicable", "evidence": "<path a third party can re-read>", "note": "<required when not met>" }
  ]
}
```

Rules the validator enforces:

- every id in GB-01..GB-14 appears exactly once
- `met` requires cited `evidence`; an assertion is not evidence
- anything other than `met` requires a `note` saying what is unmet
- a record is `incomplete` (and Gate B `HOLD`) while any requirement lacks a verdict
- `ELIGIBLE-FOR-SIGNATURE` requires a complete record, a declared-independent
  reviewer, and zero `missing`/`partial` verdicts

A complete record is *eligible for signature*. It is not a signature, and it does not
by itself change the Gate B disposition.

## Verdict table (blank — reviewer fills)

| Requirement | Question | Verdict | Evidence | Note |
|---|---|---|---|---|
| GB-01 | Versioned corpus with an independent oracle | _blank_ | _blank_ | _blank_ |
| GB-02 | Scripted proof of the revised contract | _blank_ | _blank_ | _blank_ |
| GB-03 | Oracle guards closed for future collection | _blank_ | _blank_ | _blank_ |
| GB-04 | Reproducible environment recorded per run | _blank_ | _blank_ | _blank_ |
| GB-05 | Ten-stratum coverage | _blank_ | _blank_ | _blank_ |
| GB-06 | Measured cost per independently verified success | _blank_ | _blank_ | _blank_ |
| GB-07 | Mean / median cost and token counts | _blank_ | _blank_ | _blank_ |
| GB-08 | p50 / p95 latency | _blank_ | _blank_ | _blank_ |
| GB-09 | Success rates with uncertainty | _blank_ | _blank_ | _blank_ |
| GB-10 | Mixed / confounded ratios rejected | _blank_ | _blank_ | _blank_ |
| GB-11 | Operator attention measured separately | _blank_ | _blank_ | _blank_ |
| GB-12 | Independent scoring present | _blank_ | _blank_ | _blank_ |
| GB-13 | Historical provenance disposition | _blank_ | _blank_ | _blank_ |
| GB-14 | Operator acceptance of the baseline | _blank_ | _blank_ | _blank_ |

## Signature (blank)

| Field | Value |
|---|---|
| Reviewer identity | _blank_ |
| Reviewer date | _blank_ |
| Reviewer verdict | _blank_ |
| Operator identity | _blank_ |
| Operator date | _blank_ |
| Operator decision | _blank_ |

Nothing here may be filled in on another party's behalf.
