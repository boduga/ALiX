# ALiX CLI command inventory

This is the test-planning inventory for the CLI exposed as `alix` by
`package.json`. The executable wrapper is `bin/alix.js`; command dispatch is in
`src/cli.ts`, with delegated handlers in `src/cli/commands/`.

Examples assume a built checkout (`pnpm build`) and either the installed
`alix` binary or `node dist/src/cli.js`. Commands that mutate state should be
tested in a temporary workspace with isolated `HOME` and `.alix` directories.

## Test-note legend

- **CLI unit**: exercise the handler with fixtures and captured output.
- **CLI integration**: invoke `dist/src/cli.js` in a temporary workspace.
- **Manual/external**: requires a TTY, browser, daemon, provider, model, or
  package/network service.
- **Mutation**: assert both the resulting state and the audit/provenance record.
- **Inventory**: keep `tests/cli/command-inventory.test.ts` synchronized with the
  registered command surface.

## Global help and version

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix --help`, `alix -h` | Print the categorized command summary. | `alix --help` | CLI integration; assert exit 0 and representative command families. |
| `alix --version`, `alix -v` | Print the ALiX version. | `alix --version` | CLI integration; compare with `ALIX_VERSION`. |

## Core interaction and execution

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix init` | Initialize ALiX files in the current project. | `alix init` | Covered by `tests/cli/init.test.ts`; test idempotency in a temp workspace. |
| `alix chat [--session <id>\|--new]` | Start or resume interactive chat. | `alix chat --new` | `tests/cli/chat-modes.test.ts`; full interaction is Manual/TTY/provider. |
| `alix run "<task>" [options]` | Execute a task, normally through plan approval. | `alix run "summarize this repo" --no-stream` | Parser coverage in `tests/cli/run-args.test.ts`; provider execution is Manual/external. Cover `--no-plan`, `--mode`, `--resume`, `--plan-file`, `--intent`, and `--propose`. |
| `alix submit "<task>"` | Submit a task to the background daemon and stream its result. | `alix submit "run tests"` | CLI integration with a temporary daemon; cover unavailable daemon and interrupted stream. |
| `alix plan "<task>"`, `alix plan --list` | Create a reviewable plan or list saved plans. | `alix plan "upgrade dependencies"` | CLI integration; isolate plan storage and stub provider for creation. |
| `alix review <plan-id>` | Display a saved plan for review. | `alix review plan_123` | CLI integration; cover missing and malformed IDs. |
| `alix apply <plan-id>` | Apply an approved saved plan. | `alix apply plan_123` | Mutation; handler tests plus rejection of unapproved/missing plans. |
| `alix agent <role> "<prompt>"` | Run a role-specific subagent prompt. | `alix agent reviewer "review src/cli.ts"` | `tests/agents/subagent-cli.test.ts`; provider-dependent path is Manual/external. |
| `alix research "<query>"` | Run the research workflow. | `alix research "local model routing"` | CLI unit with provider/tool stubs; Manual/external for live research. |
| `alix issue run <issue>` | Execute the autonomous issue workflow. | `alix issue run 123` | Covered by `tests/cli/commands/issue-run-handler.test.ts`; use fake Git/provider adapters. |

## Graphs, SOPs, reports, and sessions

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix graph plan "<task>" [--debug]` | Generate and persist a task graph. | `alix graph plan "ship release" --debug` | CLI integration with a stub planner; assert graph, events, and optional raw output. |
| `alix graph list` | List persisted graphs. | `alix graph list` | CLI integration with empty and populated graph fixtures. |
| `alix graph inspect <graph-id>` | Show graph metadata, nodes, edges, and status. | `alix graph inspect graph_123` | CLI integration; cover missing/corrupt graph. |
| `alix graph export <graph-id> --format <mermaid\|json>` | Export a graph. | `alix graph export graph_123 --format mermaid` | CLI integration; validate both formats and reject unknown formats. |
| `alix graph preflight <graph-id>` | Check node capability and policy readiness. | `alix graph preflight graph_123` | Integration with registry/policy fixtures; assert non-ready exit behavior. |
| `alix graph run <graph-id> [--enforce-capabilities]` | Execute all runnable graph nodes. | `alix graph run graph_123 --enforce-capabilities` | Integration with fake executors/providers; Mutation and approval-gate assertions. |
| `alix graph rerun <graph-id> --node <node-id> [--force]` | Re-run one failed graph node. | `alix graph rerun graph_123 --node build` | Integration; test invalid state, forced rerun, and result exit code. |
| `alix graph continue <graph-id>` | Resume a graph blocked on approval or failure. | `alix graph continue graph_123` | Integration with approval fixtures; Mutation. |
| `alix graph runs <graph-id>` | Show execution history for a graph. | `alix graph runs graph_123` | CLI integration with empty and multiple-run fixtures. |
| `alix sop list`, `show <id>`, `doctor` | List, inspect, or validate SOP packs. | `alix sop doctor` | CLI integration against fixture manifests; cover invalid packs. |
| `alix sop run <id> (--topic "<topic>"\|--path <path>\|--input key=value...)` | Execute an SOP with typed inputs. | `alix sop run deep-research --topic "agents"` | Handler/integration tests with provider stubs; reject missing/invalid inputs. |
| `alix report list`, `show <id>`, `open <id>`, `path <id>` | Discover, print, open, or resolve generated reports. | `alix report show report_123` | CLI unit for list/show/path; `open` is Manual/external and should mock the platform opener. |
| `alix session list`, `show <id>` | List sessions or inspect one session. | `alix session show session_123` | CLI integration against session fixtures; cover missing IDs and malformed data. |

## Project UI, configuration, and extensions

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix serve` | Start the Inspector HTTP server. | `alix serve` | Server integration on an ephemeral port; assert read-only routes and shutdown. |
| `alix inspector open` | Start/open the Inspector in a browser. | `alix inspector open` | Manual/external; mock browser launch in automated tests. |
| `alix tui` | Start the terminal UI. | `alix tui` | `pnpm test:manual:tui` and `pnpm test:pty:tui`; requires TTY/PTY. |
| `alix demo local` | Run the local demonstration flow. | `alix demo local` | Manual/external; smoke-test preflight failures without a local model. |
| `alix config show`, `get <path>` | Read effective configuration or one value. | `alix config get model.name` | CLI integration with layered config fixtures; no mutation. |
| `alix config set <path> <value>`, `delete <path>` | Change or remove a configuration value. | `alix config set model.name llama3` | Mutation; assert version, provenance, validation, and rollback safety. |
| `alix config history`, `provenance` | Show configuration versions or change origins. | `alix config history` | CLI integration with versioned fixtures. |
| `alix config rollback <version> --force --reason "<reason>"` | Restore a prior configuration version. | `alix config rollback 2 --force --reason "bad model"` | Mutation; require reason/force and assert audit trail. |
| `alix config set-key [provider]` | Store a provider API key interactively. | `alix config set-key openai` | Manual/TTY; automate with isolated `HOME` and stdin, never real secrets. |
| `alix config set-default-model` | Select the default provider and model. | `alix config set-default-model` | Manual/TTY; unit-test catalog selection and persisted value. |
| `alix config set-tier` | Configure model routing tiers. | `alix config set-tier` | Manual/TTY plus mutation assertions. |
| `alix mcp list`, `add`, `remove <name>`, `discover <package>`, `test <name>` | Manage and validate MCP server registrations. | `alix mcp test filesystem` | CLI unit for config mutation; discover/test are Manual/external or use fake transports. |
| `alix extension list`, `install <path>`, `uninstall <type/name>`, `search <query>` | Manage local extensions. | `alix extension install ./my-extension` | CLI integration in temp directories; Mutation; search may require external catalog fixtures. |
| `alix skill list`, `show <id>`, `install <path>`, `run <id> [options]` | Manage and execute registered skills. | `alix skill run review --input "src/" --json` | `tests/cli/skill-commands.vitest.ts` and skill command suites; run with provider stubs. |
| `alix skills <skill-name> [args]` | Invoke a bundled CLI skill directly. | `alix skills debug "failing test"` | Per-skill suites under `tests/cli/commands/skills/`; cover unknown skills. |
| `alix memory list`, `add`, `search`, `stats` | Inspect and mutate persistent memory. | `alix memory search "release"` | CLI integration with isolated memory store; `add` is Mutation. |
| `alix db doctor`, `migrate` | Validate or migrate the ALiX database. | `alix db doctor` | Integration against temporary old/current/corrupt databases; `migrate` is Mutation. |

## Models, providers, benchmarking, and health

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix doctor [--performance]` | Check system health or performance readiness. | `alix doctor --performance` | CLI integration; fixtures for healthy/degraded components; startup coverage in `tests/benchmark/cli-startup.test.ts`. |
| `alix models doctor`, `fit`, `resolve` | Diagnose model setup, select a fit, or resolve routing. | `alix models fit` | CLI unit with catalog/hardware fixtures; live provider checks are Manual/external. |
| `alix models list-profiles`, `show-profile <id>` | List or inspect model profiles. | `alix models show-profile local-balanced --json` | CLI unit; cover JSON output and missing profile. |
| `alix models apply-profile <id> [--dry-run]`, `install-profile <id> [--dry-run]` | Apply or install a model profile. | `alix models apply-profile local-balanced --dry-run` | Mutation except dry-run; assert config changes and dry-run purity. |
| `alix provider doctor [provider]` | Diagnose one or all provider connections. | `alix provider doctor ollama` | Unit with fake endpoints; live check is Manual/external. |
| `alix benchmark run`, `compare` | Run benchmarks or compare saved results. | `alix benchmark compare` | Benchmark handler tests with deterministic fixtures; live run may be slow/external. |
| `alix metrics [--raw]` | Print local execution metrics. | `alix metrics --raw` | CLI integration with metric fixtures; assert empty state and raw format. |
| `alix baseline list`, `providers`, `health`, `show <subsystem>` | Inspect operational baseline snapshots and providers. | `alix baseline show governance --json` | Covered by `tests/cli/commands/baseline-cli.vitest.ts`; use provider fixtures. |

## Registry, policy, approvals, audit, and evidence

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix registry list`, `agents`, `tools`, `doctor` | List cards or validate the registry. | `alix registry doctor` | CLI integration with valid, duplicate, and invalid card fixtures. |
| `alix policy list`, `doctor`, `eval --capability <capability>` | Inspect or evaluate runtime policy. | `alix policy eval --capability filesystem.write` | CLI integration with policy fixtures; assert allow/deny/approval results. |
| `alix approvals list`, `pending`, `show <id>`, `approve <id>`, `deny <id>` | Manage graph/runtime capability approvals. | `alix approvals approve approval_123 --reason "reviewed"` | Integration with isolated store; approve/deny are Mutation and must be audited. |
| `alix approval list`, `show <id>`, `approve <id>`, `deny <id>`, `revoke <id>`, `expire` | Manage governance/execution approvals. | `alix approval revoke approval_123` | Handler tests with isolated store; all transitions are Mutation; cover invalid transitions. |
| `alix audit list`, `by-graph <id>`, `by-approval <id>`, `by-action <action>` | Query the runtime audit trail. | `alix audit by-graph graph_123` | CLI integration with JSONL fixtures; cover malformed tail records. |
| `alix audit verify`, `checkpoint --output <path>`, `checkpoint-verify <path>` | Verify audit integrity or create/verify checkpoints. | `alix audit verify` | Security audit suites under `tests/security/audit/`; checkpoint creation is Mutation. |
| `alix evidence list`, `show <id>`, `query`, `verify` | Query and verify security evidence records. | `alix evidence verify` | Covered by `tests/cli/evidence.vitest.ts`; use valid/tampered fixtures. |

## Runtime, daemon, runs, failures, and recovery

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix runtime events [filters]`, `timeline <graph-id>` | Query unified runtime events or a graph timeline. | `alix runtime events --session session_123 --limit 20` | CLI integration with runtime index fixtures; cover source/filter ordering. |
| `alix daemon start`, `stop`, `status`, `doctor` | Control and diagnose the background daemon. | `alix daemon status` | Daemon suites under `tests/daemon/`; use temp sockets/PIDs and guaranteed teardown. |
| `alix daemon tasks [--status <status>]`, `cancel <task-id>` | List or cancel daemon tasks. | `alix daemon cancel task_123` | Daemon integration; cancellation is Mutation; cover queued/running/terminal tasks. |
| `alix runs list`, `show <id>`, `append` | Inspect or append governance run-ledger entries. | `alix runs show run_123 --json` | Handler/integration tests with ledger fixtures; `append` is Mutation. |
| `alix failures list`, `show <id>`, `recall`, `append` | Inspect, recall, or record failure memories. | `alix failures recall --query "timeout"` | Handler/integration tests with failure fixtures; `append` is Mutation. |
| `alix workflow status`, `list`, `transition` | Inspect or transition workflow state. | `alix workflow transition workflow_123 completed` | Covered by `tests/cli/workflow.vitest.ts`; transition is Mutation and must reject invalid edges. |
| `alix reflection report` | Generate an execution reflection report. | `alix reflection report --json` | Covered by `tests/cli/reflection.vitest.ts`; use deterministic event fixtures. |
| `alix recovery scan`, `inspect`, `repair`, `verify` | Detect, inspect, repair, and verify corrupted state. | `alix recovery scan` | Integration with copied corruption fixtures; `repair` is Mutation and must preserve backups. |

## Security and credentials

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix security doctor`, `gate` | Diagnose security controls or evaluate the security gate. | `alix security gate --json` | `tests/cli/security-doctor.test.ts` and policy security suites; assert fail-closed behavior. |
| `alix security config keygen`, `sign`, `verify` | Generate signing keys and sign/verify configuration. | `alix security config verify` | Isolate `HOME`; use ephemeral keys; sign is Mutation. |
| `alix security config trust-key <path>`, `allow-rollback --reason "<reason>"` | Trust a public key or explicitly accept rollback state. | `alix security config trust-key ./public.pem` | Mutation; cover invalid PEM, missing reason, and provenance evidence. |
| `alix security supply-chain lifecycle-check` | Check lifecycle scripts against policy. | `alix security supply-chain lifecycle-check --json` | Unit/integration with package fixtures; no network required. |
| `alix security supply-chain exceptions list`, `exceptions check` | List audit exceptions or evaluate an audit report. | `alix security supply-chain exceptions check` | Integration with exception/audit fixtures; external audit invocation should be stubbed. |
| `alix security supply-chain verify-tarball <path>` | Verify package tarball contents. | `alix security supply-chain verify-tarball ./pkg.tgz` | Integration with safe/malicious tarball fixtures. |
| `alix credential list`, `get <provider> <label>`, `set <provider> <label> <value>`, `delete <provider> <label>`, `migrate` | Manage provider credentials and migrate legacy secrets. | `alix credential migrate --dry-run --json` | Credential suites under `tests/security/credentials/`; isolate keychain/files and never log values. Mutating forms require audit assertions. |
| `alix inspector auth create`, `list`, `rotate`, `revoke`, `doctor` | Manage Inspector authentication tokens. | `alix inspector auth create --name ci --role viewer --json` | Covered by `tests/cli/inspector-auth.test.ts`; isolate token store and redact secrets. |

## Adaptation, decisions, and learning

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix adaptation list`, `show <id>`, `lineage <id>` | Inspect adaptation proposals and provenance. | `alix adaptation lineage proposal_123 --json` | Adaptation CLI suites under `tests/cli/commands/`; read-only fixture tests. |
| `alix adaptation propose <report.json>`, `generate` | Create adaptation proposals manually or from signals. | `alix adaptation propose ./report.json` | Mutation; proposal/generation suites; assert no implicit approval/application. |
| `alix adaptation approve <ids...>`, `reject <id>`, `apply <id>`, `revert <id>` | Drive proposal lifecycle and safely undo applied changes. | `alix adaptation reject proposal_123 --reason "unsafe"` | Mutation; approval/revert suites; assert transition guards, snapshots, and audit. |
| `alix adaptation effectiveness`, `intelligence`, `prioritize`, `capability-evolution` | Analyze effectiveness, priorities, and capability evolution. | `alix adaptation effectiveness --all` | Dedicated adaptation CLI/domain suites with deterministic stores. |
| `alix decision context <proposal-id>`, `risk <proposal-id>`, `recommend <proposal-id>`, `review <proposal-id>` | Build decision evidence, risk, recommendations, and reviews. | `alix decision recommend proposal_123 --json` | Decision CLI suites under `tests/cli/commands/`; persistence forms are Mutation. |
| `alix decision queue`, `brief`, `status` | Present operator queues and strategic decision summaries. | `alix decision queue --limit 10 --json` | CLI unit with time-window fixtures and JSON assertions. |
| `alix decision outcome record`, `show`, `report`, `lens-calibration` | Record and analyze decision outcomes. | `alix decision outcome record proposal_123 --outcome success` | Outcome CLI suites; `record` is Mutation; cover identifiers and window boundaries. |
| `alix decision intent list`, `show <id>`, `propose <id>` | Inspect captured execution intents or convert one into a proposal. | `alix decision intent propose intent_123` | CLI integration with intent fixtures; `propose` is Mutation. |
| `alix learning report`, `propose`, `dashboard`, `refresh` | Inspect learning signals, propose changes, render dashboard, or refresh data. | `alix learning dashboard --json` | Learning CLI suites under `tests/cli/commands/`; propose/refresh are Mutation. |
| `alix explain proposal`, `governance` | Explain proposal or governance decisions. | `alix explain proposal proposal_123 --json` | `tests/cli/commands/explain-cli.vitest.ts` and `explain-governance-cli.vitest.ts`. |

## Governance

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix governance health`, `drift`, `lens-review`, `policies`, `integrity` | Inspect governance health, drift, lenses, policy lifecycle, and integrity. | `alix governance health --json` | Governance CLI/domain suites; use deterministic snapshots. |
| `alix governance recommend`, `risk-score`, `approval`, `analytics`, `failure-analysis`, `policy-suggestions`, `friction-analysis`, `report` | Generate governance intelligence and reports. | `alix governance report --json` | Governance suites by feature; assert JSON schemas and empty-data behavior. |
| `alix governance inbox`, `review <signal-id>`, `decide <signal-id>` | Triage signals, review them, and capture operator decisions. | `alix governance decide signal_123 --accept --reason "valid"` | Mutation for review/decide; operator workflow suites and audit assertions. |
| `alix governance actions list`, `refresh`, `mark-executed`, `dismiss` | Maintain the governance action queue. | `alix governance actions dismiss proposal_123 --reason "obsolete"` | Action-queue suites; mutating forms require audit assertions. |
| `alix governance propose`, `approve`, `reject`, `list`, `cleanup`, `explain` | Manage governance change proposals. | `alix governance approve proposal_123` | Governance CLI suites; lifecycle operations are Mutation. |
| `alix governance dashboard`, `investigate` | Render the governance dashboard or create an investigation. | `alix governance dashboard --json` | Dashboard/investigation suites; investigation creation is Mutation. |
| `alix governance execution report` | Report accepted-action execution state. | `alix governance execution report --json` | `tests/governance/execution-report.test.ts`; fixture all terminal states. |
| `alix governance audit list`, `show`, `trace`, `timeline`, `stats`, `anomalies`, `effectiveness`, `report`, `actor`, `policy`, `verify`, `export` | Query, analyze, verify, and export governance audit events. | `alix governance audit trace trace_123 --json` | `tests/cli/audit-cli-polish.test.ts` plus governance audit suites; export is filesystem Mutation. Include `stats before-after`. |

## Executive intelligence

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix executive dashboard`, `plan`, `evaluate`, `outcomes` | Render executive state, create plans, and evaluate outcomes. | `alix executive dashboard --json` | Dedicated executive CLI suites and golden-path test; plan/evaluate may mutate stores. |
| `alix executive learn`, `recommend`, `bridge`, `recommendation-effectiveness`, `remediate`, `subsystem-correlation` | Learn from outcomes and bridge recommendations into remediation. | `alix executive recommend --json` | Dedicated handler suites; bridge/remediate are Mutation. |
| `alix executive orchestrate create`, `list`, `show`, `approve`, `reject`, `start`, `run`, `step`, `resume` | Manage the executive orchestration lifecycle. | `alix executive orchestrate show orchestration_123 --json` | `tests/cli/commands/executive-orchestrate-cli.vitest.ts`; all lifecycle transitions are Mutation. |
| `alix executive correlate`, `reason`, `strategic-plan`, `confidence-model`, `forecast` | Run cognitive correlation, reasoning, planning, calibration, and forecasting. | `alix executive forecast --json` | Feature-specific suites under `tests/reasoning/`, `tests/planning/`, `tests/learning/`, and `tests/forecasting/`. |

## Coordination and ownership

| Command | Purpose | Example | Test notes |
| --- | --- | --- | --- |
| `alix coordination run`, `tick`, `resume`, `status`, `results`, `cancel` | Create and control coordinated multi-agent runs. | `alix coordination status coordination_123` | Coordination kernel/CLI suites; lifecycle operations are Mutation. |
| `alix coordination list`, `inspect`, `watch` | Discover or monitor coordination runs. | `alix coordination watch coordination_123` | CLI integration; `watch` is Manual/long-running and needs bounded test polling. |
| `alix coordination workers`, `approvals`, `ownership`, `events` | Inspect coordination resources and event streams. | `alix coordination workers coordination_123` | CLI integration with coordination-store fixtures. |
| `alix coordination conflicts`, `conflict`, `conflict-resolve`, `conflict-dismiss`, `conflict-accept-divergence` | Inspect and resolve coordination conflicts. | `alix coordination conflict conflict_123` | `tests/cli/coordination-conflicts.test.ts`; resolution forms are Mutation. |
| `alix ownership list`, `history`, `show <id>` | Inspect ownership leases and history. | `alix ownership list` | Covered by `tests/cli/ownership.test.ts`; fixture active/expired leases. |
| `alix ownership acquire`, `release <id>`, `renew <id>`, `conflicts`, `prune` | Manage ownership leases and remove expired records. | `alix ownership acquire --agent agent_1 --path "src/**" --mode write` | Ownership CLI tests; all except conflict query are Mutation; cover overlap and TTL boundaries. |

## Coverage maintenance

When a CLI command changes:

1. Update this inventory and `tests/cli/command-inventory.test.ts`.
2. Add handler-level coverage for argument validation and output.
3. Add a `dist/src/cli.js` integration test when dispatch or exit behavior
   changes.
4. For mutations, assert persisted state, audit/provenance, dry-run behavior,
   and invalid transition handling.
5. Keep live providers, browsers, network discovery, TTYs, and long-running
   daemons outside the default unit suite; cover them with explicit manual,
   integration, PTY, or soak suites.
