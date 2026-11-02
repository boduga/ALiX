# D9 Phase F — REQ 1 native Linux x86-64 qualification

Date: 2026-11-02 (UTC)
Commit: `31a7ed1d` (runner fix; evidence re-run on the same tree)
Tree: `577f3831ada7a528f3102f413fd2f52a48dbec5a`
Runner: `scripts/d9-qualify-linux-x86-64.sh`
Retained evidence: `evidence/d9-x86-64-2026-11-02/` (19 files, all **tracked**, `SHA256SUMS` verified)

> **Revision note.** The first version of this evidence retained only 3 of 16
> artefacts in git: `.gitignore:15` (`*.log`) silently dropped the 13 execution
> logs. `SHA256SUMS` listed and verified them locally, so nothing appeared
> broken, but a fresh checkout could not inspect any claimed execution — and a
> hash cannot reconstruct missing bytes. Found by an independent review (Codex,
> 2026-11-02). Fixed by a scoped `!docs/prd/evidence/lean-01/evidence/**/*.log`
> negation, and the run was repeated with build identity and verbose test names.
> The old 16-file set is superseded by this one.

## What REQ 1 asked

> "Run reproducible native Linux x86-64 tests and negative
> crash/replay/approval/identity checks on the exact candidate tree;
> retain logs and hashes, including build and source identities."

## What was run

Native Linux x86-64, not emulation:

| Field | Value |
|---|---|
| Host | Linux 6.8.0-146-generic x86_64 |
| `process.platform/arch` | `linux/x64` |
| Node | v26.11.0 |
| pnpm | 12.11.2 |
| Filesystem | `/dev/sda2` on `/`, ext4, `rw,relatime,errors=remount-ro` |

Source identity beyond the commit — the graph the commit actually pins:

| Artefact | SHA-256 |
|---|---|
| `pnpm-lock.yaml` | `9b703ae0f8f14ade3a3534ad9f4e5c9878a17021470cec878c51dc5a660b007a` |
| `package.json` | `96e162a17b89e5a551bbc9a67db9e41863f9c2a307613b41942d5e02d0f608b7` |

The runner installs with `--frozen-lockfile` before building, so the evidence
cannot describe a dependency graph the commit does not pin.

## Results — all 12 stages passed

| Stage | Result |
|---|---|
| `install-frozen` | exit 0 |
| `build` | exit 0 |
| `negative-crash-replay` | **17 tests, 17 pass, 0 fail** |
| `negative-approval` | **18 tests, 18 pass, 0 fail** |
| `focused-vitest` | **4 files, 23 pass, 1 skipped, 0 fail** |
| `typecheck` / `typecheck-unused` | exit 0 |
| `build-identity` | **3026 files**, matrix `292c48ffc610935fff4f57bdc6d29d62b404ff19d1de0512bb21a646090519e4` |
| `dox` / `staleness` / `deps` | exit 0 |
| `lifecycle` / `supply-chain` | exit 0 |
| `git diff --check` | clean |

Build identity now names the executable files rather than a command line:
`build-manifest-sha256.txt` carries a per-file hash of all 3026 emitted `.js`
files, and `build-matrix-sha256.txt` one value over the sorted manifest.
`focused-vitest` runs at `--reporter=verbose`, so individual test identities are
retained (23 named cases) instead of aggregate dot counts.

Negative crash/replay coverage actually exercised — real children, real
signals, at `--test-concurrency=1` so signal timing is not the variable:

- `D9 actual resumer SIGKILL`: before-resume, after-tombstone, after-consume,
  after-effect, after-receipt
- `approval crash-after-consume recovery`
- `effect-journal-sigkill`, `d9-sigkill-durability`

The single skip is `F2 (Windows): a nonzero exit is never classified as success`,
guarded by `skipIf(process.platform !== 'win32')`. On Linux the POSIX variant
(`F2: signal termination is never classified as successful exit 0`) runs and
passes. **The skip is correct, not a gap** — the Windows variant is out of
scope for an x86-64 Linux qualification.

## What this evidence does NOT establish

Stated here because a PASS in a security record is easy to over-read:

- **Not REQ 2.** This is author-side execution. REQ 2 forbids author
  self-certification, so no amount of local PASS satisfies it.
- **Not REQ 3.** Owner security-exception clearance remains unspent.
- **Not a durability certification.** Process-crash/restart and process-tree
  scope only. No kernel-crash, power-loss, or generalized storage claim.
- **Not other platforms.** macOS, Windows, containers, network filesystems and
  emulation are untouched.
- **Not a final Phase F PASS.** REQ 4 and REQ 5 remain open.

## Reproducibility

The runner refuses to run on a dirty worktree (exit 2) and records the exact
tree, lockfile and filesystem. Re-running it on the same commit reproduces this
evidence; `sha256sum -c SHA256SUMS` verifies the retained copy.
