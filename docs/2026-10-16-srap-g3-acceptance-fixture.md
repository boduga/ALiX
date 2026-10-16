# SRAP-G3-ACCEPT — acceptance environment & coordination fixture (rev 2.2)

Status: **PROPOSED (rev 2.2) — design + verified commands only. Nothing executed.**
**Approved: non-executing fixture preparation.** Still **not authorized**: starting
the Inspector, enrolling live credentials, running coordination qualification,
issuing remote decisions, or executing the acceptance matrix.

**Rev 2.2 corrects the executable shell procedures** (1) baseline snapshot is now
strictly fail-closed under `set -euo pipefail` with explicit directories and
separately checked generation commands; (2) the enrollment receipt is derived from
the authoritative principal store, never from the raw response; (3) key seeding
pins an absolute repo root captured before any `cd` and forces the plain-file
backend so a production keychain cannot be selected; (4) F-4 drops the invalid
"denied ⇒ must commit" inference (`tK` exists only on the commit path); the two
sequential orders stay conclusive and the overlap band stays observational; (5) a
sanitized production-integrity verdict is folded into the evidence tree before
archival; (6) cleanup requires a confirmed terminal run state before stopping
processes or deleting anything.

**Rev 2.1 was a safety-and-reproducibility correction** (no SRAP runtime change, no
change to the approved acceptance matrix): operator token never written to the
shareable tree; archive verification performed in the directory actually hashed,
with deletion blocked on failure; F-4 read-boundary tightened with authoritative
instrumentation and the residual labelled observational; isolation/cleanup guards
fail closed; `seed-key.mjs` de-placeholdered and its signatures verified; the
negative proxy constrained to loopback; and the default-off row now requires a
config reload, not just a file swap.

Companion: `docs/2026-10-15-srap-g3-acceptance-plan.md` (matrix, rev 2 +
amendment). Milestone: `SRAP-G3-ACCEPT`.

**Rev 2 resolves the seven blocking findings:** P0-1 baseline captured before
`HOME` is overridden; P0-2 a controlled TLS negative-test fixture; P0-3 a
deterministic coordination fixture with qualification separated from execution;
P1-4 one timestamped run directory created up front; P1-5 no secret in argv;
P1-6 safe cleanup order; P1-7 verified archival before deletion. It also corrects
the F-4 terminology to **authorization-read ordering**.

## 0. Verified command surface

Every command below was checked against the current CLI source. Assumptions are
now facts, with the *two* deliberate exceptions called out.

| Contract | Verified form | Source |
| --- | --- | --- |
| Project config | `<cwd>/.alix/config.json` overrides the user config | `operations/config/loader.ts` |
| User config dir | `homedir()/.config/alix` (NOT XDG) → isolate via `HOME` | `loader.ts userConfigDir()` |
| State dir | `$XDG_STATE_HOME/alix-inspector` on Linux → isolate via `XDG_STATE_HOME` | `platform/user-state-paths.ts` |
| Start Inspector | `alix inspector open` | `cli.ts` |
| Enroll operator | `alix inspector auth create --name <n> --role operator --workspace <path>` (creates principal + first credential; token shown once) | `security/inspector-auth.ts` |
| Credential set | `alix credential set <provider> <keyLabel> <value>` — **value is argv**, hence avoided | `security/credentials.ts` |
| Coordination run | `alix coordination run "<goal>" [--daemon] [--max-concurrency=N] [--session-mode=bypass\|auto\|ask]` | `commands/coordination.ts handleRun` |
| Coordination reads | `alix coordination status\|results\|list\|workers\|approvals\|events\|cancel <id>` | `commands/coordination.ts` |
| Disable principal | `alix inspector auth principal disable <principal-id> --reason <r>` | `security/inspector-auth.ts` |
| Evidence read-back | `alix audit by-action credential.key_read`, `alix audit verify`, `alix approvals --json` | `cli.ts`, `audit.ts` |

**Deliberately unverified until fixture qualification** (see §6): the fixture
*goal* that reliably yields a blocking capability-gated worker, and the run's
host mode (`--daemon` vs foreground). Neither can be settled by reading source
alone; both are settled in qualification, under a scoped throwaway approval.

## 1. Isolation model

| Surface | Production default | Acceptance override |
| --- | --- | --- |
| User config | `<REAL_HOME>/.config/alix/config.json` | `HOME=$ROOT/home` |
| Platform state | `$XDG_STATE_HOME` / `~/.local/state` `…/alix-inspector` | `XDG_STATE_HOME=$ROOT/state` |
| Project root (`.alix/`) | the dev repo | `$ROOT/workspace` |
| Caches | `~/.cache` | `XDG_CACHE_HOME=$ROOT/cache` |

Derived paths (from `getUserStatePaths()` and the store constructors):

```
<state>/alix-inspector/auth/auth-store.json                    # StoredToken records (principalId binding)
<state>/alix-inspector/auth/principals.json                    # PrincipalRecord
<state>/alix-inspector/auth/audit.jsonl                        # auth audit
<state>/alix-inspector/data/credentials/credential-store.json  # srap-evidence keys
<workspace>/.alix/config.json                                  # project config
<workspace>/.alix/approvals/approvals.json                     # ApprovalStore projection
<workspace>/.alix/runtime-ledger.db                            # authoritative approval ledger
<workspace>/.alix/audit/audit.jsonl                            # audit chain
```

### 1.1 Production-state baseline — captured FIRST (P0-1)

The baseline is captured **before** any environment variable changes, using
**absolute** `<REAL_*>` paths derived from the current environment. `~` is never
used after the override.

```bash
ROOT="${SRAP_ACCEPT_ROOT:-/tmp/opencode/alix-srap-accept/$(date -u +%Y%m%dT%H%M%SZ)}"
REAL_HOME="$HOME"
REAL_XDG_STATE="${XDG_STATE_HOME:-$REAL_HOME/.local/state}"
REAL_CONFIG_DIR="$REAL_HOME/.config/alix"
REAL_STATE_DIR="$REAL_XDG_STATE/alix-inspector"
REPO_ROOT="$(pwd)"                       # the dev repo containing .alix/

set -euo pipefail                             # any failing step aborts the procedure
umask 077                                     # nothing group/world readable
mkdir -p "$ROOT"/{home,state,cache,workspace,tls,bin,private,qualification}
chmod 700 "$ROOT/private"
BASELINE_BEFORE="$ROOT/private/baseline-before.txt"

# Explicit directory list; a missing dir is skipped, never silently swallowed.
SCAN_DIRS=()
for d in "$REAL_CONFIG_DIR" "$REAL_STATE_DIR" "$REPO_ROOT/.alix"; do
  [ -e "$d" ] && SCAN_DIRS+=("$d")
done
[ "${#SCAN_DIRS[@]}" -gt 0 ] || { echo "no production directories to baseline — abort"; exit 1; }

# Manifest = path + size + mtime + sha256 (metadata AND content), sorted, so
# created/deleted files are detected by a plain diff — not only changed hashes.
# FAIL CLOSED: each generation command is checked; a scan error aborts.
snapshot() {
  local list rc=0
  list="$(mktemp)" || return 1
  if ! find "${SCAN_DIRS[@]}" -type f -print > "$list"; then rm -f "$list"; return 1; fi
  if ! sort -o "$list" "$list"; then rm -f "$list"; return 1; fi
  xargs -r stat -c '%n %s %Y' < "$list" || rc=1
  xargs -r sha256sum          < "$list" || rc=1
  rm -f "$list"
  return "$rc"
}
snapshot > "$BASELINE_BEFORE" || { echo "BASELINE COLLECTION FAILED — abort"; exit 1; }
[ -s "$BASELINE_BEFORE" ] || { echo "no baseline — abort"; exit 1; }
```

The guard therefore covers **content + metadata**, includes the repo's real
`.alix/`, and (via a sorted full manifest diff) catches creations and deletions,
not just modifications.

### 1.2 Secrets live outside the shareable tree (correction)

`$ROOT/private/` (mode 0700) holds the operator bearer token and any run secrets.
It is **not** inside `$ROOT/runs/`, so the evidence tree can be copied, zipped and
reviewed without accidentally shipping credentials.

## 2. One run directory, created up front (P1-4)

```bash
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$ROOT/runs/$RUN_TS"
mkdir -p "$RUN_DIR"/{env,http,ledger,audit,continuity,logs,timing,manifest}
```

Every artifact path in this document is **relative to `$RUN_DIR`**; nothing writes
to `runs/` without `RUN_DIR` as its root. (Rev 1 created `runs/` but wrote to
`runs/<subdir>` without creating them.)

## 3. Setup commands (design; run during preparation, not acceptance)

```bash
# 3.1 Environment override (AFTER the baseline in §1.1)
export HOME="$ROOT/home"
export XDG_STATE_HOME="$ROOT/state"
export XDG_CACHE_HOME="$ROOT/cache"

# 3.2 Project config — remote decisions ENABLED only in this workspace
mkdir -p "$ROOT/workspace/.alix"
cat > "$ROOT/workspace/.alix/config.remote-on.json" <<JSON
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
# H-2 variant: identical with remoteDecisions.enabled=false. Replacing the file is
# NOT sufficient — the Inspector caches config at startup, so H-2 swaps the file
# AND restarts the Inspector, then asserts 404 (proving the running process
# applied the value, not merely that the file changed).
sed 's/"enabled": true }/"enabled": false }/' \
  "$ROOT/workspace/.alix/config.remote-on.json" \
  > "$ROOT/workspace/.alix/config.remote-off.json"
cp "$ROOT/workspace/.alix/config.remote-on.json" "$ROOT/workspace/.alix/config.json"

# 3.3 TLS material for the production-mode proxy
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout "$ROOT/tls/proxy.key" -out "$ROOT/tls/proxy.crt" \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# 3.4 Enroll the operator (principal + credential; token displayed once)
cd "$ROOT/workspace"
# The raw token is a ONE-TIME secret: capture it ONLY under private/ (0600).
umask 077
alix inspector auth create --name srap-acceptance-operator --role operator \
  --workspace "$ROOT/workspace" > "$ROOT/private/enroll.raw" 2>&1
chmod 600 "$ROOT/private/enroll.raw"
# The operator copies the bearer value into $ROOT/private/token (0600). The token
# format is not parsed here (no assumption about the CLI's exact output).
printf 'paste the bearer token here, then chmod 600\n' > "$ROOT/private/token"

# Evidence receipt is derived from the AUTHORITATIVE principal store, never from
# the raw enrollment response (which is never copied into evidence).
PRINCIPALS="$ROOT/state/alix-inspector/auth/principals.json"
[ -s "$PRINCIPALS" ] || { echo "principal store missing — enrollment did not complete"; exit 1; }
{ echo "principalId: $(jq -r '.principals[-1].id' "$PRINCIPALS")";
  echo "name:        $(jq -r '.principals[-1].name' "$PRINCIPALS")";
  echo "status:      $(jq -r '.principals[-1].status' "$PRINCIPALS")";
  echo "createdAt:   $(jq -r '.principals[-1].createdAt' "$PRINCIPALS")";
  echo "token:       [redacted — see private/token]"; } > "$RUN_DIR/env/enroll.receipt.txt"

# 3.5 Seed the active srap-evidence key WITHOUT argv exposure (P1-5)
#     `alix credential set` takes the value in argv, so we do NOT use it.
#     The seed uses the SAME code path production uses (generateKey), via a
#     script that reads no secret from the command line.
node "$ROOT/bin/seed-key.mjs"
```

`bin/seed-key.mjs` — no argv secret, no placeholder. The repo root is passed by
environment (`ALIX_REPO_ROOT`); the named exports and signatures are **verified**
against the built module: `chooseBackend()` / `loadCredentialStoreWithKeychainFallback(backend)`
(`backend-selection.ts`) and `generateKey(store): Promise<number>` /
`activeKeyVersion(store): number | null` (`srap-evidence.ts`).

```js
const REPO = process.env.ALIX_REPO_ROOT;
if (!REPO) throw new Error("ALIX_REPO_ROOT is required");
const { chooseBackend, loadCredentialStoreWithKeychainFallback } =
  await import(`${REPO}/dist/src/governance/security/credentials/backend-selection.js`);
const { generateKey, activeKeyVersion } =
  await import(`${REPO}/dist/src/governance/security/credentials/srap-evidence.js`);
const { writeStoredBackend } = await import(`${REPO}/dist/src/governance/security/credentials/backend-selection.js`);
await writeStoredBackend("plain-file");                      // pin the selector; never probe a keychain
const backend = await chooseBackend();
if (backend !== "plain-file") throw new Error(`backend isolation failed: ${backend}`);
const store = await loadCredentialStoreWithKeychainFallback(backend);
const seededKeyVersion = await generateKey(store);           // verified signature
const active = activeKeyVersion(store);                      // verified signature
console.log(JSON.stringify({ backend, seededKeyVersion, active }));
```

Run: `ALIX_REPO_ROOT="$ALIX_REPO_ROOT_ABS" node "$ROOT/bin/seed-key.mjs"`, where
`ALIX_REPO_ROOT_ABS` is captured as an **absolute** path (`cd <repo> && pwd -P`)
**before** any `cd` into the fixture workspace. The script forces the plain-file
backend so a production keychain can never be selected.

## 4. TLS: production-mode proxy and a separate negative-test proxy (P0-2)

Two fixtures, clearly separated. The **production-mode** proxy strips untrusted
forwarded headers (as production must); the **negative-test** proxy deliberately
preserves a client-supplied `X-Forwarded-Proto` so the ambiguous/mismatch *deny*
rows can be exercised at all.

| Fixture | File | Behaviour | Used by |
| --- | --- | --- | --- |
| Production-mode | `bin/proxy.mjs` | TLS terminate; forward to `127.0.0.1:4139` adding exactly one `X-Forwarded-Proto: https` and `X-Forwarded-For: <client>`; **deletes** any client-supplied forwarded headers | allow rows (A-1, B-1, C-1, D-1/D-2, F-*, H-1) |
| Negative-test | `bin/negative-proxy.mjs` | TLS terminate; forward the client's `X-Forwarded-Proto` **verbatim**; peer is still `127.0.0.1` (inside `trustedProxyCidrs`) | the ambiguous/mismatch deny rows (`X-Forwarded-Proto: "https, http"`, `"http"`) |

Both bind **`127.0.0.1` only** and listen on `127.0.0.1:4143` (run one at a
time), so the Inspector always sees the same trusted peer. The negative proxy is
started **only** for the malformed-proto deny rows and stopped immediately after;
it must never run alongside the production-mode proxy, and neither proxy may bind
a non-loopback interface. The negative proxy exists **only** to present a
malformed forwarded value to the real server; it is instrumentation, not a code
change.

Untrusted-peer denial is exercised by pointing the client directly at the
Inspector's plain-HTTP port (`127.0.0.1:4139`) — no proxy — which must fail closed.

## 5. F-4 instrumentation — authorization-read ordering (terminology correction)

Dispatch/response timestamps **bound** the authorization read; they do **not**
establish when the principal was actually read. The acceptance therefore claims
only what the bracket supports.

Request/response timestamps alone only **bound** the read; they cannot establish
its observed state in an overlapping race. Rev 2.1 therefore (a) tightens the
bracket with **existing authoritative instrumentation** and (b) labels the
residual band **observational**, never proof.

**Authoritative witness (existing, no runtime change).** On the commit path the
order is: authorization read → `signCredentialRef` → the `credential.key_read`
audit append → the `resolveWithEvidence` ledger commit. So for any **committed**
decision the authoritative key-read record timestamp `tK` satisfies
`read r ≤ tK ≤ commit`. This narrows the read window from `(tA_recv, tA_resp]` to
`(tA_recv, tK]`.

Per trial, record in `$RUN_DIR/timing/f-4.jsonl`:

| Quantity | Source (authoritative unless noted) |
| --- | --- |
| `tD_recv` | disable request received (proxy log; harness) |
| `tD_done` | first read observing `status: disabled` after the write (upper bound on write durability) |
| `tA_recv` | decision request received (proxy log) |
| `tK` | **`credential.key_read` audit record** for this decision (authoritative; absent when denied) |
| `authorized` | whether the decision committed (ledger) |
| `post_read` | principal re-read after the trial (state + `disabledAt`) |

Criterion:

| Case | Inference | Required outcome |
| --- | --- | --- |
| `tA_recv ≥ tD_done` and **denied** | read necessarily observed `disabled` | **correct** |
| `tA_recv ≥ tD_done` and **committed** | read necessarily observed `disabled` | **FAIL** (commit after a disabled read) |
| **committed** and `tK ≤ tD_recv` | read `≤ tK ≤ tD_recv < tD_done` → observed `active` | **legitimate**; no failure |
| **denied** | `tK` does not exist (the key-read path was never reached) | nothing follows — absence of `tK` proves nothing |
| overlap (`tD_recv < tK` for a commit, or `tA_recv < tD_done`) | read may have observed either state | **observational only**; both outcomes accepted, no claim about the read instant |
| always | consistency | `post_read` is `active`, or `disabled` with `disabledAt` ≥ `tA_recv` |

**Conclusive vs observational.** Only the **two deterministic sequential orders**
are conclusive evidence for the contract. The 20 overlapping trials are
**observational**: they record outcomes and flag anything unexpected for
investigation, without reconstructing an internal read instant. Conclusive proof
inside the overlap band would require a narrowly scoped authorization-read
witness; per the operator decision that runtime change is **not** introduced now
and would be authorized separately if these trials show suspicious behaviour.

This enforces the **authorization-read contract**, not commit ordering, so a
legitimate "authorized while active, committed after disable" outcome is accepted,
not rejected.

## 6. Coordination fixture — qualification vs execution (P0-3)

**No coordination run starts until explicitly authorized.** Two separate steps:

**6a. Fixture qualification** (own authorization; throwaway fixture; not an
acceptance row). Purpose: turn the two unverified items into facts.

1. Select a candidate goal and start a run in the fixture workspace:
   `alix coordination run "<goal>" --session-mode=ask --max-concurrency=1`
   (add `--daemon` per host-mode choice below).
2. Observe that a blocking approval appears whose record carries
   `coordinationRunId == <run-id>` (read `<workspace>/.alix/approvals/approvals.json`).
3. Settle the **host mode**: confirm whether the run stays retrievable while
   blocked and resumes after the approval resolves — for the foreground CLI
   (`--daemon` off) and, if needed, `--daemon`.
4. Record the qualification transcript in `$ROOT/qualification/` and freeze the
   goal + host mode as the fixture's fixed inputs.
5. Cancel the qualification run and discard its fixture.

**Only after 6a passes** does the acceptance run reuse those frozen inputs.

**6b. Acceptance construction** (the authorized run). Determinism rests on 6a
having fixed the inputs; the acceptance run must start from a run that is already
verifiably blocked, then proceed to the decision.

**G-4/H-1 evidence** (into `$RUN_DIR/continuity/`), read back through the
sanctioned tools only:

| Artifact | Source |
| --- | --- |
| `run.json` | `alix coordination status <run-id>` — id, `hostKind`, `sessionMode`, terminal state |
| `blocking-approval.json` | the approval whose `coordinationRunId == run-id`, with transitions |
| `workers-before.json` / `workers-after.json` | `alix coordination list <run-id>` / `workers` — `blocked`→`running`→`completed` |
| `results.json` | `alix coordination results <run-id>` — aggregate/final outcome |
| `resume-proof.md` | observed resume path + unchanged `hostKind`/`sessionMode` |

## 7. Finalization — verify the archive before deleting (P1-7)

The fixture root is the **only** copy until it is archived. Order is mandatory:

```bash
ARCHIVE="${SRAP_ACCEPT_ARCHIVE:?set an archive destination outside the disposable root}"
mkdir -p "$ARCHIVE/$RUN_TS"

# 7.0 Fold a SANITIZED production-integrity verdict into the evidence tree
#     (the raw manifest under private/ is never archived).
{
  echo "verdict: $(tail -1 "$ROOT/private/baseline.diff" | tr -d '\n')"
  echo "baseline_entries: $(wc -l < "$ROOT/private/baseline-before.txt")"
  echo "after_entries:    $(wc -l < "$ROOT/private/baseline-after.txt")"
  echo "diff_bytes:       $(wc -c < "$ROOT/private/baseline.diff")"
  echo "scan_dirs:        <REDACTED: production paths omitted>"
} > "$RUN_DIR/env/production-integrity.txt"

# 7.1 Redaction scan — refuse to archive anything containing a secret shape
if grep -rIlE 'Bearer [A-Za-z0-9._-]{20,}|"value"\s*:|hmac-key:v[0-9]+' "$RUN_DIR" ; then
  echo "REDACTION FAILURE — do not archive"; exit 1
fi

# 7.2 Copy the CONTENTS into the archive root (not run-dir inside run-dir),
#     then hash and verify IN THE SAME directory that was written.
ARCH="$ARCHIVE/$RUN_TS"
mkdir -p "$ARCH"
cp -a "$RUN_DIR/." "$ARCH/"
( cd "$ARCH" && find . -type f ! -name 'SHA256SUMS' -exec sha256sum {} + | sort ) > "$ARCH/SHA256SUMS"
( cd "$ARCH" && sha256sum -c SHA256SUMS --quiet ) || { echo "ARCHIVE MISMATCH — do not delete"; exit 1; }

# 7.3 Deletion is BLOCKED unless every guard above passed
[ -s "$ARCH/SHA256SUMS" ] || { echo "empty archive — do not delete"; exit 1; }
grep -q "PRODUCTION UNTOUCHED" "$ROOT/private/baseline.diff" || { echo "production integrity unverified — do not delete"; exit 1; }
rm -rf "$ROOT"
```

## 8. Cleanup order (P1-6)

Quiesce first, drain second, stop processes last:

```bash
# 8.1 Quiesce: stop issuing requests (client side)
# 8.2 Cancel/drain the run and wait for workers to reach terminal state
cd "$ROOT/workspace"
alix coordination cancel <run-id> || true
TERMINAL=0
for i in $(seq 1 30); do
  if alix coordination status <run-id> | grep -qi 'terminal\|cancelled'; then TERMINAL=1; break; fi
  sleep 2
done
[ "$TERMINAL" -eq 1 ] || { echo "RUN NOT TERMINAL after drain window — do not stop processes or delete"; exit 1; }

# 8.3 Stop the Inspector, then the proxy
kill "$(cat "$ROOT/private/inspector.pid")" 2>/dev/null || true
kill "$(cat "$ROOT/private/proxy.pid")"     2>/dev/null || true

# 8.4 Production-state guard (content + metadata + created/deleted).
#     FAIL CLOSED: an uncollectable "after" snapshot blocks everything downstream.
snapshot > "$ROOT/private/baseline-after.txt" || { echo "AFTER SNAPSHOT FAILED — do not delete"; exit 1; }
[ -s "$ROOT/private/baseline-after.txt" ] || { echo "empty after-snapshot — do not delete"; exit 1; }
if diff -u "$BASELINE_BEFORE" "$ROOT/private/baseline-after.txt" > "$ROOT/private/baseline.diff" ; then
  echo "PRODUCTION UNTOUCHED" | tee "$ROOT/private/baseline.diff"
else
  echo "PRODUCTION STATE CHANGED — STOP, INVESTIGATE (see private/baseline.diff)"
fi

# 8.5 Finalize (archive + verify + delete) per §7
```

## 9. Safety

- No destructive testing against production credentials or live workloads.
- No secret in argv; `private/` is 0700 and outside the evidence tree.
- Production-mode proxy strips client forwarded headers; only the explicit
  negative-test proxy presents a malformed one.
- Any failing row stops the run: file the defect, re-enter review, re-run the
  affected rows only after a fix is merged.

## 10. Open items (settled in qualification, not assumed)

1. The fixture goal that reliably yields a blocking capability-gated worker.
2. The run host mode (`--daemon` vs foreground).
3. Ports `4139`/`4143` free on the acceptance host.
4. The archive destination and manifest signer.
5. Whether the F-4 overlap band needs the deferred narrow test witness, or the
   observational treatment plus the two deterministic orders suffice.

## 11. Explicitly out of scope

- Fixture setup/startup, the coordination run, the acceptance matrix; triggering
  any remote approval decision; marking `SRAP-G3-ACCEPT` complete.
- Any change to G3 runtime behaviour, approval authority, ledger, or execution.
