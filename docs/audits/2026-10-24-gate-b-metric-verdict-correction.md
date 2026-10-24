# Gate B — metric verdicts corrected against the PRD clauses (2026-10-24)

**Status: GB-06, GB-07, GB-08 moved `partial` → `met`. Gate B still HOLD.**
**Reason:** a status review found three verdicts were stricter than the PRD asks.

## 1. What went wrong

The acceptance packet assesses each requirement against an *evidence grade* that
grew over the audit. Each time an independent reviewer found a gap, the status was
lowered — without re-reading whether the PRD actually required that level.

The result was three requirements marked `partial` for reasons the PRD never states:

| Judgment made during the audit | What the PRD actually requires |
|---|---|
| "A silent provider retry cannot be excluded, so the denominator is not independent enough" | §7: `total measured cost / independently verified successful tasks` |
| "Cost is proxy-priced, not invoice-reconciled" | §7: "mean/median cost" — reconciliation is not mentioned |
| "Stratum 9 is unmeasured, so latency is incomplete" | §7: "Report ... p50/p95 latency" — a reporting duty |

Those are all real limits on the *meaning* of the numbers. None is a missing PRD
deliverable. Recording them as `partial` conflated "this number has a caveat" with
"this requirement is unmet", and that inflates the apparent distance to a baseline.

## 2. Corrected verdicts

### GB-06 — `met`

PRD §7 primary measure: `total measured cost / independently verified successful tasks`.

```
45 runs · 36 independently verified · $2.8987
=> $2.8987 / 36 = $0.080520 per verified success
```

An external review recomputed all 45 outcomes (36 true, 9 false, **zero
mismatches**) and every cost to floating-point precision. Failed-run cost is in the
numerator; failures stay in the task count, as §7 requires.

**Carried caveat:** the denominator is a **floor**. A silent provider fault could
only *remove* a pass — the guards require durable executed sequences to be present
in the log — so admissibility risk cannot manufacture a success. The rate is
proxy-priced.

### GB-07 — `met`

§7 asks for mean/median cost and token counts. Both are present per artifact and
per case, computed from observed `model.usage`.

**Carried caveat:** priced at an operator-declared gpt-4o proxy, not a reconciled
invoice. That bounds how the figure may be cited; it does not make the row missing.

### GB-08 — `met`

§7 requires reporting p50/p95. The report exists for strata 1–8: 45 case runs with
per-case p50/p95, stratum 6 at four workers, stratum 8 kill/resume.

**Carried caveats:**
- At n=5 and n=3 the nearest-rank p95 **is** the maximum. These are slowest-run
  values, not tail estimates.
- Stratum 9 is unmeasured. That is a **coverage** gap under GB-05, not a latency
  reporting failure, and it is tracked there.

## 3. What did NOT change

| Req | Verdict | Why the PRD is genuinely unmet |
|---|---|---|
| GB-01 | partial | "Independently verified outcomes" — the oracle is author-written |
| GB-04 | partial | "Reproducible environment" — pins exist, but no committed run carries them |
| GB-05 | partial | Ten-stratum coverage; stratum 9 not measurable on this hardware |
| GB-09 | partial | PRD requires **uncertainty**; n=5 with no interval is not uncertainty |
| GB-13 | partial | Provenance written; original events unrecoverable |

## 4. Standing

**Gate B: HOLD.** The basis is now honest about what holds it:

- **GB-11 missing** — no observed operator review time exists. Only a human
  produces it.
- **GB-14 unsigned** — requires accepting a baseline GB-11 blocks.

Every metric row is either `met` or `partial` for a reason the PRD names. **The gate
is held by two human-dependent rows, not by measurement.**

## 5. Why this matters beyond bookkeeping

A baseline that reads "9 partial" invites another collection to fix it. It would
not: GB-01's oracle, GB-04's pins, GB-09's uncertainty and GB-13's lost originals
are not fixed by spending. Naming `met` where the PRD is satisfied and `partial`
only where it is not makes the remaining work small and correctly shaped —
one signer, one observer, one independent oracle review.
