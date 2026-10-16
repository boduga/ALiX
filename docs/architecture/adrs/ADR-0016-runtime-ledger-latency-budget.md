# ADR-0016: Runtime-ledger latency budget under `synchronous=FULL`

## Status

Accepted — 2026-10-16. Supersedes the "tail latency is a P5 review item" note in
`docs/2026-10-15-srap-p4-ssd-benchmark.md`; does not weaken ADR-0015's durability
decision.

## Context

Every runtime-ledger connection pins WAL + `synchronous=FULL` (ADR-0015). FULL
issues one fsync per committed append, so on saturated multi-writer storage the
device flush queue delays individual commits even when average throughput is
healthy.

P4 measured this on the physical SSD (`docs/2026-10-15-srap-p4-ssd-benchmark.md`,
`docs/audits/2026-10-15-srap-p4-ssd-results.json`), 4 concurrent writers:

| Workload | aggregate w/s | append p95 | append p99 | append max |
| --- | ---: | ---: | ---: | ---: |
| sustained | 387.9–398.2 | 5.29–6.93 ms | 56.6–83.7 ms | up to **5,024.78 ms** |
| burst | 384.4–399.1 | 3.08–7.78 ms | 20.8–57.9 ms | up to 3,337.20 ms |
| session (paced) | 15.6–15.7 | 10.63–12.26 ms | 36.5–38.8 ms | up to 83.65 ms |

The G2-E §A.7 acceptance threshold set p95 ceilings (`≤200 ms` HDD, `≤20 ms`
SSD) and reader p95 `≤5 ms`, but **defined no p99 or max ceiling**. P5 confirmed
the SSD run meets every defined threshold yet leaves the tail unbounded, and
handed it back as a caller-budget decision rather than a failed gate.

The relevant callers: remote approval decisions, session persistence, and daemon
tasks are **human-rate** (sub-second tolerance is generous). Coordination-scale
sustained bursts are the only workload that stresses the p99/max tail.

## Decision

1. **Adopt the following runtime-ledger append-latency budget** as the accepted
   operating envelope for SSD-backed deployments. It is a caller-visible budget,
   not a gate that re-runs the benchmark:

   | Metric | Budget (SSD) |
   | --- | ---: |
   | append p95 | ≤ 20 ms |
   | reader p95 under write load | ≤ 5 ms |
   | append p99 | ≤ 150 ms |
   | append max | ≤ 6,000 ms (no wall-clock deadline is asserted on top) |
   | surfaced `SQLITE_BUSY` | 0 |

   The p99/max figures are ~2×/1.2× the worst observed P4 values, chosen to
   absorb host-load variance without re-opening P4. They bound the tail; they do
   **not** promise it is small.

2. **Human-rate callers must not assume a hard per-append deadline.** Approval,
   session, and daemon paths already treat a slow append as latency, not failure
   — the zero-wall-clock-deadline agent contract applies. A caller that needs a
   sub-100 ms bound must add its own timeout and handle a `SQLITE_BUSY`/slow
   retry explicitly; the ledger does not promise one.

3. **Coordination-scale sustained workloads are explicitly provisioned for SSD.**
   On rotational HDD the ceiling is ~8–13 writes/s with append p99 up to ~0.48 s
   (G2-E §A.3); such hosts are supported only where run-level steps tolerate that.

4. **Group commit remains a separate, unmade decision.** Batching N concurrent
   appends into one fsync is the only change that materially lowers the tail; it
   is **not** part of SRAP-1 or G3 and requires its own ADR/PR with a durability
   argument (it must not silently weaken the per-append FULL guarantee).

5. **Power-loss durability stays a hardware claim.** This ADR bounds latency
   only. `synchronous=FULL` asserts, but does not prove, SSD/controller power-loss
   behavior (see P5 §7 caveat 2). A physical power-cut test on PLP-capable
   hardware remains the evidence that would retire that caveat.

## Consequences

- The P5 "sustained tail latency" caveat is **owned**: bounded by a recorded
  budget and a caller rule, not left open.
- No source change. The durability pin is unchanged; only the accepted envelope
  is now written down.
- A future p99/max regression beyond the budget is a reportable finding, not a
  silent property.
- Group commit stays a deliberate future milestone, preserving ADR-0015's
  "do not weaken FULL" constraint.

## Alternatives Considered

- **Leave the tail unbounded (status quo).** Rejected — an unowned tail is the
  thing P5 flagged; a recorded budget closes it without new code.
- **Set an aggressive ceiling (e.g. max ≤ 25 ms).** Rejected — would fail the
  measured SSD behavior and force premature group commit.
- **Add group commit now.** Rejected — out of SRAP-1 scope; needs its own
  durability ADR.
- **Weaken `synchronous=FULL` to NORMAL.** Rejected — ADR-0015; trades away the
  durability guarantee to buy latency, which is the wrong trade for approval
  evidence.

## Related ADRs and records

- ADR-0015 — one-ledger decision evidence (WAL + FULL, durability).
- `docs/2026-10-15-srap-p4-ssd-benchmark.md` — P4 measurements.
- `docs/2026-10-15-srap-p5-g2c-rereview.md` — §7 caveat 1 (this decision).
- `docs/2026-10-14-srap-g2-e-operational-verification.md` — §A.7 thresholds.
