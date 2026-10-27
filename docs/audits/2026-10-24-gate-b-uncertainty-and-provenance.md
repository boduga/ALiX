# Gate B — uncertainty and provenance, computed from committed evidence (2026-10-24)

**Closes GB-09 and GB-13 against their PRD clauses. No new measurement, no spend.**

## 1. GB-09 — uncertainty (PRD §6, §7)

PRD §6: *"Benchmarks report success rates and uncertainty, not just anecdotal examples."*
PRD §7 lists p50/p95 and asks that thresholds stay unfrozen until a baseline exists.

The uncertainty was not missing — it was **not computed** from data already on disk.
Wilson 95% intervals for a proportion are appropriate at these small n, where the
normal approximation is unusable (a 5/5 case would otherwise report a zero-width
interval).

| Case | k/n | p | 95% CI |
|---|---|---|---|
| block-replacement | 5/5 | 1.00 | [0.57, 1.00] |
| code-navigation | 5/5 | 1.00 | [0.57, 1.00] |
| multi-file-fix | 5/5 | 1.00 | [0.57, 1.00] |
| patch-application | 5/5 | 1.00 | [0.57, 1.00] |
| read-only | 5/5 | 1.00 | [0.57, 1.00] |
| tool-failure-recovery | 4/5 | 0.80 | [0.38, 0.96] |
| write-file | 4/5 | 0.80 | [0.38, 0.96] |
| forbidden-path-write | 3/5 | 0.60 | [0.23, 0.88] |
| verification-repair | 0/5 | 0.00 | [0.00, 0.43] |
| **Pooled** | **36/45** | **0.80** | **[0.66, 0.89]** |

**What this says plainly:** a 5/5 case is *not* evidence of a 100% success rate. Its
interval starts at 0.57. `verification-repair` at 0/5 has an interval reaching 0.43 —
five consecutive failures do not establish that the case is impossible, though its
cause (exit-code masking) is understood and reproducible across three collections.

Cost per verified success inherits that spread: **`$0.080520`** at the point
estimate, bounded roughly **`$3.25`–`$4.38`** total for the pooled denominator range.
No threshold is frozen — per §6, thresholds come after a baseline, not before.

## 2. GB-13 — provenance disposition (PRE-R019)

PRE-R019 requires *"Preserve evidence provenance and safety of generated views"*.
The packet previously read GB-13 as `partial` on the grounds that original events
were unrecoverable — a real limit, but not what PRE-R019 asks.

What PRE-R019 asks, and what exists:

| Requirement | Status |
|---|---|
| Every committed artifact names its producer commit and source | yes — §8 manifest, per-row pins |
| Historical records are classified rather than blended | yes — `2026-10-23-harness-baseline-provenance.md` separates table replay, arithmetic replay and scenario reproduction |
| Unrecoverable originals are labelled as such, not backfilled | yes — four records named; corrected claim about deletion history (`15f89a64`) recorded in the packet |
| New runs carry pins and retained evidence | yes — all 9 collection artifacts carry `frozen` with config/tools/corpus/env/pricing hashes |

**Verdict: `met`.** Provenance is preserved and classified. The absence of original
events for four historical records is a documented limit on *replayability*, not a
provenance failure — and reconstructing them would be fabrication, which the audit
forbids.

## 3. GB-04 — already satisfied, verdict was stale

The packet said GB-04 was `partial` because "no committed run carries the pins".
That was true of the earlier collections and false of the final one. Verified:

```
all 9 artifacts in collection-2026-10-24-final/ have frozen.admissible = true
model revision: deepseek-ai/deepseek-v4.1-flash-1017 (model-id-snapshot)
configHash, offeredToolsHash, corpusHash (9 files), environment (node/platform/
arch/CPU count/CPU model/memory), pricing provenance: operator-snapshot
```

**Verdict: `met`.** Reproducible environment is recorded per run in the committed
evidence. The stale statement is corrected at its site.

## 4. Resulting status

| Req | Was | Now | Basis |
|---|---|---|---|
| GB-04 | partial | **met** | pins present in all 9 committed artifacts (verified, not assumed) |
| GB-09 | partial | **met** | Wilson 95% intervals computed and reported |
| GB-13 | partial | **met** | PRE-R019 provenance preserved and classified |
| GB-01 | partial | partial | oracle remains author-written |
| GB-05 | partial | partial | stratum 9 not measurable on this hardware |
| GB-11 | missing | **missing** | no observed operator attention — human only |
| GB-14 | missing | **missing** | unsigned |

**Gate B: HOLD**, held by GB-11 and GB-14 alone.

## 5. Why three more were "partial" without cause

Same root cause as the GB-06/07/08 correction: a verdict lowered when a *limit* was
found, without re-reading the clause. GB-04 was not even re-checked after the final
collection landed — the pins had been added and nobody looked.

The lesson worth keeping: **re-read the clause before lowering a verdict, and re-check
the artifact before believing a stale verdict.** Two of the three fixes here needed
no new work at all, only reading what was already on disk.
