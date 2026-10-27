# LEAN-G01 baseline qualification — existing evidence reanalysis

Revision: `d412ea15`; dirty worktree and shared-load host. This is a read-only reanalysis of previously collected data, not a new runtime benchmark.

| Existing sample | Duration | Post-3s median RSS | Post-3s CPU ticks delta | Post-3s process write bytes delta | Limit |
|---|---:|---:|---:|---:|---|
| Isolated unconfigured daemon | 9.06 s | 75,716 KiB | 0 | 0 | Coordination init failed without model config |
| Isolated configured daemon (placeholder local-llama) | 12.07 s | 76,592 KiB | 1 | 0 | No model inference or active workload |

Samples are ~0.5 s apart. CPU ticks and `write_bytes` are cumulative process counters sampled after 3 seconds. A zero delta in these short windows does **not** prove absence of idle polling, future 30-second heartbeat writes, or all filesystem activity. Memory is process RSS, not child-tree aggregate. Both probes used temporary HOME/cwd.

Cold CLI `--help` (3 trials each): wrapper 0.70/0.73/0.68 s (mean 0.703 s), direct compiled CLI 0.65/0.65/0.66 s (mean 0.653 s). The roughly 50 ms mean difference is exploratory and does not establish significant overhead or justify code changes.

## Gate blockers

1. Pinned clean or explicitly archived dirty snapshot with repeatable commands and environment manifest.
2. Controlled >=30 s idle observation (prefer >=60 s to span 30 s heartbeat) with event/tick/wakeup and process-write attribution.
3. Representative active task and model-provider workload: latency, token usage, throughput, and CPU/RSS.
4. Route-by-host policy, cancellation, restart and evidence parity, including daemon missing approvalStore dependency.
5. Complete mutable-authority map beyond runtime-ledger entities, plus independent reviewer.

**LEAN-G01 = BLOCKED**; no gate promotion.
