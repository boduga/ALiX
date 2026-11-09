# GE-04 R0 — worker execution and credential boundary inventory

> **Historical baseline (2026-11-08 reconciliation):** This document preserves the original PR #1053 R0/R1 design and source observations at commit `4d9081d0`. Statements describing paths as *current* apply to that baseline, not necessarily to later `main`. Verify present implementation and security evidence before acting on its dispositions. The GE-04 SECURITY HOLD remains active; this documentation is not release authorization.

**Baseline:** `4d9081d0` (`main` after PR #1052). **Status:** source-backed initial inventory, NOT R0 closure. SECURITY HOLD remains active. This document distinguishes worker processes from unrelated subprocess capabilities and does not claim runtime entry-point completeness.

## Worker spawn ownership and callers

| Path | Source evidence | Current behavior / replacement disposition |
| --- | --- | --- |
| Primary worker process launcher | `src/agents/subagent-manager.ts:272,352-410` | `SubagentManager.spawn` launches CLI directly, optionally sends credential snapshot over FD3, optionally enables GE-04 lifecycle, inherits secret-service bus/runtime directory. **Replace** with mandatory supervisor-owned launcher, isolated UID, authenticated broker and no direct credentials. |
| Coordinator worker execution | `src/coordination/kernel/subagent-worker-executor.ts:85-129` | Constructs manager and invokes `spawn`. **Migrate** to canonical supervisor; verify retries, attempts and crash reconciliation. |
| Interactive agent delegation | `src/agents/agent/agent.ts:166`, `src/agents/delegate-tool.ts:44` | Creates manager and delegates tasks. **Migrate**; verify authorization parity. |
| Runtime builder | `src/runtime-state/runtime/runtime-builder.ts:76` | Constructs manager. **Migrate**; inspect daemon and session entry points using this builder. |
| Evaluation driver | `src/operations/evals/drivers/delegate-driver.ts:67-73` | Creates manager and spawns evaluation delegate. **Migrate or explicitly isolate test fixture**; no production bypass. |
| Parallel fanout | `src/agents/subagent-manager.ts:552` | `spawnMany` calls same `spawn` for tasks. **Retain behavior** via canonical launcher; verify each worker independently isolated and registered. |
| Child entry point | `src/agents/subagent-cli.ts:529,573-605` | Accepts `--credential-fd`; reads FD3 snapshot; optional cooperative gate. **Replace** secret reader and obsolete flags; retain only necessary canonical task protocol. |

## Credential, identity and IPC inventory

| Boundary | Evidence | Gap / disposition |
| --- | --- | --- |
| Credential serialization | `src/agents/subagent-manager.ts:92,375-408` | `resolvedCredentialPayload` and FD3 secret snapshot must be deleted after migration. |
| Worker credential read | `src/agents/credential-fd-reader.ts`, `src/agents/subagent-cli.ts:605` | Remove reader and CLI flag, verify no remaining call sites. |
| Keyring IPC inheritance | `src/agents/subagent-manager.ts:394-398` | DBus address and XDG runtime dir passed to worker; isolate and deny direct keyring socket access. |
| Optional lifecycle | `src/agents/subagent-manager.ts:32,353,379,410` | Caller-controlled opt-in permits legacy route; remove switch after canonical replacement. |
| Cooperative gate | `src/agents/worker-ge04-startup-gate.ts`, `src/agents/subagent-cli.ts:584` | Worker-controlled waiting is not kernel-enforced isolation. |
| Process registration | `src/agents/worker-ge04-linux-lifecycle.ts`, `worker-broker-linux-registration.ts`, `worker-broker-linux-process.ts` | Procfs identity checks are useful evidence but not authenticated request origin. |
| Native peer credentials | `src/agents/worker-broker-linux-peercred.ts`, `worker-broker-native-handoff.ts`, `worker-broker-native-admission-gate.ts` | Native peercred probe exists; diagnostic stdout is not admissible authorization. Build authenticated transport to broker. |
| Governed broker admission | `src/agents/worker-broker-governed-admission.ts`, `worker-broker-authorization.ts` | Review final effect authorization, replay atomicity and live peer binding before positive admission. |

## Entry-point tracing (static, provisional)

- Daemon: `src/operations/daemon/daemon-server.ts:91-92` constructs `SubagentWorkerExecutor` when subagents are enabled; otherwise it selects `DefaultWorkerExecutor`. The latter is a distinct execution mode requiring separate governance and worker-vs-in-process classification.
- Coordination tools: `src/coordination/kernel/coordination-tools.ts:295-296` constructs `SubagentWorkerExecutor`.
- HTTP server: `src/interfaces/server/coordination-routes.ts:415-416` constructs `SubagentWorkerExecutor`.
- Runtime/chat: `src/runtime-state/runtime/runtime-builder.ts:76`, `src/agents/agent/agent.ts:166` construct `SubagentManager` directly.
- Evaluation: `src/operations/evals/drivers/delegate-driver.ts:67` constructs `SubagentManager`.

These are source references, **not proof of complete runtime route coverage**. Trace the associated call chains, capability checks and recovery paths before R0 closure.

## Additional critical credential finding

`src/operations/config/loader.ts:189-277` resolves `cred://` references during config loading and injects resolved provider keys into `process.env` (including `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and others). `src/agents/subagent-cli.ts:605-606` loads this config **inside the worker**, so simply deleting FD3 and the inherited DBus address is insufficient. The replacement must stop worker-side secret resolution **and** environment injection, including user/project plaintext `apiKeys`, before loading provider clients. Credential-backed model inference must use a brokered operation or another independently reviewed no-raw-secret protocol. This is a production-blocking design requirement.

`src/runtime-state/runtime/child-env.ts` always forwards its default environment variables plus the configured allowlist, then applies explicit overrides. R0 must audit `HOME`, user-controlled allowlists and environment-based provider credentials for secret reachability; `HOME` may expose a same-UID worker to the user's credential files even without DBus. A separate UID alone is not proof of isolation without filesystem and mount/namespace checks.

## Other subprocess execution surfaces — separate classification required

The following spawn/exec sites are **not automatically ALiX workers**. R0 must classify their privilege, secret inheritance, and ability to launch a worker or bypass governance before deciding whether to route through the canonical worker supervisor or another governed process authority.

| Category | Source evidence |
| --- | --- |
| Shell and command execution | `src/capabilities/tools/shell-tool.ts`, `src/execution/verification/command-runner.ts`, `src/operations/hooks/runner.ts` |
| Skill and MCP subprocesses | `src/capabilities/skills/sandbox.ts`, `src/capabilities/mcp/registry.ts`, `src/capabilities/mcp/process-manager.ts` |
| External capability provider | `src/capabilities/capability/provider-executor.ts` |
| Local inference runtime | `src/models/providers/local-llama-launcher.ts` |
| Daemon lifecycle | `src/operations/daemon/daemon-manager.ts` |
| Broker native probes | `src/agents/worker-broker-supervised-probe.ts`, `worker-broker-pinned-probe.ts`, `worker-broker-linux-peercred.ts` |
| Operational/test subprocesses | `src/governance/approvals/approval-store-lock.ts`, `src/capabilities/skills/test-isolation.ts`, `src/capabilities/tools/monitor-tool.ts`, `src/interfaces/cli/commands/security-ops.ts` |

## R0 remaining verification before closure

1. Trace CLI, daemon, API, TUI, recovery and plugin entry points to the listed worker callers; record any dynamic imports, factories and runtime injection paths.
2. Enumerate all credential stores/providers, configuration `cred://` resolution, env allowlists, inherited FDs and subprocess descendants; test actual secret reachability, not just string references.
3. Determine supported installation/historical-data families impacted by worker credential protocol migration and required Q04/Q05 migration tooling, restore and rollback evidence.
4. Enumerate every direct subprocess surface above and decide **worker**, **governed tool execution**, **trusted infrastructure**, or **test-only** with source and runtime evidence.
5. Capture Linux x86-64 cross-UID negative tests and native IPC authentication threat review; no positive credential admission before independent qualification.
6. Produce a full consumer matrix, removal checklist, static guards and dynamic bypass tests; no legacy executable fallback at R5/R6 exit.

**Decision:** Do not mark R0 complete, remove credential routes, or promote worker credential access until the missing evidence and replacement design are independently reviewed. Legacy code identified here is a tracked migration blocker, not an accepted permanent exception.
