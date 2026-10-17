# Supersession note

Authoritative for D4 is `D4-evidence-manifest.md` (rev 5), not the earlier D3 run
records in this directory.

Superseded statements in `d3-execution-report-rev2.md` / `d3-f4-untrusted-peer.md`:

- "Untrusted-peer row NOT EXERCISED" — it WAS exercised and denied (manifest §8, §10.6).
- "D4 not started" — this directory is the D4 evidence set.

**Historical counts.** `row-evidence.txt`, `missing-row-artifacts.txt` and
`remaining-artifacts.txt` each embed an `audit verify` line captured when that
sweep ran (139 / 184 / 192 records). Those are historical snapshots.
`E1-key-read.txt` embeds a key-read **count**, not an `audit verify` line.
The chain currently stands at the count in `audit-verify.txt`; `audit-chain.jsonl`
is the export of that moment.
