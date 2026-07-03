# Skipped Tests Taxonomy

> **Last updated:** 2026-06-17 (P4.1b — Ollama tool-call parsing complete)
> **Part of:** P4.1a/P4.1b — Skipped-Test Elimination and Ollama Tool-Call Parsing
> **Governance:** `pnpm test:skips:audit` validates this document against the codebase

**Target:** 0 unexplained skipped tests. Every skip must have a documented reason, classification, activation condition, and removal criteria.

## Runner Scope

The count of **4 skipped** reported by `pnpm test:node:ci` (3173 pass, 0 fail) refers only to the `node:test` runner configured in CI. The **15 documented items** below include skips in runners excluded from that command:

| Runner | Included in `test:node:ci` | Tests |
|---|---|---|
| Node CI (`dist/tests/**/*.test.js`) | ✅ | 3173 pass / 4 skip / 0 fail |
| Manual / TTY suites (`tests/manual/`) | ❌ excluded by path | 3 exports + 3 tests |
| PTY tests (`tests/pty/`) | ❌ gated by `ALIX_PTY_TESTS=1` | 1 describe block |
| Soak tests (`tests/soak/`) | ❌ gated by `ALIX_SOAK_TESTS=1` | 4 test files |
| Integration tests (model API) | ✅ gated by API key probes | 2 tests (skip when no key) |

## Summary by Classification

| Classification | Count | CI Runner | Activate Condition |
|---|---|---|---|
| External-tool-dependent | 2 | ✅ gated by `hasUvx()` | `uvx` on `$PATH` |
| Network-dependent | 1 | ✅ gated by `hasNetwork()` | HuggingFace reachable |
| Manual / TTY-only | 5 | ❌ excluded | Interactive terminal |
| Platform-specific (PTY) | 1 | ❌ `ALIX_PTY_TESTS=1` | Real TTY device |
| Soak tests | 4 | ❌ `ALIX_SOAK_TESTS=1` | Long-running mode |
| Integration (model API) | 2 | ✅ gated by API key | Real provider configured |

**Total documented: 15** | **Node CI count: 4**

---

## 1. External-Service-Dependent

These tests require an external service and are correctly gated behind a runtime probe. CI does not install these services.

### uvx-based MCP discovery — 2 tests

| Field | Value |
|---|---|
| **ID** | `uvx-discovery-01` |
| **File** | `tests/cli-discover.test.ts` |
| **Lines** | 19, 51 |
| **Skip reason** | `{ skip: !hasUvx() }` |
| **Classification** | External-tool-dependent |
| **Activation** | `uvx --version` succeeds on `$PATH` |
| **Removal criteria** | uvx installed in CI or test restructured to mock `uvx` |

### Embedding cache — 1 describe block

| Field | Value |
|---|---|
| **ID** | `embedding-cache-01` |
| **File** | `tests/repomap/embedding-cache.test.ts` |
| **Line** | 21 |
| **Skip reason** | `{ skip: !hasNetwork }` |
| **Classification** | Network-dependent |
| **Activation** | HuggingFace model endpoints reachable |
| **Removal criteria** | Embedding model downloads bundled or mocked |

---

## 2. Manual / TTY-Only

These tests require interactive terminal input or a running real model API. They live in `tests/manual/` and are not included in CI.

### run-cli helpers — 3 exports

| Field | Value |
|---|---|
| **File** | `tests/manual/run-cli.ts` |
| **Lines** | 131, 145, 150 |
| **Classification** | Manual-test-helper (skip option objects, not individual tests) |

- `needsModel`: `{ skip: "requires model API key" }` — probes `resolveApiKey()`
- `needsTty`: `{ skip: "requires interactive TTY" }` — always skipped in non-TTY
- `needsBrave`: `{ skip: "requires BRAVE_API_KEY env var" }`

### CLI suite A — 2 tests

| Field | Value |
|---|---|
| **File** | `tests/manual/suite-a-cli.test.ts` |
| **Lines** | 72, 84 |
| **Skip reasons** | A.6: `"requires interactive TTY"` | A.8: `"requires interactive prompts"` |

### Plan suite B — 1 test

| Field | Value |
|---|---|
| **File** | `tests/manual/suite-b-plan.test.ts` |
| **Line** | 24 |
| **Skip reason** | `"requires interactive TTY for plan phase"` |

---

## 3. Platform- and Environment-Gated

These tests run only when a specific environment variable is set. They require runtime capabilities absent in headless CI.

### PTY tests — 1 describe block

| Field | Value |
|---|---|
| **ID** | `pty-tests-01` |
| **File** | `tests/pty/tui-pty.test.ts` |
| **Line** | 52 |
| **Gate** | `ALIX_PTY_TESTS=1` |
| **Skip expression** | `{ skip: !ENABLED }` where `ENABLED = process.env.ALIX_PTY_TESTS === "1"` |
| **Classification** | Platform-specific |
| **Run command** | `ALIX_PTY_TESTS=1 npx node --test dist/tests/pty/` |

PTY tests spawn pseudo-terminals and require a real TTY device. Incompatible with headless CI.

### Soak tests — 4 files

| Field | Value |
|---|---|
| **ID** | `soak-tests-01` |
| **Files** | `tests/soak/daemon-protocol-soak.test.ts`, `tests/soak/corruption-recovery.test.ts`, `tests/soak/memory-growth.test.ts`, `tests/soak/store-load.test.ts` |
| **Gate** | `ALIX_SOAK_TESTS=1` |
| **Classification** | Soak-test |
| **Run command** | `ALIX_SOAK_TESTS=1 npx node --test dist/tests/soak/` |

Soak tests are long-running (minutes to hours) and excluded from CI.

---

## 4. Correctly Gated Integration Tests

These tests call a real model API and require available credits. They are included in CI but skip when no API key is configured.

### agent-loop.test.ts — 1 test

| Field | Value |
|---|---|
| **ID** | `integration-credits-01` |
| **File** | `tests/agent-loop.test.ts` |
| **Line** | 13 |
| **Skip reason** | `{ skip: "integration test: requires model API credits" }` |
| **Classification** | Integration-test |

Calls `runTask()` which invokes a real model.

### run-flow.test.ts — 1 test

| Field | Value |
|---|---|
| **ID** | `integration-credits-02` |
| **File** | `tests/run-flow.test.ts` |
| **Line** | 10 |
| **Skip reason** | `{ skip: "integration test: requires model API credits" }` |
| **Classification** | Integration-test |

Same dependency on real model API.

---

## 6. Skipped-Test Governance (CI Validator)

The `pnpm test:skips:audit` script (`scripts/test-skips-audit.sh`) runs as part of pre-merge validation. It detects:

| Check | Detects | Fails CI |
|---|---|---|
| Bare `{ skip: true }` without reason string | ❌ | ✅ |
| `.skip()` without equivalent in taxonomy doc | ❌ | ✅ |
| `test.skip(...)` / `it.skip(...)` / `describe.skip(...)` without documented marker | ❌ | ✅ |
| `process.env`-based gating not in taxonomy | ⚠️ warning | ❌ |
| New undocumented skip introduced | ❌ | ✅ |

### Machine-Readable Registry

```json
[
    "id": "uvx-discovery-01",
    "file": "tests/cli-discover.test.ts",
    "classification": "external-tool-dependent",
    "milestone": "P4.1c",
    "removalCriteria": "uvx installed in CI or test restructured"
  },
  {
    "id": "embedding-cache-01",
    "file": "tests/repomap/embedding-cache.test.ts",
    "classification": "network-dependent",
    "milestone": "TBD",
    "removalCriteria": "embedding model downloads bundled"
  },
  {
    "id": "pty-tests-01",
    "file": "tests/pty/tui-pty.test.ts",
    "classification": "platform-specific",
    "milestone": "P4.1g",
    "removalCriteria": "PTY tests run in CI via cross-platform matrix"
  },
  {
    "id": "soak-tests-01",
    "file": "tests/soak/*.test.ts",
    "classification": "soak-test",
    "milestone": "P4.1e",
    "removalCriteria": "soak tests have scheduled CI run"
  },
  {
    "id": "integration-credits-01",
    "file": "tests/agent-loop.test.ts",
    "classification": "integration-test",
    "milestone": "TBD",
    "removalCriteria": "model provider available in CI"
  },
  {
    "id": "integration-credits-02",
    "file": "tests/run-flow.test.ts",
    "classification": "integration-test",
    "milestone": "TBD",
    "removalCriteria": "model provider available in CI"
  }
]
```

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-17 | P4.1b complete — removed Ollama section (6 tests re-enabled), updated counts to 3173 pass / 4 skip / 0 fail. Remaining skips: uvx (2), embedding network (1), integration credits (2). |
| 2026-06-17 | Updated 6 Ollama skips to use milestone-referencing reason `"P4.1b: Ollama provider does not yet translate tool_calls"`, added machine-readable registry, runner scope table, and CI governance check |
| 2026-06-17 | Initial taxonomy — documented all 23 skipped items |
