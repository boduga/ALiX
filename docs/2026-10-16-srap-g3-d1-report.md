# SRAP-G3-ACCEPT — D1 report (isolated fixture setup + offline validation)

Status: **D1 executed — conditionally passed; D1-F1 OPEN.** D2 qualification, D3
acceptance execution and D4 closure remain **unauthorized**. No Inspector or
coordination process was started, no credential was enrolled, no HMAC key was
generated, and no remote decision was issued.

Executed: 2026-10-16. Root: `/tmp/opencode/alix-srap-accept/20261016T065211Z-101396`.
Evidence: `<root>/runs/20261016T065211Z/` (`env/d1-results.txt`,
`manifest/D1-report.md`).

## Exit criteria

| Requirement | Expected | Result |
| --- | --- | --- |
| Production state | Unmodified | **Conditionally true — see D1-F1.** Production config dir and platform state dir **unchanged**; the repository `.alix/` changed only via the live session's own projection checkpoints |
| Fixture workspace | Fully isolated | **PASS** — 0 of 12 changed baseline paths mention the fixture root |
| Configuration validation | Pass | **PASS** — remote-on / remote-off differ only in `ui.security.remoteDecisions.enabled` |
| Credential backend containment | Verified without generating credentials | **PASS** — `credentialsDir` / `plainStorePath` resolve inside `$ROOT/state/alix-inspector/…` |
| TLS proxy configuration | Validated offline | **PASS** — cert valid and unexpired, SAN `DNS:localhost`, key mode `600`, listener `127.0.0.1:4143` |
| Evidence and archival procedures | Validated | **PASS** — 8/8 evidence dirs; containment predicate rejects `/`, the root, and a root child; accepts an outside path |
| Inspector / coordination processes | Not started | **PASS** — no listeners on 4139/4143 |
| Live credentials / remote decisions | None | **PASS** — fixture `state/` empty |

No tracked repository changes were made by D1.

## Finding D1-F1 — the exact-`cmp` production proof is invalid under a live session

**Observation.** The preflight's exact `cmp` between the before/after production
manifests **failed**: 12 changed lines, **all** under
`<repo>/.alix/sessions/1792107506832/**` — the *running agent session's own*
projection checkpoints. **Zero** changed paths mentioned the fixture root, and
the production config dir and platform state dir were **unchanged**.

**Why it matters.** Including the repository `.alix/` in an exact `cmp` makes the
guard fail for reasons unrelated to the fixture, and it would mask a genuine
violation inside the noise. The guard is meant to detect fixture leakage, not the
host's own session traffic.

**Guard behaviour was correct.** `production-integrity.json` was **not** written
because the comparison failed — fail-closed, exactly as designed.

**Disposition.** Closed only after the corrected check is re-run successfully.
The hybrid integrity model (below) is now normative in
`docs/2026-10-16-srap-g3-acceptance-fixture.md` §9.

## D1-F1 correction — hybrid integrity model

The defensible claim is narrow: **protected production configuration and platform
state remained unchanged, and every observed repository mutation was classified
under a reviewed exception policy.** This report does **not** claim the entire
production repository was untouched.

1. Acceptance runs from a **dedicated, clean worktree pinned to a commit SHA**,
   verified to have **no unrelated ALiX session** in it.
2. Production **config** and **platform state** are compared **exactly** — any
   difference is a failure, no allowlist.
3. Live-session projection changes are an **explicitly identified exception**, not
   evidence of an untouched repository.
4. An **allowlist** may name only
   `<repo>/.alix/sessions/<recorded-id>/{events.jsonl,projections/**}`; anything
   outside it is a failure; every excluded path is recorded with its
   justification. **Preferred state: an empty allowlist.**
5. **Fail closed** on a failed comparison, an ambiguous allowlist, or any
   unexpected path.
6. **Raw evidence private, sanitized summary archived** (exception count, allowed
   paths, unexpected-change count, verdict).

## Readiness — resolved vs unresolved

**Resolved:** `node v26.11.0`, `openssl 3.0.13`, `curl`, `jq`, `git`, `ss`,
`realpath` present; ports 4139/4143 free; repo built CLI and built `srap-evidence`
module present; 8/8 evidence dirs; fixture/source/private perms as specified.

**Unresolved (carry into D2):**
- `alix` is **not on `PATH`** → the fixture must invoke the pinned entrypoint
  (`node <repo>/dist/src/cli.js`).
- `bin/proxy.mjs`, `bin/negative-proxy.mjs`, `bin/seed-key.mjs` are not authored.
- Fixture goal, host mode, status-JSON schema; archive destination; signatory.
- A genuinely untrusted-peer topology (still **NOT EXERCISED**).

## Authorization

D1 only. D2 qualification, D3 acceptance execution and D4 closure remain
separately gated. `SRAP-G3-ACCEPT` remains open.
