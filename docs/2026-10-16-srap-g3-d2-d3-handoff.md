# SRAP-G3-ACCEPT — D2 → D3 gate handoff and frozen inputs

**Date:** 2026-10-16
**Milestone:** `SRAP-G3-ACCEPT`
**Companions:** `docs/2026-10-16-srap-g3-acceptance-fixture.md` (rev 2.3),
`docs/2026-10-15-srap-g3-acceptance-plan.md` (rev 2 + F-4 amendment),
`docs/2026-10-16-srap-g3-d1-report.md`

This record advances the `SRAP-G3-ACCEPT` gate series and **freezes the D3
inputs** so D3 integrated acceptance can run against fixed values instead of the
unresolved qualification placeholders in the fixture design.

## 1. Gate advance

| Gate | State | Basis |
| --- | --- | --- |
| D0 — design | approved / merged | PRs #964, #965 |
| D1 — isolated setup | **PASSED, D1-F1 CLOSED** | PRs #966, #967; `docs/2026-10-16-srap-g3-d1-report.md`; verdict `hybrid-allowlist-v1` |
| D2 — qualification | **complete** | Operator decision 2026-10-16: satisfied by the merged operational qualification — PR #969 (`86855978 fix(srap): daemon observes cross-process approval without restart`; `86855978 test(srap): pin D2 freshness review verifications`). Durable evidence: `tests/kernel/coordination-approval-binding.test.ts` + the merge commit. |
| D3 — integrated acceptance | **authorized — in progress** | Operator authorization 2026-10-16 |
| D4 — closure | **not authorized** | — |

**Operator decision (2026-10-16).** The D2 gate is recorded complete on the
merged **operational** qualification (PR #969), not on a separate
fixture-qualification run. The fixture design's D2 procedure (enroll throwaway
operator, seed the isolated HMAC key, start loopback services, run/cancel a
blocked throwaway run) is therefore **folded into the D3 environment bootstrap**
rather than executed as its own gated milestone.

**Naming caveat.** The fixture design's gate table (§1) names D2 *fixture
qualification*; the operator's gate table names it *operational qualification*.
This record treats PR #969 as the D2 evidence and keeps the fixture design's D2
procedure as the D3 bootstrap step that produces the frozen inputs below.

## 2. Frozen D3 inputs

All values below are verified against the checked-out integrated commit
`559578c9` unless marked *pin at D3 bootstrap*.

| Input | Frozen value | Source |
| --- | --- | --- |
| Pinned commit | `559578c9b0243782d315b683bb8aecb245f56255` (integrated `main`) | git |
| Fixture root | `/tmp/opencode/alix-srap-accept/<UTC-ts>-<pid>` | fixture §4.1 |
| Isolated env | `HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `TMPDIR` under `$ROOT`; cwd `$ROOT/workspace` | fixture §4 |
| Project config | `$ROOT/workspace/.alix/config.json` overrides user config | fixture §3 (`operations/config/loader.ts`) |
| User config dir | `$HOME/.config/alix` (isolate via `HOME`; not XDG-derived) | fixture §3 |
| Platform state | `$XDG_STATE_HOME/alix-inspector` | fixture §3 (`platform/user-state-paths.ts`) |
| **Terminal run states** | `completed` \| `failed` \| `cancelled`; `blocked` and `awaiting_approval` are **not** terminal | `src/coordination/kernel/task-graph.ts:8` (**frozen**) |
| Worker blocked signal | `worker.status === "blocked"` ∧ `worker.blockReason === "approval_required"` ∧ non-empty `worker.approvalId` | `src/interfaces/cli/commands/coordination.ts` `handleStatus` |
| Status (human) | `alix coordination status <run-id>` → `Run:`, `Status:`, `Goal:`, `Workers:`, `Awaiting approval: <approvalId>` | `src/interfaces/cli/commands/coordination.ts` `handleStatus` |
| Status (machine) | `alix coordination results <run-id> --json` → `{ runId, rootGoal, status, outcome, complete, counts:{workers,completed,failed,blocked,successfulResults,failedResults,missingResults}, timing }` | `src/interfaces/cli/commands/coordination.ts` `handleResults`/`printResultSummary` |
| Remote decision route | `POST /api/approvals/:id/decision` | `src/interfaces/server/remote-decision-route.ts:2,57` |
| Route master switch | `ui.security.remoteDecisions.enabled` (default `false`) | `src/interfaces/server/server.ts:633`; `src/operations/config/schema.ts:323` |
| UI security schema | `{ remoteAccess, allowedHosts, allowedOrigins, trustedProxyCidrs, requireTlsForRemote, remoteDecisions? }` all under `ui.security` | `src/operations/config/schema.ts:313-323` |
| Run command | `alix coordination run "<goal>" --session-mode=ask --max-concurrency=1 [--daemon]` | `src/interfaces/cli/commands/coordination.ts` |
| Key-seed backend | `plain-file`, resolved store path proven inside `$ROOT/state/alix-inspector` | fixture §5.4 |
| Host mode | **foreground** (default) — retrievability-while-blocked established in D3; `--daemon` only if required | fixture §6.3 |
| Untrusted-peer row | **NOT EXERCISED at D3 bootstrap time** — loopback is not proof of untrusted-peer rejection; later **EXERCISED and DENIED** in §4.9 (source outside `127.0.0.1/32`) | fixture §2 |
| Provider for the coordination fixture | **Pinned at D3 bootstrap:** `local-llama` → the fixture mock model server (`fixture-mock-model`, keyless, OpenAI-compatible on `127.0.0.1:8080`), which emits one deterministic tool call (`alix_file_create`) and answers the `ensureLlamaServer` `/v1/models` probe so llama.cpp is never spawned. Rationale: must emit exactly one approval-gated tool call deterministically and offline. Rejected: `scripted-mock` (`src/operations/evals/providers/scripted-mock-provider.ts`) is eval-scoped; `mock` (`src/models/providers/mock-provider.ts`) emits no tool calls and cannot reach an approval gate. | source |
| Fixture goal (exact prompt + tool policy) | *pin at D3 bootstrap* — must force exactly one capability-gated worker under `--session-mode=ask --max-concurrency=1` | fixture §6.2 |

**Open items carried from the fixture design §12 that remain unresolved and are
explicitly not asserted:** the malformed-header *security* verdict (the proxy and
negative proxy are authored and transport-validated during the D3 bootstrap, but
the acceptance verdict is a held matrix row), truly untrusted-peer topology
(**NOT EXERCISED**), archive destination, and reviewer/signatory.

## 3. D3 execution state

D3 is authorized. The D3 environment bootstrap (fixture root, TLS material,
config variants, operator enrollment, HMAC key seeding, loopback Inspector +
proxy, and audit-chain activation) is **complete through transport validation**
(§4.3); execution of the acceptance matrix rows has **not started**. Evidence is
collected under `$ROOT/runs/<ts>/` and summarized into
`$RUN_DIR/manifest/manifest.md` with a final **PASS / FAIL / INCOMPLETE** verdict.
No row is marked passing without independently reviewable evidence; the
untrusted-peer row is reported **NOT EXERCISED**.

## 4. Credential sourcing decision (2026-10-16)

The OS keychain is shared at OS-user granularity, so `HOME`/`XDG_STATE_HOME`
overrides do **not** isolate credential access. The fixture therefore keeps its
own `plain-file` backend and every credential value stays inside
`$SRAP_ACCEPT_ROOT` (fixture §5.5). Three graded modes:

| Mode | Credential source | Authorized use |
| --- | --- | --- |
| Deterministic acceptance | Fixture-generated credentials + the offline scripted model (`local-llama` → `fixture-mock-model`, keyless) | D3 execution (default) |
| Real-provider integration | Dedicated, restricted test key seeded into the isolated fixture store | separately authorized only |
| Live production keychain | shared OS-user keychain | **not authorized** |

Seeding utility: `scripts/srap-accept/seed-provider-key.mjs` — the secret arrives
on stdin or a protected file descriptor only (never argv); it refuses the
`srap-evidence` namespace and argv-supplied secrets, proves read-back, prints
only non-secret metadata, and proves the store resolves inside the fixture with
the backend exactly `plain-file`.

**Authorized now:** continue designing and validating the isolated
credential-seeding procedure. **Not authorized:** reading or copying live
production keychain secrets, switching the fixture to the shared keychain, or
initiating real-provider calls under the existing D2 authorization.

### 4.1 Attempted alternative — recorded and reverted

Before the decision above, an alternative "zero-copy keychain read-through" path
was attempted under an earlier instruction and then reverted. For the record:

- the fixture backend was briefly switched to `keychain`, and all 16 real
  provider keys were **read** from the live OS keychain (production *reads*);
- the real `apiKeys` block (including the literal `intern` value) was briefly
  copied into the fixture user config;
- real-provider calls were made (OpenRouter → HTTP 402 insufficient credits;
  DeepSeek, OpenAI, MiniMax responded).

Reverted to the frozen state: backend restored to `plain-file`, the copied
fixture user config and keychain-metadata mirror deleted, and the model restored
to the deterministic `local-llama`/`fixture-mock-model`. **No production writes
occurred** — the production keychain metadata is unchanged (mtime 2026-10-13, 17
provider entries, zero `srap-evidence` entries), and the transient `intern` copy
was removed.

### 4.2 Bootstrap status

- Fixture root `/tmp/opencode/alix-srap-accept/20261017T035308Z-264134`; isolated
  `HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`/`TMPDIR`; cwd `$ROOT/workspace`.
- Services: Inspector `127.0.0.1:4139`; offline scripted model `127.0.0.1:8080`
  (`fixture-mock-model`, keyless, one deterministic tool call); TLS proxy
  `127.0.0.1:4143` → Inspector (started and transport-validated, §4.3).
- The mock model server (`scripts/srap-accept/mock-model-server.mjs`) answers
  the `local-llama` grammar protocol: when the request carries the
  `agent_response` `response_format` it returns the JSON envelope
  `{"type":"tool",...}`, which `local-llama-spec.ts` parses into a tool call. It
  also supports OpenAI-style `tools`→`tool_calls[]` for any OpenAI-shaped caller.
  Verified: `getApiKey("local-llama")` → `""` and a probe returns exactly one
  `alix_file_create` tool call.
- Credentials: fixture `plain-file` store holds only `srap-evidence/hmac-key:v1`.
- Audit chain: **activated** in `$ROOT/workspace` via the supported CLI
  `alix audit activate` — genesis `audit.integrity_enabled` record (seq 1), the
  `head.json` sidecar written by the chain writer, `alix audit verify` clean, and
  re-activation idempotent (`alreadyActive`, still exactly one genesis record).
  Remote-decision projection at Inspector startup no longer refuses; a direct
  `projectRemoteDecisions` call returns `{ok:true, counters:{projected:0,...}}`.
  The sidecar was produced by the product path, never hand-edited, and no
  verification was weakened.

### 4.3 Bootstrap validation evidence (2026-10-16)

Transport/bootstrap checks only — the D3 acceptance matrix rows remain
unexecuted and the untrusted-peer row remains **NOT EXERCISED**.

| TLS-proxy check (`scripts/srap-accept/proxy.mjs`, `negative-proxy.mjs`) | Result |
| --- | --- |
| Listener binding | `127.0.0.1:4143` only, never `0.0.0.0` |
| Trust with the fixture CA (`$ROOT/tls/proxy.crt`) | `ssl_verify_result=0` for `localhost` and `127.0.0.1` |
| Trust without the CA | handshake rejected (`curl` exit 60) |
| Authentication through the proxy | `GET /api/doctor` → 401 without token / 200 with; `/healthz` → 200 |
| Forwarding canonicalization | spoofed `X-Forwarded-*` / `X-Real-IP` / `Via` / `Forwarded` stripped; exactly one canonical client hop (`X-Forwarded-For`) and one `X-Forwarded-Proto: https`; `host` rewritten to the upstream |
| Upstream unavailable | 502 |
| Negative proxy | refuses port 4143 (exit 1); forwards malformed `https,http`; auto-shuts down after its TTL |

Bootstrap PR: **#971** on branch `srap/d3-fixture-bootstrap` — **merged** to `main`
as merge commit `16abd42d` (reviewed head `ef570e97`; all 13 CI checks green).
Commits: `95821fe4`, `2d7582a1`, `d87d897b`, `e188d91a`, `4c713d70`, `62768b11`
(review fixes), `6d281c52`, `ef570e97`.

### 4.4 Independent security review (2026-10-17)

Two independent security-oriented reviews of the PR #971 fixture scripts were
performed before merge. Both found real defects; each was reproduced and fixed,
and the fixes are covered by the seeder test suite.

| Finding | Severity | Fix |
| --- | --- | --- |
| `readSecretFromFd` returned a `subarray` view and then `fill(0)`-ed the parent buffer, so every seeded secret was stored as NUL bytes while reporting `verified:true` | CRITICAL | copy the trimmed bytes out before scrubbing; read-back now compares the **stored** value against the supplied secret (`timingSafeEqual`) |
| read-back compared the stored value with a second read of itself (a tautology that could not catch the above) | HIGH | compare against the original secret |
| backend selector written before the resolved credential dir was proven contained; `LOCALAPPDATA` never validated on win32 | MEDIUM | prove containment before `writeStoredBackend`; `assertUnderRoot(LOCALAPPDATA)` |
| vitest asserted only length/absence, never the stored value, so it passed vacuously | HIGH (test) | assert the stored value equals the supplied secret |
| proxy wrote `X-Forwarded-Proto` but stripped `X-Forwarded-For`; `resolveClientAddress` then reports `fromProxy:false` and `deriveRemoteTransport` rejects a proxied decision before reading the proto | HIGH | the proxy now writes exactly one canonical `X-Forwarded-For` (observed socket peer) alongside `X-Forwarded-Proto: https` |
| negative proxy omitted `X-Forwarded-For`, so it denied at the proxy-trust gate instead of exercising the malformed-proto branch | MEDIUM | same canonical `X-Forwarded-For`, so the malformed proto is what gets evaluated |
| `--fd 0` bypassed the TTY refusal; oversize read buffered before the bound | LOW | TTY detection now inspects the resolved fd; the read stops and fails at the bound |
| mock model body read was unbounded and had no error/close handler | LOW | bound the body and resolve on error/close |

No finding allowed the fixture to fabricate an approval outcome, an audit record,
or an acceptance verdict: the mock influences model output only, and the proxies
carry transport only. The trusted-proxy CIDR is loopback, so the untrusted-peer
row remains **NOT EXERCISED**.

### 4.5 Merged-main bootstrap re-validation (2026-10-17)

After merge, `main` was synchronized and a **fresh fixture root**
(`/tmp/opencode/alix-srap-accept/20261017T065950Z-284101`) was built from the
pinned merge commit `16abd42d` (`pnpm build` → `dist/src/cli.js`). The essential
isolation, audit, and TLS bootstrap checks were repeated and **passed**:

- Isolation: cwd/`HOME`/`XDG_STATE_HOME` inside `$ROOT`; backend `plain-file`;
  production repo `.alix/` unchanged (no `.alix/audit`).
- Audit: genesis seq 1, `alix audit verify` → OK/0 findings, re-activation
  idempotent (1 genesis), startup projection no longer refuses
  (`{ok:true, counters:{projected:0,...}}`).
- Seeder on the merged build: the stored value matched the supplied secret
  exactly (the CRITICAL NUL-byte regression is fixed), then cleaned up.
- TLS: loopback-only binding; CA trust verified (`ssl_verify_result=0`) and
  rejection without CA; auth 401/200; canonical `X-Forwarded-For` +
  `X-Forwarded-Proto: https` with spoofed headers stripped; the proxied decision
  path now reaches the authorization layer (403 `workspace_scope_required`)
  rather than failing `insecure_transport`; negative proxy refuses 4143 and
  forwards the malformed proto with canonical XFF; TTL shutdown.

Evidence: `$ROOT/runs/20261017T065950Z/merged-main-bootstrap-evidence.md`.
D3 matrix **NOT STARTED**; untrusted-peer **NOT EXERCISED**; D4 **not authorized**.

### 4.6 Post-merge finding — symlinked state dir escaped the root (2026-10-17)

A post-merge review of `seed-key.mjs` found that `requiredBase` was
`realpathSync($ROOT/state/alix-inspector)`, and containment was measured against
*that* value, not against the root. A state dir symlinked to a target outside
`$SRAP_ACCEPT_ROOT` was therefore accepted, the credential store was written
outside the fixture, and the tool still reported `credentialsDirWithinRoot: true`
(reproduced). Both seeders now prove `requiredBase` **and** the resolved
credential dir are contained against `realRoot` itself, so a symlinked escape is
refused with no write. Covered by a regression test (PR #973); fixture
infrastructure only, no product change.

### 4.7 D3 execution — STOPPED on a failing row (2026-10-17)

D3 was executed on a fresh fixture pinned to merged `main` **`9f81e511`** and
**stopped at the first hard failure**, per the acceptance plan's binding
boundary (file the defect, do not patch inside the run).

- Environment re-validation on `9f81e511`: isolation, audit activation/
  integrity/idempotency, projection init, corrected seeder, and TLS — all PASS.
- Genuine coordination fixture reached: run
  `coord_937fae02-b23b-4f5d-b202-19cd7f947955`, worker blocked
  (`approval_required`), approval `approval_1792249853783_qzy6p`.
- Rows **PASS**: A-1, A-2, A-3, C-2, C-3a, D-1, D-2, D-3, D-4.
- Row **FAIL: E-3** — the projected decision record stores `principalId` and
  `credentialRef` as `[REDACTED]` while the authoritative ledger holds the real
  values. Root cause: `audit-chain-writer.ts` redaction patterns `/ip/i` and
  `/credential/i` false-positive on those benign fields, violating the audit
  DOX requirement that the projected record carry them. CI-blind (the projection
  test asserts counts only). Filed as **issue #974**.
- B-1 is blocked by E-3; E-1/E-2/E-4, F-1/F-3/F-4, G-*, H-*, A-4, B-2/B-3, C-1
  and the untrusted-peer row were **not run**. D4 not started.

`alix audit verify` stayed OK/0 findings throughout — the failure is a
field-placement/redaction defect, not chain corruption.

Evidence: `$ROOT/runs/20261017T150703Z/d3-execution-report.md`.
Re-run the affected rows only after #974 is fixed and merged.

### 4.8 D3 execution — PASS (2026-10-17)

The E-3 defect was fixed in **#976** (merge `68f4520d`): the audit chain writer no
longer redacts the non-secret evidence fields `principalId`/`credentialRef`, and
the projection boundary now enforces the `credentialRef` HMAC shape (fail-closed
on a non-conforming value). Re-run on a **fresh fixture pinned to merged `main`
`93437e6f`**:

- All executed rows **PASS**: A-1, A-2, A-3, A-4, B-1, B-2 (bearer **and**
  cookie), B-3, C-1, C-2, C-3a, D-1, D-2, D-3, D-4, E-1, E-2, E-3, E-4, F-1,
  F-2, F-3, G-1, G-2, G-3, G-4, H-1, H-2, H-3.
- **E-3** now holds: the projected decision record's `principalId`/`credentialRef`
  match the authoritative ledger; `alix audit verify` OK/0 findings.
- **G-4 / H-1**: run `coord_5d288a9f-21a0-40b8-bb74-2bc0ca777ce6`
  (`hostKind daemon`, `sessionMode ask`) resumed through the existing path after
  the remote decision — worker `blocked → running → completed`, terminal
  `completed`/`success`, `executionOwnerId daemon-312222` (no new execution
  surface), deliverable `src/srap-g4-output.txt` persisted.
- **H-2**: ON control 200; OFF 404; no side effects.
- **F-4** (disablement/decision race, T=20) and the **untrusted-peer topology**
  were completed separately — see §4.9.
- **D4 not started.**

The offline fixture mock was extended **in the fixture copy only** (planner graph,
reviewer verdict, stop-after-first-tool) to drive a keyless model through a real
approval-gated run to terminal; no product code changed.

Evidence: `$ROOT/runs/20261017T164036Z/d3-execution-report-rev2.md`.

### 4.9 F-4 race and untrusted-peer topology (2026-10-17)

**F-4 — disablement vs decision race, T = 20: PASS (20/20, 0 failures).**
Per trial: active principal → fresh approval-gated run → one barrier releasing
{`principal disable`} and {`POST decision`}; half the trials delayed dispatch past
the disable. 10 committed (all dispatched **before** the disable completed), 10
denied (all dispatched **after**, 401 `principal_disabled`); zero commits
attributed to a principal disabled before dispatch. Commit order is not a
criterion (plan amendment). Order 1 verified explicitly: disable-then-dispatch →
401, approval still `pending`, key-read count unchanged (70 → 70).

**Untrusted-peer topology — EXERCISED and DENIED** (previously NOT EXERCISED).
With `trustedProxyCidrs: ["127.0.0.1/32"]` and loopback-only listeners, a peer at
`127.0.0.2` (outside the /32) spoofing `X-Forwarded-Proto: https` +
`X-Forwarded-For: 127.0.0.1` was **403 `insecure_transport`**. Ambiguous proto
(`https,http`), missing proto, proto `http`, and no `X-Forwarded-For` all 403. The
same source could reach `/healthz` (200), so the denial is the trust check, not
connectivity. Direct to the host LAN IP → `000` (no non-loopback listener), and a
userns-isolated process cannot reach the host at all. The same approval then
succeeded (200, `transport: proxy-tls`) through the trusted TLS proxy, proving the
denials left state untouched.

Evidence: `$ROOT/runs/20261017T164036Z/d3-f4-untrusted-peer.md`.
