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
| Untrusted-peer row | **NOT EXERCISED** — loopback is not proof of untrusted-peer rejection | fixture §2 |
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
| Forwarding canonicalization | spoofed `X-Forwarded-*` / `X-Real-IP` / `Via` / `Forwarded` stripped; exactly one `X-Forwarded-Proto: https`; `host` rewritten to the upstream |
| Upstream unavailable | 502 |
| Negative proxy | refuses port 4143 (exit 1); forwards malformed `https,http`; auto-shuts down after its TTL |

Bootstrap commit: branch `srap/d3-fixture-bootstrap` (PR #971) — commit
`95821fe4` plus the typecheck fix `2d7582a1`.
