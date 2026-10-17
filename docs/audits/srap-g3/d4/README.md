# SRAP-G3-ACCEPT — D4 evidence bundle (review pending)

**D4 is NOT closed.** This directory is the evidence submission for independent
review. The implementing operator cannot self-certify closure.

## Contents

| File | Purpose |
| --- | --- |
| `D4-evidence-manifest.md` | The manifest: row verdicts, deviations, limitations, artifact map |
| `verifier-cases.txt` | Five verifier cases against the real prompt, incl. the prose-with-"tool" bypass |
| `negative-control.txt` | Run that failed on **verifier rejection** (content mismatch), not ownership denial |
| `state-proofs.txt` | E-2 (pending → 503 → pending) and C-2 (pending → 401 → pending) with authoritative reads |
| `h3-routes.txt` | Enumerated POST route surface (6 routes) |
| `projection-granularity.txt` | Projection at decisionId granularity, shared-decisionId caveat |
| `E1-key-read.txt` | `credential.key_read` field discipline, regenerated from the final chain |
| `f4-order1.txt` | F-4 Order 1: 401 + key-read delta 0 |
| `SUPERSEDED-note.md` | Which earlier records are superseded, and which counts are historical |
| `raw-artifact-inventory.txt` | Identity (size + sha256 prefix) of raw artifacts left in the fixture root |

## Why the raw artifacts are not committed

The audit chain, ledger snapshots and run JSON are large and are produced by a
disposable fixture. Their identity (size + sha256) is recorded so a reviewer with
access to the fixture root can confirm they are the reviewed bytes. The fixture
root is `/tmp/opencode/alix-srap-accept/20261017T164036Z-309922`.

## What the reviewer must decide

1. Accept or reject the row verdicts and the disclosed deviations (manifest §8, §10).
2. Accept or reject the E-4 hand-seeded method (manifest §7).
3. Accept or reject the known limitations (manifest §10), notably that the
   objective reviewer is the deterministic fixture model and that F-1/F-2/F-3 raw
   harness output was not retained.
4. Certify closure — or return the specific rows that need re-running.
