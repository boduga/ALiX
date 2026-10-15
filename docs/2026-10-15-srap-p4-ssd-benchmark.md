# SRAP P4 — Physical SSD benchmark and recovery evidence

Date: 2026-10-15. Baseline: `7103ec56` (P3 merged via PR #950).
Status: **P4 measurements complete; proposed operational thresholds met on this
host. P5 independent G2-C re-review remains required. G3 stays closed.**

## Result

Nine unchanged-harness workloads (three repetitions per mode) met the G2-E §A.7
SSD append-p95 and reader-p95 bounds, with zero surfaced write/read errors or
worker failures and consistent data after reopening. Sustained throughput was
387.9–398.2 writes/s: several hundred/s as proposed. The source defines no exact
numeric throughput floor, so this does not establish a stronger unspecified SLA.

**Tail latency remains material:** saturated sustained append maxima reached
5,024.784 ms and p99 reached 83.698 ms despite p95 passing. P5 must assess whether
that tail fits callers' budgets; do not infer a 20 ms per-request upper bound.
No production optimization or batching was applied.

## Storage and runtime provenance

- Device: `/dev/nvme0n1`, `INTEL SSDPEKNW010T8`, 953.9 GiB class, `rotational=0`.
- Mounted partition: `/dev/nvme0n1p2`, ext4. `findmnt -T` resolves the workspace
  and its ledger directory to this device, not tmpfs or an overlay filesystem.
- Project ledger path: `/home/babasola/Projects/Monolith/.alix/runtime-ledger.db`.
  No database file existed there; no production ledger was opened or modified.
- Fresh benchmark databases: `/home/babasola/Projects/Monolith/.tmp/p4-ssd-2026-10-15-r7loybdc`;
  `stat.st_dev` matches the existing `.alix` directory (66306). Every mode and
  repetition uses its own database directory.
- Node 26.11.0 (matches `.nvmrc`); official archive SHA256 verified against
  Node's SHASUMS256. better-sqlite3 13.0.3; SQLite 3.53.4.
- Kernel: Linux 7.0.0-34-generic x86_64 GNU/Linux.
- Execution worktree at measurement time: `/tmp/alix-srap-p4`, branch
  `srap/p4-ssd-benchmark`, built from `7103ec56` with the frozen lockfile.

## Workloads and thresholds

All runs use four concurrent OS writer processes plus an authority reader
sampled every 200 ms. Measurements ran serially, without overlapping tests or
other benchmark runs. Each writer uses its own entity, as the existing harness
defines. Settings on every reopened ALiX connection were `journalMode=wal` and
`synchronous=2` (FULL); the constructor also verifies these settings.

| Workload | Writes/s (range) | Append p95 ms | Reader p95 ms | Append p99 ms | Worst append ms |
|---|---:|---:|---:|---:|---:|
| sustained | 387.9–398.2 | 5.29–6.93 | 0.70–0.76 | 56.60–83.70 | 5024.78 |
| burst | 384.4–399.1 | 3.08–7.78 | 0.68–0.91 | 20.77–57.91 | 3337.20 |
| session | 15.6–15.7 | 10.63–12.26 | 0.95–1.09 | 36.45–38.77 | 83.65 |

- Sustained: 20 s target window per writer, back-to-back appends; 8,043 / 7,939 / 7,827 appends.
- Burst: 25 appends per burst × 40 bursts per writer, no inter-burst delay;
  all three repetitions completed 4,000 appends within the 20 s time cap.
- Session: 6 appends per iteration, 1,500 ms think time, 20 s target window;
  each repetition completed 336 appends. Its 15.6–15.7 writes/s is deliberately
  paced, not a capacity measurement. Think time is recorded in the command
  because the unchanged harness omits it from its result config.
- Gate: append p95 ≤20 ms; reader p95 ≤5 ms; zero surfaced SQLITE_BUSY or other
  errors; no data-integrity failure; sustained throughput in the hundreds/s.
- All nine rows pass the numeric p95/error checks; 36,817 successful appends
  total. All event counts match unique event IDs and outbox counts; global
  sequences are contiguous, each entity's committed versions are dense and
  match its authority row, and foreign-key/integrity checks are clean.
- Peak sampled WAL: 13,937,992 bytes (13.29 MiB). All nine WALs
  were zero bytes after checkpoint. Short runs do not prove long-duration
  bounded growth. The harness's checkpoint timing is **not used** (see limits).

## Concurrent process-crash recovery

After performance runs, three separate fresh databases received four concurrent
writers. A complete committed-event snapshot was read while writers remained
active, then all four processes received SIGKILL. Reopen preserved every observed
complete event object unchanged (deep equality) and retained additional
commits made between snapshot and kill. Reopened ledgers remained WAL/FULL.

| Trial | Complete snapshot rows | Recovered rows | Snapshot records preserved | Committed entities | Integrity |
|---|---:|---:|---:|---:|---|
| 1 | 360 | 565 | 360 / 360 | 4 | ok |
| 2 | 350 | 559 | 350 / 350 | 3 | ok |
| 3 | 357 | 563 | 357 / 357 | 4 | ok |

All three recovered stores also pass contiguous-sequence, unique-ID,
entity-version, event/outbox-count and foreign-key checks. Trial 2 has three
committed entities: four writers were spawned and killed, but one had not
committed before termination. That is consistent with contention/tail latency,
not loss of an observed commit. Preliminary 100-record sampled probes also
passed in three trials; their evidence is retained separately in the JSON.

These are process-crash checks, **not power-loss tests**. They do not establish
SSD/controller power-loss protection or guarantee hardware flush behavior.

## Verification and reproduction

Supported-runtime frozen install and clean worktree build passed. Ledger,
contention and SRAP durability suites passed **17/17**, including commit-before-
ack process termination and reopening FULL settings. No source, harness,
permission, authority, scheduler, ledger schema or batching behavior changed.

From the built worktree, use an output directory proven to be on the ledger's
SSD volume; never rely on the harness's default `/tmp/opencode` output.

```sh
BENCH_STORAGE_LABEL=physical-nvme-ssd-ext4-INTEL-SSDPEKNW010T8 \
  node scripts/benchmark-runtime-ledger-workloads.mjs \
  --writers 4 --seconds 20 --mode sustained --out <fresh-ssd-directory>
# Burst: add --mode burst --burst 25 --bursts 40.
# Session: add --mode session --session-k 6 --think-ms 1500.
# Repeat each mode three times, serially; use a fresh output directory each time.
```

Exact commands, raw harness outputs, hardware provenance, source hashes,
post-run SQL verification, crash outcomes and external probe/verification program
source are retained in
`docs/audits/2026-10-15-srap-p4-ssd-results.json`. Paths inside probe source identify
this host/worktree and must be adjusted when reproducing elsewhere. First-run
measurement is unchanged; its exact start timestamp was not retained after an
external verifier-import correction.

Raw evidence SHA256: `4eeddc0e3563dcef18fbfb08a135b17d3d1eb7c697f8bb61138e5606d9dbdbad`.

## Measurement limits and next gate

- Surfaced error samples are capped at 50 per worker by the existing harness.
  Zero is unambiguous here; do not use a nonzero capped count as an exact total.
  Internal production retries are not instrumented. Typed version conflicts are
  ignored by the harness; private per-worker entities avoid deliberate conflicts.
- Reader errors were checked independently as total samples minus successful
  latency samples; none occurred. The harness excludes failed samples from p95.
- The harness attempts an untimed truncate through the runtime-visible private
  database member, then times a second checkpoint. Its `checkpointMs` can reflect
  an already-empty WAL and is not first-checkpoint performance evidence.
- Session mode uses six total synthetic appends per iteration; it does not add
  separate scope/state writes beyond that count or measure model/tool latency.
  These are ledger-workload results, not end-to-end agent iteration latency.
- `burst` has no pacing between batches: it is a bounded saturated stream, not
  an independent simulation of every scheduler burst shape or payload size.
- G2-E's prior-device HDD measurements remain history. These measurements are
  specific to this SSD, runtime, filesystem, host load and workload duration.
- P5 must independently review P1/P2/P3, amended contracts, this SSD evidence,
  tail latency and remaining power-loss assumptions. P4 does not reopen G3.

DOX pass: existing root/docs/storage/server ownership and Child DOX Index remain
unchanged; this adds a dated report and raw evidence within existing docs scope.
The P-series handoff is refreshed. Operator authorized relocation, commit, push
and temporary-artifact cleanup. Persistent review worktree:
`/home/babasola/Projects/Monolith/.worktrees/srap-p4`. Historical execution paths
in raw provenance remain unchanged. P4 remains unmerged; G3 remains closed.
