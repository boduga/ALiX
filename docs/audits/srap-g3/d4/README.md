# SRAP-G3-ACCEPT — D4 evidence bundle

**D4 = UNCONDITIONAL PASS**. Fix merged as `aae59c26` (PR #984); C-2/C-3a/C-3b
requalification passes against the merged build. Independent review verified
all D4 rows, bundle hashes, and audit-chain integrity. Final disposition is in
the manifest.

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
| `E4-full-coverage.txt` | Real signed decision, skipped inline projection, operator repair, idempotent rerun |
| `E4-projection-skip-loader.txt` | Exact fixture-only ESM hook used to skip the route's inline projection |
| `C2-C3b-requalification.txt` | Pre-merge and merged-build authenticated requests: 403 responses, unchanged approvals, zero key reads |
| `A2-invalid-bearer-requalification.txt` | Mutated bearer token: HTTP 401, same approval pending with no evidence before/after |
| `C3a-missing-scope-matrix.txt` | 12 regression cases rerun against merged build: missing scope denied before handler across roles and auth modes |
| `f4-order1.txt` | F-4 Order 1: 401 + key-read delta 0 |
| `SUPERSEDED-note.md` | Which earlier records are superseded, and which counts are historical |
| `raw-artifact-inventory.txt` | Identity (size + sha256 prefix) of raw artifacts left in the fixture root |
| `raw-artifact-sha256.txt` | Full SHA-256 digests for the same raw artifacts; detects drift but does not preserve raw bytes |
| `A4-revoked-credential.txt` | A-4: 401 `token_revoked`, key-read delta 0, approval untouched |
| `F1-raw-clean.json` / `F1-raw.json` | F-1: 8×200 clean vs 1×200+7×409 under a live daemon (harness interference, both retained) |
| `F2-cross-principal-artifact.txt` | F-2: principal B replay → 409, A's evidence retained |
| `F3-raw-clean.json` | F-3: one 200, one 409, one transition |
| `G2-restart-artifact.txt` | G-2: evidence + `credentialRef` identical across a real restart |
| `limited-rows-upgrade.txt` | The upgrade session for the previously LIMTED rows |

## Why the raw artifacts are not committed

The audit chain, ledger snapshots and run JSON are large and are produced by a
disposable fixture. Their identity (size + sha256) is recorded so a reviewer with
access to the fixture root can confirm they are the reviewed bytes. The fixture
root is `/tmp/opencode/alix-srap-accept/20261017T164036Z-309922`.

## Review disposition

The first independent review found A-2 state evidence missing; the row was
re-run with a fresh identified approval and authoritative before/after reads.
Final independent re-review found no row-evidence failure and required merged
build requalification. That condition is met by PR #984 (`aae59c26`); re-run
evidence and unconditional D4 PASS are recorded in the manifest. Fix tracked in
issue #983.
E-4 full coverage is recorded in `E4-full-coverage.txt`; C-2/C-3a/C-3b were
re-run against merged PR #984 and are recorded in the corresponding artifacts.
F-1 evidence is valid only with the daemon stopped; the deterministic reviewer
remains a string/evidence matcher, not a semantic judge.
