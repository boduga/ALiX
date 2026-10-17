# SRAP-G3-ACCEPT — Acceptance environment and coordination fixture

**Revision:** 2.3 (consolidated design)  
**Status:** D0 approved; D1 PASSED / D1-F1 CLOSED; D2 complete (operational qualification, PR #969, per operator decision 2026-10-16); **D3 authorized — in progress**. D4 not authorized. See §1 gate status and `docs/2026-10-16-srap-g3-d2-d3-handoff.md`.  
**Companion:** `docs/2026-10-15-srap-g3-acceptance-plan.md` (Rev 2 plus F-4 amendment)  
**Scope:** G3 implementation PRs #959, #961, #962, #963; docs PR #964  
**Milestone:** `SRAP-G3-ACCEPT` (do not reuse historical M/P/X/A milestone identifiers)

**Rev 2.3 incorporates three review notes:** (1) the default fixture root moves to
`/tmp/opencode/alix-srap-accept/…` (override and containment checks retained);
(2) §3 is upgraded to source-verified contracts, with the **terminal run states
frozen** to `completed` / `failed` / `cancelled` and only the fixture goal, host
mode and status-JSON schema left unresolved for qualification; (3) the
untrusted-peer denial row is marked **topology-dependent and NOT EXERCISED** — a
loopback request is not proof of untrusted-peer rejection.

## 1. Decision and non-negotiable boundaries

This document defines a reproducible, disposable test environment and a *genuine* approval-blocked coordination fixture. It does **not** authorize executing the SRAP-G3 acceptance matrix. Existing Inspector authentication, principal store, approval authority, runtime ledger, audit chain, and coordination resume path are the only authorities. No parallel approval engine, scheduler, ledger, or execution path is permitted.

| Gate | Permitted | Prohibited until separately authorized |
| --- | --- | --- |
| D0 — design | Review this document, inspect source, author inert fixture scripts, run static checks | Starting services, creating credentials, starting coordination, sending decisions |
| D1 — isolated setup | Only after explicit authorization: create disposable workspace, config, local TLS material and offline checks | Enrollment, Inspector startup, coordination run, remote decisions |
| D2 — fixture qualification | Only after explicit authorization: enroll throwaway operator, seed isolated HMAC key, start loopback services, start/cancel a throwaway coordination run, verify genuine blocking | Running the full acceptance matrix or marking milestone complete |
| D3 — integrated acceptance | Only after explicit authorization: run the approved matrix with fixed qualified inputs and collect evidence | Unreviewed runtime changes, production credentials/workloads |
| D4 — closure | Independent review of all row evidence and signed manifest | Claiming completion based on green CI alone |

**Gate status (as of 2026-10-16):**

| Gate | State | Basis |
| --- | --- | --- |
| D0 — design | approved / merged | PRs #964, #965 (this document, rev 2.3) |
| D1 — isolated setup | **PASSED, D1-F1 CLOSED** | `docs/2026-10-16-srap-g3-d1-report.md`; PRs #966, #967; verdict `hybrid-allowlist-v1` |
| D2 — fixture qualification (operational) | **complete** | Operator decision 2026-10-16: satisfied by the merged operational qualification — PR #969 (`86855978`) |
| D3 — integrated acceptance | **authorized — in progress** | Operator authorization 2026-10-16; inputs frozen in `docs/2026-10-16-srap-g3-d2-d3-handoff.md` |
| D4 — closure | not authorized | — |

**Gate-order note.** The D2 step described above is *fixture qualification*
(enroll a throwaway operator, seed the isolated HMAC key, start loopback
services, run and cancel a blocked throwaway run). On 2026-10-16 the operator
recorded the D2 gate as satisfied by the merged **operational** qualification
(PR #969). That operator decision governs the gate advance; the
fixture-qualification procedure below is folded into the D3 environment
bootstrap that freezes the D3 inputs.

## 2. Acceptance topology and trust boundaries

```text
Independent operator client (curl / dedicated test process)
            │ HTTPS localhost:4143
            ▼
Production-mode TLS proxy (loopback; strips all client forwarding headers)
            │ HTTP localhost:4139; one canonical trusted client hop
            │ (X-Forwarded-For) + one trusted X-Forwarded-Proto: https
            ▼
Inspector (existing remote-decision endpoint, auth, principal and scope checks)
            │
            ├── isolated operator/principal/credential stores
            ├── existing key-read audit and decision evidence
            └── existing resolveWithEvidence → authoritative approval ledger
                                                        │
                                                        ▼
                                existing coordination worker resume lifecycle
```

A separate **negative-test proxy** (also loopback, never simultaneous on the same port) intentionally passes malformed `X-Forwarded-Proto` values to exercise server denial. It is not a production proxy configuration. Direct plain-HTTP requests exercise non-proxy denial; they do **not** prove an untrusted remote peer, because the direct TCP peer remains `127.0.0.1`. A true untrusted-peer test requires an independently isolated, non-trusted source address or a narrowly scoped trusted-proxy configuration that excludes the direct peer; it must be separately designed and checked for network exposure.

**Status — topology-dependent, not yet implemented.** The untrusted-peer denial
row must **not** be counted as covered by any request originating from
`127.0.0.1` (direct or via a loopback proxy). Covering it requires a separately
reviewed topology that presents a genuinely untrusted source address; until that
topology exists and is reviewed, the row is reported as **NOT EXERCISED**, not as
passing.

## 3. Verified contracts versus qualification dependencies

The forms below were checked against the checked-out source (G3 implementation on
`main` after #963; acceptance-plan docs #964). **"Verified" means the form exists
in source.** It does not mean the fixture has executed it. Everything marked
*unresolved* must be settled in D2 qualification and frozen in the fixture
manifest before D3.

| Surface | Verified form / source | State |
| --- | --- | --- |
| Project config | `<cwd>/.alix/config.json` overrides the user config (`operations/config/loader.ts`) | verified (source) |
| User config dir | `homedir()/.config/alix` — **not** XDG-derived; isolate via `HOME` (`loader.ts userConfigDir()`) | verified (source) |
| Platform state | `$XDG_STATE_HOME/alix-inspector` on Linux (`platform/user-state-paths.ts`) | verified (source) |
| `TMPDIR` | honoured for child/sandbox environments, so setting it is effective (`runtime-state/runtime/child-env.ts`; `capabilities/skills/sandbox.ts`) | verified (source) |
| Inspector start | `alix inspector open` (`cli.ts`) | verified (source) |
| Operator enrollment | `alix inspector auth create --name NAME --role operator --workspace PATH` (`security/inspector-auth.ts`) | verified (source) |
| Principal disable | `alix inspector auth principal disable ID --reason REASON` (`security-ops.ts`; added by #961) | verified (source) |
| Credential set | `alix credential set <provider> <keyLabel> <value>` — **the value is argv**; must not be used for fixture seeding | verified (source) |
| Coordination run | `alix coordination run GOAL --session-mode=ask --max-concurrency=1 [--daemon]` (`commands/coordination.ts handleRun`; `--max-concurrency` is equals-form) | verified (source) |
| Coordination reads | `alix coordination status\|results\|list\|workers\|approvals\|events\|cancel <id>` | verified (source) |
| **Terminal run states** | `completed` \| `failed` \| `cancelled` are terminal; `blocked` is **not** (`coordination/kernel/coordination-types.ts`) | **frozen** |
| Audit reads | `alix audit by-action credential.key_read`; `alix audit verify` (`cli.ts`) | verified (source) |
| Key-seeding exports | `generateKey(store)`, `activeKeyVersion(store)`, `writeStoredBackend("plain-file")` (`srap-evidence.ts`, `backend-selection.ts`) | verified (source) |
| Key-seeding backend path | resolved store path must be proven inside `$ROOT/state/alix-inspector` | **unresolved (qualification)** |
| Fixture goal | must force exactly one capability-gated worker under ask mode | **unresolved (qualification)** |
| Host mode | foreground vs `--daemon` retrievability while blocked | **unresolved (qualification)** |
| Status JSON schema | machine-readable field/enum shape for the terminal-status parser | **unresolved (qualification)** |

**No placeholders may remain in an executable script.** Only the verified/frozen
items above may be written into scripts; the unresolved items are settled during
qualification. The approved acceptance matrix remains normative if this design
differs.

## 4. Isolation invariants

- All processes launched for the fixture inherit isolated `HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, and an explicit fixture workspace as current working directory.
- Do not invoke a globally linked ALiX executable until its target build/repository and configuration resolution are confirmed. Prefer a pinned built CLI entrypoint from the reviewed commit.
- The real repository `.alix/`, real user config, and real Inspector state are **read-only observation targets**, never writable fixture destinations.
- Any keychain, secret-service, system daemon, inherited agent process, external model/tool capability, or plugin that could touch production must be disabled or proved isolated before D2.
- Bind Inspector and both proxy variants only to `127.0.0.1`; check actual listeners after startup. Port availability is not a guarantee of isolation.
- Fixture secrets live in `$ROOT/private` (`0700`), outside `$ROOT/runs`; every secret file is `0600`.
- Do not claim that filesystem hashes alone prove no production access. Record process environment, resolved paths, backend selection and outbound capability policy as additional evidence.

### 4.1 Shell preflight — safe, non-executing design

The following block is a **proposed** Bash preflight for an authorized D1 run. Execute from the ALiX repository root, in a dedicated shell; do not source it into a normal user session. It creates directories and snapshots metadata but starts no services.

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077

REAL_HOME="${HOME:?}"
REAL_XDG_STATE="${XDG_STATE_HOME:-$REAL_HOME/.local/state}"
REAL_CONFIG_DIR="$REAL_HOME/.config/alix"
REAL_STATE_DIR="$REAL_XDG_STATE/alix-inspector"
REPO_ROOT="$(pwd -P)"
[[ -d "$REPO_ROOT/.git" || -f "$REPO_ROOT/.git" ]] || { echo 'Not at ALiX repository root' >&2; exit 1; }
ALIX_REPO_ROOT_ABS="$REPO_ROOT"

# Default under /tmp/opencode (this environment's approved external temp dir).
ROOT="${SRAP_ACCEPT_ROOT:-/tmp/opencode/alix-srap-accept/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
[[ "$ROOT" = /* && "$ROOT" != / && "$ROOT" != "$REAL_HOME" ]] || exit 1
mkdir -p -- "$ROOT"/{home,state,cache,tmp,workspace,tls,bin,private,qualification,runs}
chmod 700 "$ROOT" "$ROOT/private"
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$ROOT/runs/$RUN_TS"
mkdir -p -- "$RUN_DIR"/{env,http,ledger,audit,continuity,logs,timing,manifest}

# Preserve the EXACT set of roots and their existence before overrides.
SCAN_DIRS=("$REAL_CONFIG_DIR" "$REAL_STATE_DIR" "$REPO_ROOT/.alix")
for d in "${SCAN_DIRS[@]}"; do
  [[ ! -e "$d" || -d "$d" ]] || { echo "Unexpected scan root type: $d" >&2; exit 1; }
done

# NUL-safe path enumeration. `find` and `sort` failures propagate.
# Missing roots are recorded in a separate existence manifest, so creation later is detected.
snapshot() {
  local output="$1" tempdir files d
  tempdir="$(mktemp -d "$ROOT/private/snapshot.XXXXXX")"
  files="$tempdir/files.nul"
  : > "$files"
  : > "$tempdir/roots.txt"
  for d in "${SCAN_DIRS[@]}"; do
    if [[ -d "$d" ]]; then
      printf 'present\t%s\n' "$d" >> "$tempdir/roots.txt"
      find "$d" -type f -print0 >> "$files" || return 1
    elif [[ ! -e "$d" ]]; then
      printf 'absent\t%s\n' "$d" >> "$tempdir/roots.txt"
    else
      echo "Invalid root: $d" >&2; return 1
    fi
  done
  sort -z -o "$files" "$files" || return 1
  {
    cat "$tempdir/roots.txt"
    # -0 prevents spaces/newlines/quotes in paths from splitting arguments.
    xargs -0 -r stat -c 'stat\t%n\t%s\t%Y\t%a' < "$files"
    xargs -0 -r sha256sum < "$files"
  } > "$output" || return 1
  rm -rf -- "$tempdir"
  [[ -s "$output" ]]
}

BASELINE_BEFORE="$ROOT/private/baseline-before.txt"
snapshot "$BASELINE_BEFORE" || { echo 'Baseline failed; stop' >&2; exit 1; }

export HOME="$ROOT/home"
export XDG_STATE_HOME="$ROOT/state"
export XDG_CACHE_HOME="$ROOT/cache"
export TMPDIR="$ROOT/tmp"
export SRAP_ACCEPT_ROOT="$ROOT"
export ALIX_REPO_ROOT_ABS
cd -- "$ROOT/workspace"
```

**Implementation note:** Although NUL-safe enumeration prevents shell splitting, `stat`/`sha256sum` default text output is not a canonical encoding for filenames containing newlines. For a strict production-integrity proof, use a small audited helper that emits structured, length-safe records (e.g. JSON with escaped paths and hashes), or explicitly fail preflight if any scanned filename contains a newline. Do not silently declare this text manifest complete for arbitrary filenames. Snapshot errors must stop the workflow, and the before/after snapshot must run against the *captured real paths*.

## 5. Fixture configuration and credential setup

### 5.1 Config variants

Generate `$ROOT/workspace/.alix/config.remote-on.json` and `.remote-off.json` using a JSON-aware writer (not a broad `sed` replacement). The enabled variant is:

```json
{
  "ui": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 4139,
    "security": {
      "authentication": "required",
      "remoteAccess": false,
      "allowedHosts": ["127.0.0.1", "localhost"],
      "allowedOrigins": [],
      "trustedProxyCidrs": ["127.0.0.1/32"],
      "requireTlsForRemote": true,
      "remoteDecisions": { "enabled": true }
    }
  }
}
```

**Check the actual configuration schema** before applying this candidate; unknown or ignored keys invalidate the test. Generate the off variant by changing only `ui.security.remoteDecisions.enabled` to `false`. Write files atomically and capture redacted hashes. For H-2, stop Inspector, swap the variant, restart, verify the running config and then assert `404`. Swapping a file while Inspector is running is insufficient.

### 5.2 TLS

For an authorized D1 setup, generate a two-day self-signed certificate with SANs `DNS:localhost` and `IP:127.0.0.1`, private key `0600`, and proxy listener `127.0.0.1:4143`. Use `curl --cacert "$ROOT/tls/proxy.crt"`; do not use `-k`. Verify SAN and expiry. The production proxy must remove **all** inbound `Forwarded`, `X-Forwarded-*` and similar client-originated forwarding headers before writing exactly one canonical trusted client hop (`X-Forwarded-For`, the observed socket peer) and one canonical trusted protocol value (`X-Forwarded-Proto: https`). Both are required: `resolveClientAddress` reports `fromProxy` only when a parseable `X-Forwarded-For` is present, and `deriveRemoteTransport` rejects the request before reading the proto otherwise. The negative proxy is isolated, time-limited and loopback-only.

### 5.3 Operator enrollment — D2 only

The operator is a throwaway fixture principal with `operator` role and a canonical workspace ID/path recognized by the current authorization layer. Never enroll until D2 is explicitly authorized.

```bash
# Illustrative after authorization and CLI verification:
cd -- "$ROOT/workspace"
umask 077
alix inspector auth create \
  --name srap-acceptance-operator --role operator \
  --workspace "$ROOT/workspace" > "$ROOT/private/enroll.raw" 2>&1
chmod 600 "$ROOT/private/enroll.raw"

# Paste token via hidden interactive terminal input; no echo, argv, shell history or logs.
IFS= read -r -s -p 'Fixture bearer token: ' SRAP_TOKEN
printf '\n'
[[ -n "$SRAP_TOKEN" && ${#SRAP_TOKEN} -ge 20 ]] || { unset SRAP_TOKEN; echo 'Invalid token length' >&2; exit 1; }
printf '%s' "$SRAP_TOKEN" > "$ROOT/private/token"
chmod 600 "$ROOT/private/token"
unset SRAP_TOKEN
[[ -s "$ROOT/private/token" ]] || exit 1
```

Do not print the bearer token. Never copy `enroll.raw` into `$RUN_DIR`. Generate a redacted receipt from the authoritative principal store, after verifying its real schema. Do not assume `.principals[-1]` is the newly created principal: identify it by an exact, unique name and validate ID, status, and workspace scope. If no unique match, stop.

**Caution:** `curl -H "Authorization: Bearer $(cat token)"` still places the secret in `curl` argv. Prefer a mode-0600 temporary curl config under `private/` with a `header = "Authorization: Bearer ..."` entry, or a dedicated client that reads the token from a file; confirm the client does not echo request headers. Do not place raw `curl -v` transcripts in shareable evidence.

### 5.4 Evidence HMAC key — D2 only

`alix credential set` reportedly accepts a secret via argv and must not be used for fixture seeding. A reviewed `seed-key.mjs` should import the built, pinned G3 credential APIs, force the fixture's plain-file backend, and call the production `generateKey(store)` path. Its required preconditions are:

1. `ALIX_REPO_ROOT_ABS` is an absolute pinned checkout captured before `cd`.
2. `HOME` and `XDG_STATE_HOME` point to the disposable root.
3. Backend selection and **resolved credential-store path** are checked to be within `$ROOT/state/alix-inspector`, using canonical paths and symlink checks; never assume `writeStoredBackend("plain-file")` alone guarantees isolation.
4. The selected backend is exactly `plain-file`; keychain fallback is not invoked on failure.
5. The script prints only backend identifier, active key version and a non-secret success flag. Never print the key or credential identifiers.

The Rev 2.2 imports and signatures are *reported source checks*, not validated by this review. Freeze the exact built-module imports in a reviewed script after inspecting the checked-out commit. Do not run a placeholder or partially verified script. The reviewed script is authored at `scripts/srap-accept/seed-key.mjs` (imports the built, pinned G3 credential APIs, forces `plain-file`, calls `generateKey(store)`).

### 5.5 Credential sourcing modes and isolated seeding

The OS keychain is shared at OS-user granularity, so overriding `HOME`/`XDG_STATE_HOME` does **not** isolate credential access. Fixture credentials must never resolve through the shared keychain. Three modes, explicitly graded:

| Mode | Credential source | Authorized use |
|------|-------------------|----------------|
| Deterministic acceptance (default) | Fixture-generated credentials; the scripted offline model (`local-llama` → `fixture-mock-model` on `127.0.0.1:8080`, keyless) | D3 protocol, governance, concurrency and negative-path rows |
| Real-provider integration | A **dedicated, restricted test-provider** key seeded into the isolated fixture store | Separately authorized integration test only |
| Live production keychain | The shared OS-user keychain | **Not authorized** |

The fixture keeps its own `plain-file` backend, and **every** credential value lives inside `$SRAP_ACCEPT_ROOT`. Provider keys are referenced as `cred://<provider>/<keyLabel>` in the fixture config; the value is never written into a config file.

Seeding is performed by the reviewed `scripts/srap-accept/seed-provider-key.mjs`, which mirrors the `seed-key.mjs` preconditions (§5.4) and additionally:

- accepts the secret **only** on stdin or an explicit protected file descriptor (`--fd N`) — never argv;
- refuses the reserved `srap-evidence` namespace and any secret that arrives as an argv flag;
- proves read-back after writing and prints only non-secret metadata (backend, provider, label, byte length);
- supports `--list` (labels only) and `--remove` for cleanup.

Operator policy: prefer a dedicated test credential. Copying a live production secret into the fixture duplicates that secret and is **not** equivalent to a test key. Temporary secret files are avoided, and the value never appears in logs, manifests or archived evidence. Pre-seed checklist: the target store must resolve inside the disposable fixture (`credentialsDir()` proven under `$ROOT/state/alix-inspector`, symlink-aware) and the selected backend must be exactly `plain-file`.

## 6. Genuine coordination fixture and qualification

**Qualification is an active test, not merely design preparation.** It requires D2 authorization and must use a fresh disposable workspace with no external side effects.

Qualification protocol:

1. Confirm CLI entrypoint, configuration resolution, local model/tool routing and sandbox policy. Disable network-capable tools or restrict capabilities to a harmless write under the fixture workspace.
2. Choose a deterministic goal that forces **one capability-gated worker** under `--session-mode=ask --max-concurrency=1`; freeze the exact prompt, model, provider, tool policy, timeouts and seed where supported. A prompt alone does not guarantee determinism.
3. Run the real `alix coordination run ...` command. Evaluate foreground and `--daemon` host modes only as needed to establish retrievability while blocked.
4. Observe the authoritative pending approval; verify `coordinationRunId` matches the real run, that the worker is blocked, and that no action occurred before approval.
5. For qualification only, validate continuation via the **existing** approved local approval mechanism if specifically authorized; otherwise record blocked-state qualification and defer resume verification to D3. Do not silently exercise the remote endpoint.
6. Cancel/drain the qualification run, confirm terminal state and no orphaned worker, then discard the qualification workspace while preserving redacted qualification evidence.
7. Freeze qualified inputs in a versioned fixture manifest before D3. Acceptance must begin with a new, genuine run that demonstrably reaches the same approval gate.

**Required continuity artifacts:** run ID and blocking approval ID; approval state transitions; worker `blocked → running → completed`; terminal run outcome and aggregate result; proof that the original `hostKind`, `sessionMode`, and existing resume path were used. Synthetic JSON files cannot substitute for authoritative read-back.

## 7. F-4 principal-disablement race protocol

**Normative linearization boundary:** authorization is the principal read performed for the decision request; decision commit is the existing authoritative `resolveWithEvidence` append. A decision authorized while active may legitimately commit after a concurrent disablement. A request whose authorization read observed missing/disabled must not commit.

- **Conclusive:** run both sequential orders: disable completes before the decision request begins → deny and no commit; authorized decision completes before disable begins → decision may commit normally. Capture authoritative state and ledger evidence.
- **Observational:** 20 barrier-raced trials with a new fixture principal/approval per trial, controlled timeouts and no automatic retries. Record request receive/response boundaries, disable completion, principal post-read, decision ledger outcome, and relevant key-read audit evidence. Do not claim to know the internal read instant in an overlapping race.
- **Key-read witness:** a durable `credential.key_read` event may bound the authorization read *only for paths that reached the key read*, provided ordering and per-request correlation are independently established. Absence of the event does not prove a disabled read; the audit record may not itself contain a decision ID. Do not infer per-request correlation solely from close timestamps.
- **Evaluation:** flag a commit where the decision request started only after a confirmed durable disablement and the server had a consistent view of the disabled principal. Overlap outcomes are observational, not automatic failures based on commit order. Preserve the amended acceptance plan's normative criteria if they are stricter.

Do not add an env-gated authorization recorder to G3 production without a separate reviewed defect/change authorization.

## 8. Evidence contract and matrix mapping

Evidence root: `$ROOT/runs/$RUN_TS/`. No credentials, raw token-bearing headers, key material, raw credential IDs, or private principal-store dumps in the shareable bundle.

| Matrix rows | Evidence required |
| --- | --- |
| A-1–A-4 | Authenticated, missing, invalid and revoked bearer outcomes; bounded HTTP evidence |
| B-1–B-3 | Active, disabled and absent principal; authoritative principal read + decision result |
| C-1–C-3 | Authorized, excluded and empty workspace scope; canonical scope evidence |
| D-1–D-4 | Approve/deny, exact retry, conflicting retry; authoritative ledger transition count |
| E-1–E-4 plus E-2n | Durable key-read audit, deterministic real audit-append failure and fail-closed 503, evidence verification and projection repair; explicitly distinguish audit record from decision evidence |
| F-1–F-4 | Eight-client barrier concurrency (F-1), retry/race cases, F-4 sequential and observational evidence |
| G-1–G-4 | Restart recovery, durable evidence, projection, real worker continuation |
| H-1–H-3 | Independent operator client, default-off after Inspector restart, no second authority, production-integrity verdict |

For F-1, `N=8`, one release barrier, per-request timeout `30 s`, no automatic in-trial retry; expect one authoritative transition, eight `200`s, zero `409`s/timeouts. Count `credential.key_read` for requests that actually reach the key-read path, not simply total HTTP requests.

For E-2, the audit failure must be deterministic against the **real audit append** (not a mock). A directory-at-a-file-path (`EISDIR`) fixture is only valid after confirming the append path and open-file lifecycle. A rejected sink must fail the operation closed and yield a bounded diagnostic; **no durable record of that failed audit attempt is guaranteed**.

Every artifact must record source, timestamp, row ID, expected result, observed result, redaction status, and reviewer verdict. Stop on the first failing row, file a defect and re-enter review before any rerun.

## 9. Production-integrity proof (hybrid model — amended after D1-F1)

> **Amendment (2026-10-16, D1-F1).** D1 executed the preflight and the exact-`cmp`
> guard **failed** — not from fixture activity, but from the **live agent session
> writing its own projection checkpoints** under the repository's
> `.alix/sessions/<id>/**`. All 12 changed baseline lines were in that subtree;
> **zero** changed paths mentioned the fixture root, and the production config dir
> and platform state dir were unchanged. An exact `cmp` over the repository
> `.alix/` therefore cannot serve as an "untouched" proof while a session is live
> in that repository, and would mask a real violation in the noise.
>
> **What changed.** §9 is replaced by the hybrid model below. The old
> exact-`cmp`-only procedure is superseded; it is recorded here rather than
> silently rewritten. **No runtime code changed.**

**Defensible claim.** *Protected production configuration and platform state
remained unchanged, and every observed repository mutation was classified under a
reviewed, explicit exception policy.* This document does **not** claim the entire
production repository was untouched.

### 9.1 Hybrid integrity model

1. **Dedicated, clean worktree, pinned to a commit.** The acceptance environment
   runs from a separate `git worktree` pinned to a recorded commit SHA. Record the
   SHA and verify that **no unrelated ALiX session is running in that worktree**
   before the run.
2. **Exact comparison for production configuration and platform state.** The
   production config dir and the platform state dir are compared **exactly**; **any**
   difference is a failure. No allowlist applies to these.
3. **Separate the active development repository from the acceptance workspace.**
   Changes under the live session's projection subtree are an **explicitly
   identified exception**, never evidence of an untouched repository.
4. **Allowlist for known session-generated files only.** The allowlist may name
   only `<repo>/.alix/sessions/<recorded-session-id>/{events.jsonl,projections/**}`.
   Any change **outside** those paths is a failure. Every excluded path is
   recorded with its justification. **Preferred state: an empty allowlist** (a
   clean worktree with no active session yields zero repository mutations).
5. **Fail closed.** A failed comparison, an ambiguous allowlist, or any unexpected
   path yields **no** successful verdict — preserve evidence and stop.
6. **Record raw *and* filtered evidence.** The complete before/after manifests and
   the full diff stay **private**; a **sanitized** report carries the exception
   count, allowed paths, unexpected-change count, and the verdict.

### 9.2 Classification and evidence format

```text
baseline-before/after = (A) production config dir  +  (B) platform state dir  +  (C) repository .alix/
exact compare A and B                     -> any diff = FAIL
classify C's diff:
  every changed path matches the reviewed allowlist  -> allowed (recorded)
  any changed path outside the allowlist             -> FAIL (unexpected)
```

Machine-readable result (written **only** on success):

```json
{
  "model": "hybrid-allowlist-v1",
  "worktreeCommit": "<sha>",
  "productionConfig": "unchanged",
  "productionState": "unchanged",
  "allowedChangeCount": 0,
  "allowedPaths": [],
  "unexpectedChangeCount": 0,
  "verdict": "pass"
}
```

Private (never archived): `private/baseline-before.txt`, `baseline-after.txt`,
`baseline.diff` (complete). Archived: `runs/<ts>/env/production-integrity.json` +
a sanitized `runs/<ts>/env/production-integrity.txt` (counts and allowed paths
only; no production absolute paths).

### 9.3 D1-F1 acceptance criteria

| Check | Required |
| --- | --- |
| Production config/state exact comparison | PASS |
| Dedicated worktree pinned to commit | PASS |
| Known session changes classified | PASS |
| Unexpected changes | **0** |
| Exclusion rules | Explicit, narrow, auditable |
| Integrity verdict | Machine-readable and reproducible |
| D1-F1 finding | Closed **only after** verification |

The snapshot helper validation caveat from the pre-amendment text still applies
(host filename/permission conditions); a missing or unreadable root is a failure,
never silently ignored.

## 10. Cleanup, archival and deletion safety

Cleanup is a separate, reviewed action; failure must preserve the fixture and its evidence.

1. Stop issuing new requests and prevent any new workers from starting.
2. Cancel/drain the active coordination run using its **real ID**. Parse the authoritative machine-readable status field, not `grep 'terminal'`. Accept only the actual terminal enum values verified against source (e.g. `completed`, `failed`, `cancelled` *if* those are the documented values). Explicitly verify all worker processes are stopped. On timeout, stop and preserve state for investigation.
3. Stop Inspector and proxy using recorded PIDs, verify process identity before signaling, wait for exit, and check ports are no longer listening. Avoid killing unrelated reused PIDs.
4. Run the exact production-state comparison (§9). On mismatch, do not delete.
5. Redact evidence with allowlisted fields at capture time. Run a defense-in-depth secret scan, including bearer token value, credential/key patterns and sensitive header names. `grep` patterns alone are not a complete guarantee. Review samples and fail if scanning itself errors.
6. Set `SRAP_ACCEPT_ARCHIVE` to a **canonical absolute directory outside `$ROOT`**; refuse `/`, `$ROOT`, a child of `$ROOT`, or any symlink resolving inside `$ROOT`. Record archive owner and reviewer.
7. Copy the contents of `$RUN_DIR` into a new archive directory. Generate and verify a sorted SHA-256 manifest **in the archive directory**; additionally compare the source and archive manifests so copying an incomplete subset cannot pass. Require a nonempty archive, a successful integrity flag, a completed row manifest, and reviewer sign-off.
8. Delete **only the exact canonical fixture root**, after a separate explicit cleanup approval and safety checks. Do not use `rm -rf "$ROOT"` on an unchecked variable. A missing/failed prerequisite preserves the root.

Suggested archive verification logic (design; do not execute without D4 approval):

```bash
[[ -f "$ROOT/private/integrity.ok" ]] || exit 1
[[ "$(cat "$ROOT/private/integrity.ok")" == verified ]] || exit 1
[[ -s "$RUN_DIR/manifest/row-verdicts.json" ]] || exit 1
# Resolve ROOT and ARCHIVE via realpath; reject containment in either direction.
# Verify redaction scanner exit status and absence of matches.
# Copy with permissions preserving evidence integrity, compute source+archive digests,
# and compare both complete manifests. Preserve signed review manifest.
# Deletion requires a separately authorized cleanup step.
```

## 11. Review and sign-off manifest

`$RUN_DIR/manifest/manifest.md` must identify: ALiX commit SHA, fixture design revision, acceptance-plan revision, OS/runtime versions, source-verified CLI commands, resolved isolated paths (redacted), TLS trust arrangement, model/tool policy, coordination goal and host mode, run/approval IDs, per-row evidence links, actual failures and retests, production-integrity verdict, archive digest, reviewer identity/date, and a final **PASS / FAIL / INCOMPLETE** conclusion.

**Milestone closure requires** every approved matrix row to pass with independently reviewable evidence, a real separate-client remote decision resuming an existing blocked worker, no unreviewed runtime changes, and reviewer sign-off. CI and static checks are necessary context, not substitutes.

## 12. Open items and next authorization request

The following are intentionally **not** asserted as resolved: exact fixture goal, stable model/tool policy, foreground versus daemon host mode, verified status JSON schema/terminal enums, compiled key-seeding exports and backend path, real proxy implementation and malformed-header behavior, truly untrusted-peer test topology, availability of ports 4139/4143, archive destination, reviewer/signatory, and whether production filesystem snapshot handling needs a binary-safe helper for unusual filenames.

**Gate advance (2026-10-16).** D1 is closed and D2 is recorded complete by
operator decision (operational qualification, PR #969). **D3 integrated acceptance
is authorized and in progress**; the frozen D3 inputs are recorded in
`docs/2026-10-16-srap-g3-d2-d3-handoff.md`. **D4 closure remains unauthorized.**
The untrusted-peer denial row remains **NOT EXERCISED at bootstrap**; it is
**EXERCISED and DENIED** in §4.9. Fixture credential
sourcing is frozen to the deterministic scripted provider (§5.5); real-provider
integration uses only a dedicated test key seeded through
`scripts/srap-accept/seed-provider-key.mjs`, under separate authorization. The
shared OS-user keychain is **not authorized**.

---

**Document integrity:** This is a consolidated proposed fixture specification based on the supplied Rev 2.2 document and prior review findings. It has not been run against the repository or acceptance host, and no source-code verification or security-test results are claimed here.
