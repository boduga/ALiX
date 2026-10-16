# SRAP-G3-ACCEPT — acceptance environment & coordination fixture (design)

Status: **PROPOSED — design + commands only. Nothing here has been executed.**
Acceptance execution is separately authorized; this document prepares the
environment and the deterministic fixture so the run is reproducible and
independently reviewable.

Companion: `docs/2026-10-15-srap-g3-acceptance-plan.md` (the matrix, rev 2 +
amendment). Milestone: `SRAP-G3-ACCEPT`.

## 1. Isolation model

Everything the acceptance run reads or writes lives under one disposable root,
`$SRAP_ACCEPT_ROOT`. Production state is **never** touched.

| Surface | Production default | Acceptance override | Why |
| --- | --- | --- | --- |
| User config | `~/.config/alix/config.json` (`userConfigDir()` = `homedir()/.config/alix`) | `HOME=$SRAP_ACCEPT_ROOT/home` | moves the homedir-derived config dir under the fixture |
| Platform state (auth store, principals, credential store, audit logs) | `$XDG_STATE_HOME/alix-inspector` or `~/.local/state/alix-inspector` | `XDG_STATE_HOME=$SRAP_ACCEPT_ROOT/state` (plus `HOME` for other platforms) | auth/credential/principal stores resolve under the fixture |
| Project root (`.alix/`: approvals, audit chain, runtime ledger, config) | the dev repo | `$SRAP_ACCEPT_ROOT/workspace` | project-scoped state is disposable |
| Caches | `~/.cache` | `XDG_CACHE_HOME=$SRAP_ACCEPT_ROOT/cache` | belt and braces |

Derived paths (verified from `getUserStatePaths()`):

```
<state>/alix-inspector/auth/auth-store.json          # StoredToken records (principalId binding)
<state>/alix-inspector/auth/principals.json          # PrincipalRecord
<state>/alix-inspector/auth/audit.jsonl              # auth audit (AuthAuditStore)
<state>/alix-inspector/data/credentials/credential-store.json  # srap-evidence HMAC keys
<workspace>/.alix/config.json                        # project config (overrides user config)
<workspace>/.alix/approvals/approvals.json           # ApprovalStore projection
<workspace>/.alix/runtime-ledger.db                  # authoritative approval ledger
<workspace>/.alix/audit/audit.jsonl                  # audit chain (decision evidence, key-read audit)
```

**Pre/post production-state guard.** Before the run, record
`sha256` + `mtime` of `~/.config/alix/config.json`, `~/.local/state/alix-inspector/**`
and the dev repo's `.alix/**` into `runs/<ts>/env/production-baseline.txt`; re-record
after cleanup and assert equality (H-3 evidence).

## 2. Directory layout and evidence paths

```
$SRAP_ACCEPT_ROOT/
  home/                      # HOME override
  state/                     # XDG_STATE_HOME override (auth + credentials + auth audit)
  cache/
  workspace/                 # project root; .alix/ lives here
  tls/                       # proxy.crt, proxy.key, ca note
  bin/proxy.mjs              # local TLS reverse proxy (below)
  runs/<UTC-timestamp>/      # ONE directory per acceptance run — the evidence bundle
    manifest.md              #   row → artifact → verdict → reviewer sign-off
    env/env.json             #   resolved config + versions (secrets redacted)
    env/production-baseline.txt
    http/<row-id>.*.http     #   raw request/response transcripts (curl -i / -w)
    ledger/<row-id>.json     #   approval ledger extracts (alix approvals --json variants)
    audit/<row-id>.json      #   alix audit by-action / by-approval extracts
    continuity/<row-id>.json #   run status, worker snapshots, aggregate result (G-4/H-1)
    logs/inspector.log       #   server stdout/stderr (bounded diagnostic lines live here)
    logs/proxy.log
    secrets/                 #   mode 0600: the operator bearer token. NEVER copied into the bundle.
```

`secrets/` is excluded from anything shared; `manifest.md` references it by path
only. All artifacts are **redacted**: no bearer tokens, cookies, key material, or
raw credential ids. Redaction is verified by a scan before sign-off.

## 3. Setup commands (design; run during preparation, not acceptance)

```bash
# 0. Isolated root
export SRAP_ACCEPT_ROOT="${SRAP_ACCEPT_ROOT:-/tmp/opencode/alix-srap-accept/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$SRAP_ACCEPT_ROOT"/{home,state,cache,workspace,tls,bin,runs}
export HOME="$SRAP_ACCEPT_ROOT/home"
export XDG_STATE_HOME="$SRAP_ACCEPT_ROOT/state"
export XDG_CACHE_HOME="$SRAP_ACCEPT_ROOT/cache"

# 1. Production-state baseline (H-3)
{ sha256sum ~/.config/alix/config.json 2>/dev/null; find ~/.local/state/alix-inspector -type f -exec sha256sum {} + 2>/dev/null; } \
  > "$SRAP_ACCEPT_ROOT/runs/baseline.txt"

# 2. Project config (remote decisions ENABLED for this workspace only)
mkdir -p "$SRAP_ACCEPT_ROOT/workspace/.alix"
cat > "$SRAP_ACCEPT_ROOT/workspace/.alix/config.json" <<JSON
{
  "ui": {
    "enabled": true, "host": "127.0.0.1", "port": 4139,
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
JSON
# H-2 (default-off) uses the SAME file with remoteDecisions.enabled=false — keep
# config.remote-on.json / config.remote-off.json and swap for that row.

# 3. Local TLS material
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout "$SRAP_ACCEPT_ROOT/tls/proxy.key" -out "$SRAP_ACCEPT_ROOT/tls/proxy.crt" \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# 4. Enroll the operator credential (creates principal + first credential; token shown ONCE)
cd "$SRAP_ACCEPT_ROOT/workspace"
alix inspector auth create --name srap-acceptance-operator --role operator \
  --workspace "$SRAP_ACCEPT_ROOT/workspace" \
  > "$SRAP_ACCEPT_ROOT/runs/enroll.json"        # operator copies the token into secrets/
#   → chmod 600 "$SRAP_ACCEPT_ROOT/runs/secrets/token"

# 5. Seed the active srap-evidence key (version 1) — no CLI generates it today
KEY=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
alix credential set srap-evidence hmac-key:v1 "$KEY"    # confirm exact arg form at prep
unset KEY

# 6. Start the Inspector (background), then the TLS proxy in front of it
(alix inspector open > "$SRAP_ACCEPT_ROOT/runs/logs/inspector.log" 2>&1 &)   # browser open is best-effort
(node "$SRAP_ACCEPT_ROOT/bin/proxy.mjs" > "$SRAP_ACCEPT_ROOT/runs/logs/proxy.log" 2>&1 &)
```

**Proxy design** (`bin/proxy.mjs`): an HTTPS server on `127.0.0.1:4143` that
terminates TLS with `tls/proxy.crt` and forwards each request to
`http://127.0.0.1:4139`, adding exactly one `X-Forwarded-Proto: https` and
`X-Forwarded-For: <client>`. It must **never** forward a client-supplied
`X-Forwarded-Proto` (that is the ambiguous-protocol deny row). The Inspector sees
peer `127.0.0.1`, which is inside `trustedProxyCidrs` → `proxy-tls`.

**Client** (P-CLIENT): a separate process from the Inspector, using
`curl -sS -i --cacert tls/proxy.crt https://localhost:4143/...` with
`Authorization: Bearer $(cat runs/secrets/token)`.

## 4. Coordination fixture design (deterministic, genuine blocking)

Requirement (plan G-4/H-1): a **real** coordination run that blocks on an
approval and demonstrably resumes through the existing lifecycle. No synthetic
state files.

**Construction.**

```bash
cd "$SRAP_ACCEPT_ROOT/workspace"
alix coordination run "<goal>" --session-mode=ask --max-concurrency=1 \
  > "$SRAP_ACCEPT_ROOT/runs/continuity/run-start.json" 2>&1 &
```

- `--session-mode=ask` is the gate: capability execution asks for approval
  (scheduler default `sessionMode = config.permissions.sessionMode ?? "ask"`).
- `--max-concurrency=1` keeps the blocking approval unambiguous.
- The run persists (`run-id` in `runs/continuity/run-start.json`).

**Determinism requirement.** The fixture goal must be chosen so the planner emits
at least one capability-gated worker. **Confirm during preparation** (not
acceptance) that a blocking approval appears whose record carries
`coordinationRunId == <run-id>` — read it from
`<workspace>/.alix/approvals/approvals.json` (or `alix approvals --json`). If no
such approval appears, adjust the goal or the capability gate before
authorizing the run; the acceptance run must start from a run that is already
verifiably blocked.

**Production surface.** The fixture workspace is disposable; the coordination run
executes **only** inside `$SRAP_ACCEPT_ROOT/workspace`. No live workload, no
production credentials.

**Evidence produced for G-4/H-1** (into `runs/<ts>/continuity/`):

| Artifact | Source |
| --- | --- |
| `run.json` | `alix coordination status <run-id> --json` — id, `hostKind`, `sessionMode`, terminal state |
| `blocking-approval.json` | the approval whose `coordinationRunId == run-id`, with its transition records |
| `workers-before.json` / `workers-after.json` | `alix coordination list <run-id> --json` — worker states (`blocked`→`running`→`completed`) |
| `results.json` | `alix coordination results <run-id> --json` — aggregate/final outcome |
| `resume-proof.md` | the observed resume path (approval resolution tick / `shouldReclaimWorker`) and the unchanged `hostKind`/`sessionMode` |

Read-back uses the sanctioned tools — `alix_coordination_status` /
`_list` / `_results` equivalents — so the evidence is the system's own view, not
a hand-authored file.

## 5. Row → evidence mapping (abbreviated)

| Row(s) | Primary artifact(s) |
| --- | --- |
| A-* / B-* / C-* / D-* | `http/<row>.http` + `ledger/<row>.json` (+ `audit/` for key-read) |
| E-1 / E-2 / E-2n / E-3 | `audit/keyread.json`, `logs/inspector.log` (diagnostic), `audit/verify.txt`, `audit/<row>.json` |
| E-4 | `ledger/project-1.json`, `ledger/project-2.json` (counters, `lag`) |
| F-1..F-4 | `http/f-*` (all responses) + `ledger/` (transition count) + `audit/keyread.json` + harness timings |
| G-1..G-4 | restart pairs + `continuity/*` |
| H-1..H-3 | client transcript + `continuity/*` + `env/production-baseline.txt` |
| (all) | `manifest.md` |

F-4 additionally records, per trial: request-dispatch time, disable-completion
time, and a post-commit principal re-read — the witnesses the amended criterion
requires.

## 6. Cleanup procedures

```bash
# 1. Stop the runner processes (record PIDs at start)
kill "$(cat "$SRAP_ACCEPT_ROOT/runs/pids/proxy.pid")" 2>/dev/null || true
kill "$(cat "$SRAP_ACCEPT_ROOT/runs/pids/inspector.pid")" 2>/dev/null || true

# 2. Cancel any in-flight coordination run (no orphaned workers)
cd "$SRAP_ACCEPT_ROOT/workspace" && alix coordination cancel <run-id> || true

# 3. Production-state guard: re-hash and diff against the baseline
{ sha256sum ~/.config/alix/config.json 2>/dev/null; find ~/.local/state/alix-inspector -type f -exec sha256sum {} + 2>/dev/null; } \
  > "$SRAP_ACCEPT_ROOT/runs/production-after.txt"
diff "$SRAP_ACCEPT_ROOT/runs/baseline.txt" "$SRAP_ACCEPT_ROOT/runs/production-after.txt" \
  && echo "PRODUCTION UNTOUCHED" || echo "PRODUCTION STATE CHANGED — STOP, INVESTIGATE"

# 4. Preserve the evidence bundle, then remove the disposable root
#    (copy runs/ off-root first if it must survive; secrets/ is excluded)
rm -rf "$SRAP_ACCEPT_ROOT"
```

Cleanup is **not** destructive to anything outside `$SRAP_ACCEPT_ROOT`. The
production-state diff is itself H-3 evidence.

## 7. Safety

- No destructive testing against production credentials or live workloads.
- The bearer token and the `srap-evidence` key never leave `secrets/`/the store;
  artifacts are redacted and scanned before sign-off.
- The TLS proxy must not honour client-supplied forwarded headers.
- Any failing row stops the run: file the defect, re-enter review, re-run the
  affected rows only after a fix is merged.

## 8. Open items to settle during preparation (not acceptance)

1. Exact `alix credential set` argument form for the `srap-evidence` key.
2. The fixture goal that reliably produces a capability-gated, blocking worker.
3. Port choice (`4139`/`4143` above) free on the acceptance host.
4. Where the evidence bundle is archived after the run (outside the disposable
   root) and who signs the manifest.

## 9. Explicitly out of scope

- Running the acceptance matrix; triggering any remote approval decision;
  marking `SRAP-G3-ACCEPT` complete.
- Any change to G3 runtime behaviour, approval authority, ledger, or execution.
