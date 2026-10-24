# Gate B independent scorer — engagement packet

**Status: RECRUITMENT PACKET. NO SCORER ENGAGED. GB-12 AND GATE E REMAIN OPEN.**
**Date:** 2026-10-23
**Validator:** `node benchmark/evidence/gate-b-scoring-record.mjs <record.json>`
**Record shape:** [scoring record template](2026-10-23-gate-b-scoring-record-template.md)
**Companion:** [collection proposal](2026-10-23-gate-b-collection-proposal.md) §7

## 1. Why this cannot be closed by an agent

GB-12 requires independently scored results, and Gate E requires independent
security qualification. Independence means the qualifier is **not the author**.
No amount of work by this agent creates a second party: an agent producing both
the artifacts and the verdict is author-only scoring with extra steps.

The operator authorization record already states this. It is repeated here because
it is the single most likely way this packet gets misused: filling the record in
"on behalf of" a reviewer.

## 2. What the reviewer is asked to do

Score the retained artifacts — **not** the model's prose, and not the agent's
summary of its own work — against the frozen requirement set GB-01..GB-14, and
record one verdict per requirement in the template's JSON shape.

Rules the validator enforces mechanically, so the reviewer can rely on them rather
than remembering them:

| Rule | Enforced by |
|---|---|
| Reviewer identity must differ from the author's (including the same email under another display name) | `normalizeIdentity` / `emailOf` comparison |
| Every GB-01..GB-14 id appears exactly once | frozen-set check |
| A `met` verdict must cite evidence a third party can re-read | `evidence` non-empty |
| Any non-`met` verdict must say what is unmet | `note` non-empty |
| `artifactSet` must name the exact commit and paths | required field |
| An incomplete record yields Gate B `HOLD` | `summary.gateB` |
| A complete record with the author as reviewer also yields `HOLD` | independence gate |

`ELIGIBLE-FOR-SIGNATURE` is the only positive output, and it means *eligible* —
not signed, and not a gate clearance.

## 3. Inputs to hand the reviewer

Everything below is committed; nothing is reconstructed on request.

1. **Artifact set.** Commit hash plus the paths in
   `docs/audits/2026-10-23-gate-b-acceptance-packet.md` §8 (hashed manifest).
2. **Frozen-input pins per run.** §3 pins from `src/operations/evals/eval-frozen-inputs.ts`:
   model revision, config hash, offered-tool hash, corpus hashes, environment,
   pricing rate with provenance.
3. **Per-run capture.** §4 fields: latency, tool/rejected/repeat/tool-retry/approval
   and abort counts, guard evidence.
4. **Retained raw session events** and final state per run.
5. **Provenance classification** for historical records
   (`docs/audits/2026-10-23-harness-baseline-provenance.md`) so the reviewer knows
   which artifacts are replayable and which are not.

## 4. Scoring hazards the reviewer must be told about

Recorded because each has already produced a wrong claim somewhere in this audit:

- **A provider/transport fault is `inadmissible`, never a refusal or a success.**
  A 429 once satisfied a `failed` expectation and scored as a verified security
  refusal.
- **A cost figure priced at a proxy rate is not a vendor rate.** The current
  `hive` rate is an operator-declared gpt-4o proxy
  (`benchmark/evidence/cost/rate-snapshot.json`). A `met` verdict for GB-06 that
  treats it as a Hive list price would be false.
- **Unmeasured is `null`, never zero.** A zero cost or zero interventions means
  "measured and it was nothing" only when the record says observed.
- **Small n is not a distribution.** n=3 supports "2 of 3", not a rate.
- **Guard evidence is the oracle, not the model's self-report.**

## 5. What happens after a record is filled

1. Run the validator. `gateB: HOLD` or `ELIGIBLE-FOR-SIGNATURE`.
2. If eligible, the record is attached to the acceptance packet's blank decision
   section — **still unsigned**.
3. Operator signature (GB-14) and independent security clearance (Gate E) remain
   separate and are not implied by an eligible scoring record.

## 6. Minimum useful engagement

The full GB-01..GB-14 set is the goal, but a partial engagement is still useful and
must be labeled partial: the validator reports `scored: n/14` and holds Gate B. A
reviewer who scores only GB-06, GB-08, GB-11 and GB-12 (the current missing rows)
produces a defensible partial record rather than nothing.

## 7. What this packet is not

- It is not an engagement. No reviewer is named and none is implied.
- It is not a substitute for Gate E independence.
- It does not authorize collection or spend.
