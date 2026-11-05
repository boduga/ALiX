# GE-04 Q3.2 — Production descriptor-boundary source audit (HOLD)

## Provenance and scope

Source inspection on the active ALiX branch after operator-reported microcloud3 synthetic replay-ledger FD delegation: issuer UID 990 transferred a writable SQLite descriptor to attacker UID 993, who corrupted the synthetic header. That observation is **not** evidence of a production ALiX leak. This audit is a selective source review, not an exhaustive runtime FD inventory, syscall trace, cross-UID containment qualification, or independent security sign-off.

## Findings

| Surface | Source | Observed contract | Qualification |
|---|---|---|---|
| Subagent worker | `src/agents/subagent-manager.ts` | Explicit four pipe stdio entries; fourth channel is intentional child communication, not an issuer ledger descriptor in the inspected configuration. Detached process group; environment includes DBus address/runtime directory when available. | Review the fourth channel and secret-service boundary separately; no issuer descriptor exposure established |
| Daemon launch | `src/operations/daemon/daemon-manager.ts` | Detached spawn with `stdio: "ignore"`. | No explicit arbitrary FD passed at this site; no runtime FD inventory |
| MCP subprocesses | `src/capabilities/mcp/process-manager.ts`, `src/capabilities/mcp/registry.ts` | Explicit three pipe stdio entries. | External MCP processes are a trust boundary; no issuer descriptor passing found in these spawn configurations |
| Shell and monitor | `src/capabilities/tools/shell-tool.ts`, `src/capabilities/tools/monitor-tool.ts` | Explicit ignore/pipe/pipe stdio. | No arbitrary FD in inspected configuration; shell command execution remains a distinct risk |
| Hooks, skills and local model | `src/operations/hooks/runner.ts`, `src/capabilities/skills/sandbox.ts`, `src/models/providers/local-llama-launcher.ts` | Explicit three-entry stdio configurations. | No arbitrary FD passed in inspected configurations |
| Approval lock | `src/governance/approvals/approval-store-lock.ts` | **Explicit FD delegation:** `tryFlock` builds stdio with original lock FD at child slot 9 and invokes util-linux `flock`; the child receives a duplicate open-file description by design. | Known, justified exception for lock mechanics; **not** proof of issuer replay-ledger leakage. Changes require lock-lifetime and concurrency regression review |
| Governed filesystem mutation | `src/execution/filesystem/scoped-mutation.ts` | `createScopedMutationService()` returns `UnavailableScopedMutationService`, whose `mutate` throws. | GE-04 mutation seam remains unavailable; not a production positive verifier |

Repository search of inspected `src` paths found no `SCM_RIGHTS` usage. This is a **search result**, not proof against native dependencies, dynamic code, or inherited OS handles. There is no production implementation of the synthetic Q3.2 issuer-owned SQLite replay ledger in the reviewed paths. The existing approval store/ledger is a separate mechanism and must not be equated with the synthetic experiment.

## Regression tripwires

`scripts/test-ge04-q32-descriptor-spawn-boundary.py` has four source-level test groups: selected subprocess sites declare stdio, those sites do not contain numeric extra descriptors or `SCM_RIGHTS`, the known `flock` FD-9 exception remains explicit, and scoped mutation remains unavailable. These checks are intentionally narrow and can miss dynamic construction, aliases, uninspected spawn sites, native modules, runtime descriptor inheritance, and process-boundary leaks. They must not be treated as an exhaustive policy engine.

## Outstanding work before custody qualification

1. Enumerate **all** spawn, fork, exec, IPC and native/FFI boundaries, including indirect library calls, environment-passed socket addresses and any process with elevated privileges.
2. Trace real process FDs (`/proc/<pid>/fd`, `strace` where operator-authorized) across child creation on an isolated host, redacting secrets; explicitly inspect the fourth subagent pipe and the `flock` FD-9 exception.
3. Establish issuer and replay-ledger custody **in an actual proposed production architecture**; ensure private authority and writable database handles are never delegated. Add tests at the real boundary, not merely source string assertions.
4. Evaluate directory/DB/WAL/SHM ownership, symlink/rename, hardlink, ACL, mount and namespace conditions; account for SQLite sidecars and process restart.
5. Obtain independent security review of authentication, replay consumption and final-effect fence. No positive-path activation until that review and operator authorization.

**Disposition: GE-04 SECURITY HOLD.** Zero real effects authorized; independent issuance not qualified.
