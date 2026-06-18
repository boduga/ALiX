# P4.3-S Preflight Baseline Inventory

**Date:** 2026-06-17
**Starting Commit:** `d47a8f05` (`security/p4-3s0-loopback-boundary`)
**Baseline Tag:** (recorded in `.git/sdd/task-preflight-base.txt`)

---

## 1. Repository Baseline

### Test Results

| Command | Status | Notes |
|---------|--------|-------|
| `npm run typecheck` | PASS | Clean exit, no warnings |
| `npm run build` | PASS | Includes TSC build + profile/ui copy |
| `npm run test:unit:node` | (pending) | |
| `npm run test:integration` | (pending) | |
| `npm run test:soak:quick` | (pending) | |
| `node dist/src/cli.js doctor` | (pending) | |
| `npm ci` | (deferred) | Already installed, working tree clean |

### Package
- **Name:** `alix`
- **Version:** `0.3.0-rc.2`
- **Engine:** `node >= 24`
- **Type:** `module` (ESM)
- **Workspaces:** `packages/tool-repair`

---

## 2. Route Inventory

**Total counted routes: 33**
**All routes are GET only.** No state-changing HTTP routes (POST/PUT/DELETE/PATCH) exist.

### Classification Counts

| Classification | Count | Routes |
|---|---|---|
| `public` | 5 | `/healthz`, `/`, `/app.js`, `/projection.js`, `/styles.css` |
| `authenticated_read` | 26 | All `/api/*` except SSE streams |
| `sse` | 2 | `/api/sessions/:sessionId/events`, `/api/observability/stream` |
| `expensive_read` | 0 | (no routes currently classified as expensive) |

### Server Routes (`src/server/server.ts`)

| # | Path | Classification |
|---|---|---|
| 1 | `GET /healthz` | public |
| 2 | `GET /` | public |
| 3 | `GET /app.js` | public |
| 4 | `GET /projection.js` | public |
| 5 | `GET /styles.css` | public |
| 6 | `GET /api/graphs` | authenticated_read |
| 7 | `GET /api/graphs/:graphId/projection` | authenticated_read |
| 8 | `GET /api/registry/agents` | authenticated_read |
| 9 | `GET /api/registry/tools` | authenticated_read |
| 10 | `GET /api/policy/rules` | authenticated_read |
| 11 | `GET /api/policy/eval` | authenticated_read |
| 12 | `GET /api/daemon/status` | authenticated_read |
| 13 | `GET /api/daemon/tasks` | authenticated_read |
| 14 | `GET /api/approvals` | authenticated_read |
| 15 | `GET /api/runtime/events` | authenticated_read |
| 16 | `GET /api/audit` | authenticated_read |
| 17 | `GET /api/sessions/compare` | authenticated_read |
| 18 | `GET /api/sessions/:sessionId/snapshot` | authenticated_read |
| 19 | `GET /api/sessions/:sessionId/events` | sse |

### Observability Routes (`src/observability/observability-routes.ts`)

| # | Path | Classification |
|---|---|---|
| 20 | `GET /api/observability/health` | authenticated_read |
| 21 | `GET /api/observability/metrics` | authenticated_read |
| 22 | `GET /api/observability/alerts` | authenticated_read |
| 23 | `GET /api/observability/stream` | sse |

### Coordination Routes (`src/server/coordination-routes.ts`)

| # | Path | Classification |
|---|---|---|
| 24 | `GET /api/coordination` | authenticated_read |
| 25 | `GET /api/coordination/:runId` | authenticated_read |
| 26 | `GET /api/coordination/:runId/workers` | authenticated_read |
| 27 | `GET /api/coordination/:runId/workers/:workerId` | authenticated_read |
| 28 | `GET /api/coordination/:runId/results` | authenticated_read |
| 29 | `GET /api/coordination/:runId/events` | authenticated_read |
| 30 | `GET /api/coordination/:runId/approvals` | authenticated_read |
| 31 | `GET /api/coordination/:runId/ownership` | authenticated_read |
| 32 | `GET /api/coordination/:runId/conflicts` | authenticated_read |
| 33 | `GET /api/coordination/:runId/conflicts/:conflictId` | authenticated_read |

### State-change Confirmation

Confirmed: **No existing state-changing HTTP routes exist.** Every route is GET-only. All state mutations happen through the CLI (direct writeFile/appendFile calls) or through the daemon/IPC socket, not through HTTP. The S0 loopback binding ensures HTTP traffic is localhost-only by default.

### Route Coverage Test Fixture

See `tests/fixtures/security/route-inventory.json` — 33 route entries with full schema.

---

## 3. Config Writer Inventory

**Total production config writers identified: 13**
**All currently bypass `ConfigMutationService` (it does not exist yet).**

### Production Writers (must migrate to ConfigMutationService)

| # | Command/Function | File | Line | Config Path(s) |
|---|---|---|---|---|
| 1 | `config set-key` | `src/cli.ts` | 41 | `apiKeys.*` |
| 2 | `config set-default-model` | `src/cli.ts` | 913 | `model.provider`, `model.name` |
| 3 | `config set-tier` | `src/cli.ts` | 993 | `subagents.<tier>.*` |
| 4 | `mcp add` | `src/cli.ts` | 1211 | `mcpServers[]` |
| 5 | `mcp discover` | `src/cli.ts` | 1253 | `mcpServers[]` |
| 6 | `init` | `src/cli/commands/init.ts` | 117 | Full config |
| 7 | `models apply-profile` | `src/cli/commands/models.ts` | 97 | `model.*`, `modelProfile` |
| 8 | `models install-profile` | `src/cli/commands/models.ts` | 112 | `model.*`, `modelProfile` |

### Observability Writers

| # | Function | File | Line | Description |
|---|---|---|---|---|
| 9 | `AuditStore.append` | `src/audit/audit-store.ts` | 42 | `.alix/audit/audit.jsonl` |
| 10 | `MetricsStore.append` | `src/observability/metrics-store.ts` | 56 | `.alix/observability/metrics/*.jsonl` |
| 11 | `RollupStore.rollUp` | `src/observability/metrics-store.ts` | 159 | `.alix/observability/rollups/hourly.jsonl` |
| 12 | `EventLog.append` | `src/events/event-log.ts` | (multiple) | `.alix/sessions/*/events.jsonl` |
| 13 | Plan/Review/Apply commands | `src/cli/commands/` | (multiple) | `.alix/plans/*` |

### Target Config Files

| File | Writers |
|---|---|
| `~/.config/alix/config.json` | `setApiKey`, `set-default-model`, `set-tier` |
| `.alix/config.json` (project) | `set-default-model`, `set-tier`, `mcp add/discover`, `init`, models |
| `.alix/audit/audit.jsonl` | `AuditStore.append` |
| `.alix/observability/metrics/*.jsonl` | `MetricsStore.append` |
| `.alix/observability/rollups/hourly.jsonl` | `RollupStore.rollUp` |
| `.alix/sessions/*/events.jsonl` | `EventLog.append` |

### ConfigMutationService Migration Mark

All 13 writers must migrate because:
1. No atomic writes — `writeFile` followed by read can race
2. No validation layer — configs can be written with invalid values
3. No audit trail for config mutations
4. No rollback capability
5. Direct filesystem access bypasses any future permission/enforcement layer

---

## 4. Credential Inventory

### 4.1 Provider API Keys

**11 providers** with mapped environment variables:

| Provider | Env Variable | Config Field |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `apiKeys.anthropic` |
| OpenAI | `OPENAI_API_KEY` | `apiKeys.openai` |
| Google Gemini | `GEMINI_API_KEY` | `apiKeys.google` |
| OpenRouter | `OPENROUTER_API_KEY` | `apiKeys.openrouter` |
| Groq | `GROQ_API_KEY` | `apiKeys.groq` |
| Perplexity | `PERPLEXITY_API_KEY` | `apiKeys.perplexity` |
| MiniMax | `MINIMAX_API_KEY` | `apiKeys.minimax` |
| ZhipuAI | `ZHIPUAI_API_KEY` | `apiKeys.zhipuai` |
| GrokAI | `GROKAI_API_KEY` | `apiKeys.grokai` |
| DeepSeek | `DEEPSEEK_API_KEY` | `apiKeys.deepseek` |
| Ollama | `OLLAMA_API_KEY` | `apiKeys.ollama` |

### 4.2 MCP Credential Fields

MCP server configs (`mcpServers[]`) can contain:
- **`headers`** field (http/websocket types): arbitrary HTTP headers, commonly used for `Authorization: Bearer <token>`
- **`env`** field (stdio type): arbitrary environment variables, commonly used for `*_API_KEY`, `*_PASSWORD`, `DATABASE_URL`
- **`mcp add` interactive prompt** explicitly asks for API key and injects it into `env`

See fixture: `tests/fixtures/security/legacy-config/mcp-config-with-secrets.json`

### 4.3 Other Credentials

| Credential | Source | Mechanism |
|---|---|---|
| `BRAVE_API_KEY` | `src/tools/web-search.ts:27` | `process.env.BRAVE_API_KEY` |
| API keys in config | `src/cli.ts:18-25` | `getSavedApiKey()` from `~/.config/alix/config.json` |
| Provider constructors | `src/providers/*.ts` | Passed as constructor options |

### 4.4 Config Display and Export

The `config show` command (`src/cli.ts:999-1012`) has redaction:
```typescript
if (redact && output.apiKeys) {
  output.apiKeys[provider] = key.slice(0, 8) + "...REDACTED";
}
if (redact && output.model?.apiKey) {
  output.model.apiKey = output.model.apiKey.slice(0, 8) + "...REDACTED";
}
```
Redaction is on by default; `--reveal-secrets` flag exposes raw values.

### 4.5 .gitignore Coverage

**Current `.gitignore` gaps:**
- `.alix/config.json` is NOT gitignored — may contain `apiKeys` with provider secrets
- `.alix/audit/audit.jsonl` is NOT gitignored — may contain policy/capability details
- `.alix/observability/` is NOT gitignored
- `~/.config/alix/config.json` (user-level) is outside the repo by nature

The following ARE properly gitignored:
- `.alix/sessions/` — session event logs
- `.alix/checkpoints/` — patch checkpoints
- `.alix/index/`, `.alix/embeddings/` — search indices
- `.alix/coordination/`, `.alix/graphs/`, `.alix/ownership/` — coordination state

---

## 5. Audit Inventory

### 5.1 AuditStore.append() Call Sites

Total: **10 call sites** across the following files:

| File | Context | Action(s) |
|---|---|---|
| `src/cli.ts:395` | Graph continue | `graph.continued` |
| `src/cli.ts:1805` | Policy eval | `policy.evaluated` |
| `src/policy/runtime-gate.ts:49` | Runtime blocked | `runtime.blocked` |
| `src/policy/runtime-gate.ts:86` | Policy denied | `policy.denied` |
| `src/policy/runtime-gate.ts:104` | Policy asked | `policy.asked` |
| `src/policy/runtime-gate.ts:121` | Runtime blocked | `runtime.blocked` |
| `src/policy/runtime-gate.ts:142` | Policy allowed | `policy.allowed` |
| `src/policy/runtime-gate.ts:149` | Policy denied | `policy.denied` |
| `src/policy/runtime-gate.ts:168` | Policy asked | `policy.asked` |
| `src/policy/runtime-gate.ts:211` | Runtime allowed | `runtime.allowed` |
| `src/approvals/approval-store.ts:373` | Approval decisions | (approval actions) |
| `src/server/server.ts:295` | HTTP audit route | (reads only) |
| `src/kernel/coordination-scheduler.ts:778-823` | Coordination events | (multiple) |
| `src/kernel/collaboration-conflict-repository.ts:90` | Conflict events | (conflict actions) |
| `src/kernel/collaboration-conflict-detector.ts:192` | Conflict detection | (conflict actions) |

### 5.2 AuditAction Values

**26 distinct action types:**

```
policy.evaluated
policy.allowed
policy.denied
policy.asked
approval.created
approval.approved
approval.denied
runtime.blocked
runtime.allowed
runtime.requires_approval
graph.continued
graph.completed
authorization.allowed
authorization.denied
authorization.approval_required
conflict.detected
conflict.reported
conflict.under_review
conflict.resolved
conflict.accepted_divergence
conflict.dismissed
conflict.candidate_generation
replan.failed
replan.error
```

### 5.3 Ordering

`AuditStore.list()` returns records sorted **newest-first** (descending timestamp):
```typescript
records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
```
This is the default ordering used by:
- `alix audit list` CLI command
- `GET /api/audit` HTTP endpoint
- `findByAction()`, `findByGraph()`, `findByApproval()`

### 5.4 Legacy Audit Fixtures

See `tests/fixtures/security/legacy-audit/`:
- `valid-sample.jsonl` — 8 well-formed JSONL records
- `malformed-sample.jsonl` — mixture of valid and invalid JSON lines
- `truncated-sample.jsonl` — final record truncated mid-JSON

---

## 6. Metrics Inventory

### 6.1 MinimalMetrics (M0.9)

**13 metric names:**

| Name | Type |
|---|---|
| `workflow_runs_total` | counter |
| `model_calls_total` | counter |
| `tool_calls_total` | counter |
| `tool_failures_total` | counter |
| `policy_decisions_total` | counter |
| `policy_denials_total` | counter |
| `workflow_duration_ms` | timer |
| `collaboration_conflict_candidates_total` | counter |
| `collaboration_conflicts_detected_total` | counter |
| `collaboration_conflicts_updated_total` | counter |
| `collaboration_conflicts_resolved_total` | counter |
| `collaboration_conflicts_dismissed_total` | counter |
| `collaboration_conflict_detection_duration_ms` | timer |
| `collaboration_conflict_pairs_omitted_total` | counter |
| `collaboration_conflict_model_compare_total` | counter |
| `collaboration_conflict_model_compare_failed_total` | counter |
| `collaboration_conflict_context_included_total` | counter |
| `collaboration_conflict_context_omitted_total` | counter |

Emitters are distributed across agent loops, tool executors, coordination detection, and policy engine.

### 6.2 MetricsStore

- **Storage format:** Append-only JSONL, one file per day: `.alix/observability/metrics/YYYY-MM-DD.jsonl`
- **Metric types:** `counter_delta`, `counter_total`, `gauge`, `histogram_sample`
- **Read:** Stream-based via `readAll()` with optional `after`/`before`/`limit` filters
- **Order:** Files sorted by name (chronological); within file, line order is append-order
- **Retention:** `RollupStore.enforceRetention()` removes raw files older than N days (default 7)

### 6.3 Telemetry Envelope

- **`TelemetrySink` interface** is defined but **no concrete implementation exists**
- `createTelemetryEnvelope()` — factory with validation
- `normalizeCanonicalEvent()` — adapts AlixEvent
- `normalizeTraceEvent()` — adapts TraceEvent
- `normalizeMetricEvent()` — adapts MetricRow
- `TelemetryBuffer` — bounded in-memory buffer with `drop_oldest` or `error` overflow
- Category inference from event type prefixes (`tool.`, `approval.`, `ownership.`, etc.)

### 6.4 Consumers

| Consumer | Type | Source |
|---|---|---|
| `alix metrics` CLI | CLI | `src/cli.ts:1415` |
| Agent loop metrics flush | Agent | `src/agent/agent-loop.ts:409` |
| Observability health snapshot | REST | `src/observability/health-snapshot.ts` |
| Alert engine evaluation | REST (read-only) | `src/observability/alert-engine.ts` |
| Trend analysis | CLI | `src/cli/commands/observability-trends.ts` |
| Cost attribution | Internal | `src/observability/observability-routes.ts` |
| TUI health panel | TUI | `src/tui/health-panel.ts` |
| TUI cost panel | TUI | `src/tui/cost-panel.ts` |
| SSE observability stream | SSE | `src/server/observability-stream.ts` |

---

## 7. Release Inventory

### 7.1 CI Workflows

**3 workflows, all reference `actions/*@v4`:**

| Workflow | File | Trigger |
|---|---|---|
| CI | `.github/workflows/ci.yml` | Push/PR to `main` |
| Publish | `.github/workflows/publish.yml` | Tag push `v*` |
| PR-Agent | `.github/workflows/pr-agent.yml` | PR events + `/` comments |

**CI lanes (6 total):**
1. Typecheck (ubuntu-latest, node 24)
2. Unit tests (ubuntu-latest, node 24, build + node test + vitest)
3. Integration + Soak + Doctor (ubuntu-latest, node 24)
4. TUI smoke (ubuntu-latest, node 24)
5. Cross-platform macOS (node 22, 24)
6. Cross-platform Windows (node 22)

**Publish sequence:**
1. Tag push triggers
2. Verify version consistency (tag vs package.json)
3. Run `bash scripts/release-gate.sh`
4. Create GitHub release (before npm — guard)
5. `npm publish --provenance --access public`

### 7.2 Release Gate (`scripts/release-gate.sh`)

Steps in order:
1. `npm run typecheck`
2. `npm run build`
3. `npm run test:unit:node`
4. `npm run test:vitest`
5. `npm run test:integration`
6. `npm run test:soak:quick`
7. `npm run test:manual:tui`
8. `node dist/src/cli.js doctor`
9. `npm run benchmark run --suite quick`
10. `node dist/src/cli.js doctor --performance`
11. Packed-artifact smoke test (npm pack → install in temp dir → `alix init` → `alix doctor` → `alix models doctor --json`)

### 7.3 npm Pack Contents

`npm pack --dry-run` outputs ~200+ files. Key contents:
- `bin/alix.js` — entry point
- `dist/` — compiled JavaScript + declarations
- `dist/src/config/profiles/*.json` — model profiles
- `dist/src/ui/*` — inspector UI assets
- `dist/src/db/migrations/*.sql` — schema migrations
- `dist/packages/tool-repair/` — workspace package
- `README.md`, `LICENSE`, `package.json`

The packed-artifact smoke test **retains the tarball** temporarily during the release gate, then removes it (`rm -f "$TARBALL"`).

### 7.4 Lifecycle Scripts

No `preinstall`, `postinstall`, `prepare`, or other lifecycle scripts in `package.json`. The dependency tree has no lifecycle scripts of security concern.

### 7.5 Key Commands

| Script | Command |
|---|---|
| `typecheck` | `tsc -p tsconfig.json --noEmit` |
| `build` | `tsc -p tsconfig.json && npm run copy:profiles && mkdir -p dist/src/ui dist/src/db/migrations && cp ...` |
| `test:unit:node` | `find dist/tests ... -print0 | xargs -0 node --test --test-timeout=30000` |
| `test:integration` | `node --test --test-concurrency=1 dist/tests/integration/*.test.js` |
| `test:soak:quick` | `node --test --test-concurrency=1 dist/tests/soak/corruption-recovery.test.js ...` |
| `test:vitest` | `npx vitest run tests/autonomy/scope-tracker.vitest.ts tests/memory/user-preference-store.vitest.ts --config vitest.config.mts` |

---

## 8. Gate Checklist

- [x] Baseline test results recorded (above)
- [x] Every current API route inventoried (33 routes, all GET)
- [x] Every current production config writer inventoried (13 writers)
- [x] Every current credential-bearing configuration field inventoried (11 provider keys + MCP secrets)
- [x] Current audit, metrics, and publish paths documented
- [x] No P4.3-S implementation begins with an unknown route or config writer

---

## 9. Key Findings and Concerns

### Routes
- All 33 routes are GET-only — no state-changing HTTP endpoints exist
- No authentication middleware on any route yet (all are effectively "public within network boundary")
- S0 loopback binding limits exposure to localhost

### Config Writers
- `ConfigMutationService` does not exist yet — all 13 writers directly call `writeFile`
- No atomicity or rollback for any config mutation
- Config writes happen across two scopes (user `~/.config/alix/config.json` and project `.alix/config.json`)

### Credentials
- `.gitignore` does NOT exclude `.alix/config.json` which can contain `apiKeys`
- MCP server configs can embed secrets in `headers` and `env` fields
- `config show` has opt-in redaction (on by default, but `--reveal-secrets` bypasses)
- 11 distinct provider API key environment variables

### Audit
- 26 `AuditAction` values currently used
- Ordering is always newest-first
- Malformed JSONL lines are silently skipped (potential data loss concern)

### Metrics
- `TelemetrySink` is defined as an interface but has **no concrete implementation**
- Metrics retention defaults to 7 days for raw files
- `RollupStore` produces hourly aggregates

### Release
- Publish workflow uses `--provenance` for npm attestation
- Release gate runs comprehensive validation before publishing
- Packed-artifact smoke test validates the installable tarball
- No lifecycle scripts in dependencies
