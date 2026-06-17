# Skipped Tests Taxonomy

> Last updated: 2026-06-17
> Part of P4.1a — Skipped-Test Elimination

**Target:** 0 unexplained skipped tests. Every skip must have a documented reason and classification.

## Summary

| Classification | Count | Files |
|---|---|---|
| External-service-dependent | 8 | `tests/providers.test.ts`, `tests/cli-discover.test.ts`, `tests/repomap/embedding-cache.test.ts` |
| Manual / TTY-only | 5 | `tests/manual/run-cli.ts`, `tests/manual/suite-a-cli.test.ts`, `tests/manual/suite-b-plan.test.ts` |
| Correctly env-gated | 2 | `tests/pty/tui-pty.test.ts`, `tests/soak/daemon-protocol-soak.test.ts` |
| Correctly gated (integration) | 2 | `tests/agent-loop.test.ts`, `tests/run-flow.test.ts` |
| Feature-not-implemented | 6 | `tests/providers.test.ts` (Ollama tool-call parsing) |

**Total skipped: 23** (across tests + manual exports + describe blocks)

---

## 1. Feature-Not-Implemented

These tests validate functionality the codebase does not yet implement. They serve as specification placeholders for future work.

### Ollama tool call parsing — 6 tests

**File:** `tests/providers.test.ts` (lines 54–303)
**Skip reason:** `"requires Ollama tool call parsing feature (ollama-spec.ts returns toolCalls: [])"`
**Classification:** Feature-not-implemented

The `ollama-spec.ts` provider spec hardcodes `toolCalls: []` in its `fromResponse` handler. These tests were written as specification tests for a future Ollama tool-call parsing layer. The test bodies mock `_setFetchForTesting` and verify correct tool call extraction from various response formats (native tool_calls, JSON-in-text fallback, fenced JSON, prose-embedded JSON, unquoted names, Python-style None).

**To enable:** Implement tool call parsing in `src/providers/specs/ollama-spec.ts` or in a middleware layer, then remove the skip flag from these tests.

---

## 2. External-Service-Dependent

These tests require an external service running and are correctly gated behind a runtime probe.

### uvx-based MCP discovery — 2 tests

**File:** `tests/cli-discover.test.ts` (lines 19, 51)
**Skip reason:** `{ skip: !hasUvx() }` — runtime probe for `uvx` CLI availability
**Classification:** External-tool-dependent

`hasUvx()` probes `uvx --version` before each test run. The tests require the `uvx` package manager to be installed and available on `$PATH`.

**To enable:** Install `uv` toolchain (`pip install uv` or `npm install -g uvx`).

### Embedding cache — 1 describe block

**File:** `tests/repomap/embedding-cache.test.ts` (line 21)
**Skip reason:** `{ skip: !hasNetwork }` — runtime network probe
**Classification:** Network-dependent

`hasNetwork()` probes whether HuggingFace model endpoints are reachable. These tests download embedding models and fail silently without network.

**To enable:** Ensure internet access and HuggingFace model endpoints are reachable.

---

## 3. Manual / TTY-Only

These tests require interactive terminal input or a running real model API and live in `tests/manual/`.

### run-cli helpers — 3 exports

**File:** `tests/manual/run-cli.ts` (lines 131, 145, 150)
**Skip reasons:**
- `needsModel`: `{ skip: "requires model API key" }` — probes `resolveApiKey()`
- `needsTty`: `{ skip: "requires interactive TTY" }` — always skipped
- `needsBrave`: `{ skip: "requires BRAVE_API_KEY env var" }` — probes `process.env.BRAVE_API_KEY`

**Classification:** Manual-test-helper — these are not individual skipped tests but exportable skip option objects used by other manual tests.

### CLI suite A — 2 tests

**File:** `tests/manual/suite-a-cli.test.ts` (lines 72, 84)
**Skip reasons:**
- A.6: `{ skip: "requires interactive TTY" }` — plan detail view with terminal interaction
- A.8: `{ skip: "requires interactive prompts" }` — scope expansion denial flow

**Classification:** Manual-test

### Plan suite B — 1 test

**File:** `tests/manual/suite-b-plan.test.ts` (line 24)
**Skip reason:** `{ skip: "requires interactive TTY for plan phase" }`
**Classification:** Manual-test

---

## 4. Correctly Env-Gated

These tests run only when a specific environment variable is set.

### PTY tests — 1 describe block

**File:** `tests/pty/tui-pty.test.ts` (line 52)
**Gate:** `{ skip: !ENABLED }` where `ENABLED = process.env.ALIX_PTY_TESTS === "1"`
**Classification:** Platform-specific

PTY tests spawn pseudo-terminals and require a real TTY device. They are incompatible with headless CI.

**To enable:** `ALIX_PTY_TESTS=1 npx node --test dist/tests/pty/`

### Soak tests — 2 files

**Files:**
- `tests/soak/daemon-protocol-soak.test.ts`
- `tests/soak/corruption-recovery.test.ts`
- `tests/soak/memory-growth.test.ts`
- `tests/soak/store-load.test.ts`

**Gate:** All gated by `ALIX_SOAK_TESTS=1` environment variable.
**Classification:** Soak-test

Soak tests are long-running (minutes to hours) and excluded from CI.

**To enable:** `ALIX_SOAK_TESTS=1 npx node --test dist/tests/soak/`

---

## 5. Correctly Gated Integration Tests

These tests call a real model API and require available credits.

### agent-loop.test.ts — 1 test

**File:** `tests/agent-loop.test.ts` (line 13)
**Skip reason:** `{ skip: "integration test: requires model API credits" }`
**Classification:** Integration-test

Calls `runTask()` which invokes a real model. Skipped when no API key/providers are configured.

### run-flow.test.ts — 1 test

**File:** `tests/run-flow.test.ts` (line 10)
**Skip reason:** `{ skip: "integration test: requires model API credits" }`
**Classification:** Integration-test

Same dependency on real model API.

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-17 | Initial taxonomy — documented all 23 skipped items |
| 2026-06-17 | Updated 6 Ollama skips from `{ skip: true }` (no reason) to documented reason |
