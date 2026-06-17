# P4.4 — Adoption and Supportability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build adoption tooling: `alix setup` (guided first-run), `alix certify` (validation checklist), `alix status` (system overview), `alix recover` (repair common failures), `alix support-bundle` (diagnostics export), reference applications, fresh-install certification test, cross-platform testing, and zero unexplained skipped tests.

**Architecture:** New CLI commands wrapping existing infrastructure (config loader, provider diagnostics, model doctor/fit, daemon manager). Reference apps are standalone directories under `examples/`. The fresh-install test runs the full onboarding flow in CI. Cross-platform testing adds CI matrix entries. Skipped test audit is a one-time investigation.

**Tech Stack:** TypeScript, Node `node:test`, existing `loadConfig`, `ProviderDoctor`, `ModelDoctor`, `DaemonManager`, `ModelFit`, `SetupWizard` (if exists)

## Global Constraints

- All new tests use `node:test` + `node:assert/strict`
- All imports use `.js` extensions (NodeNext)
- `alix setup` must never require root/sudo
- `alix certify` must complete within 30s
- Reference apps must be standalone (no secret dependencies)

---

### Task 1: alix setup — guided first-run

**Files:**
- Create: `src/cli/commands/setup.ts`

Interactive guided wizard:
1. Welcome banner, check Node version
2. Detect OS and platform
3. Check for existing config, offer to migrate
4. Provider selection menu (list available from provider registry)
5. Model auto-detection (call `models doctor` + `models fit`)
6. Config generation and write
7. Daemon startup test
8. Hello-world verification run

Non-interactive mode: `alix setup --provider=anthropic --model=claude-sonnet-4-6`
Auto-mode: `alix setup --auto` (detect best provider + model)

**Tests:**
- Non-interactive mode writes correct config
- --auto detects provider and model
- Validates generated config with `loadConfig()`
- Existing config is preserved unless --force

---

### Task 2: alix certify — validation checklist

**Files:**
- Create: `src/cli/commands/certify.ts`
- Test: `tests/cli/certify.test.ts`

Runs a checklist of validation checks and reports pass/fail:

```
✓  Node.js version (>= 24)
✓  Config file exists and loads
✓  Default model is configured
✓  Provider API key is set (check env vars)
✓  Provider connectivity (test model call)
✓  MCP servers connectable
✓  .alix/ directory structure exists
✓  Daemon can start
✓  session create/read works
✓  Approval store initializes
✓  Audit store initializes
✓  Metrics db initializes (P4.1)
```

Output format: machine-readable JSON (`--json`) and human-readable table.

**Tests:**
- certify returns pass for valid setup
- certify returns specific failure for missing config
- certify returns specific failure for no model
- --json output is parseable

---

### Task 3: alix status and alix recover

**Files:**
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/recover.ts`
- Test: `tests/cli/status.test.ts`, `tests/cli/recover.test.ts`

**`alix status`** — system overview:
```
ALiX v0.3.0-rc.2
Config: /home/user/.alix/alix.json
Model: deepseek deepseek-v4-flash
Daemon: running (PID 12345, uptime 2h 34m)
Providers: 5 configured, 5 reachable
MCP: 3 servers connected
Sessions: 47 total, 2 active
Memory: 4 entries (project: 2, user: 1, feedback: 1)
Approvals: 1 pending, 0 expired
Metrics storage: 847 events (2.1MB, retention: 30d)
```

**`alix recover`** — repair common failures:
- `alix recover --stale-pid` — clean stale daemon PID files
- `alix recover --corrupt-store` — diagnose and reset corrupt approval/metrics stores
- `alix recover --permissions` — fix .alix/ directory permissions
- `alix recover --all` — run all recovery steps

**Tests:**
- status shows correct values for mock state
- recover --stale-pid cleans PID file
- recover all runs without error

---

### Task 4: Reference applications

**Files:**
- Create: `examples/hello-alix/README.md`
- Create: `examples/hello-alix/alix.json`
- Create: `examples/todo-agent/README.md`
- Create: `examples/todo-agent/task.json`
- Create: `examples/code-reviewer/README.md`
- Create: `examples/code-reviewer/task.json`

Minimal standalone example apps demonstrating ALiX:

1. **hello-alix** — simplest possible: one file, one task, basic prompt
2. **todo-agent** — task with planning and verification
3. **code-reviewer** — subagent-based code review with findings

Each includes:
- README with expected output
- Config file (provider-agnostic, uses environment variables)
- Task file
- Expected output example

---

### Task 5: Fresh-install certification test

**Files:**
- Modify: `tests/tests/config/fresh-install-onboarding.test.ts` (extend existing)

The existing fresh-install test covers `init → doctor → fit`. Extend to cover:
- `alix setup --auto` (full guided flow)
- `alix certify` (all checks pass)
- `alix status` (correct output)
- `alix recover --all` (no errors with clean state)

This test runs in CI as part of the integration suite.

---

### Task 6: Skipped test audit

**Files:**
- All test files with `.skip` or `{ skip: true }`

Find every skipped test in the test suite and determine why:

```bash
grep -rn "\.skip\b\|{ skip:" dist/tests/ --include='*.test.js' | grep -v "node_modules"
```

For each skipped test:
1. If it's a capability gap (feature not implemented) → mark as known gap, document in test
2. If it's environment-dependent (needs network, GPU, specific OS) → document the condition
3. If it's a genuine flake → fix or delete
4. If the feature is now implemented → unskip

Goal: zero unexplained skipped tests. Document each skip reason inline.

---

## Verification

1. `alix setup --provider=cli --model=test` creates valid config
2. `alix certify` passes on a correctly configured system
3. `alix status` shows all expected sections
4. `alix recover --all` completes without error
5. Reference apps produce expected output
6. Fresh-install cert test passes in CI
7. Zero unexplained skipped tests
