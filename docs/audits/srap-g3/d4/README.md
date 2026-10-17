# SRAP-G3-ACCEPT — D4 evidence bundle (review pending)

**D4 = PASS (conditional)**, signed off in the manifest §11 after an adversarial
re-check of the submitted artifacts. The sign-off was performed by the
implementation agent at the operator's direction; it is not an independent
third-party audit. Residuals are listed in §10 and §11.

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

## What the reviewer must decide

1. Accept or reject the row verdicts and the disclosed deviations (manifest §8, §10).
2. Accept or reject the E-4 hand-seeded method (manifest §7).
3. Accept or reject the known limitations (manifest §10), notably that the
   objective reviewer is the deterministic fixture model, and the F-1
   harness-interference trap (§10.10) — a live daemon consumes the single-use
   approval mid-barrier, so F-1 must run with the daemon stopped.
4. Certify closure — or return the specific rows that need re-running.
