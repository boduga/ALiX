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

## Synthetic Node runtime descriptor observation (microcloud3 pending)

`scripts/ge04-q32-fd-runtime-fixture.cjs` creates a temporary synthetic regular file, keeps it open in the parent, and starts Node subprocesses with four-channel subagent-shaped stdio, three-channel daemon-like stdio, and an explicit descriptor at slot 9. Child `fstat` results are reduced to descriptor numbers and file types; no secrets, pathnames or descriptor contents are emitted. The experiment verifies that regular files are not observed in the first two child shapes, that FD 9 is observed in the explicit handoff, and that the synthetic fixture remains unchanged. `scripts/test-ge04-q32-fd-runtime-fixture.py` runs this fixture locally. The fixture uses `spawnSync` with an observed three-entry configuration for the daemon-like case, **not** the real daemon's `stdio: "ignore"` configuration; it is not an ALiX runtime trace or proof of the actual subagent's fourth-pipe behavior. It intentionally does not use `strace`, attach to live processes, inspect private data or establish cross-UID custody. Microcloud3 execution and any real-process syscall trace require separate operator evidence. GE-04 HOLD remains.

## Real compiled approval-lock scratch-path probe (operator host pending)

`scripts/ge04-q32-real-lock-fd-probe.mjs` imports the actual compiled `dist/src/governance/approvals/approval-store-lock.js`, uses a temporary scratch lock path and the Linux `flock` backend, and checks acquisition, contention, release and reacquisition. It requires `--isolated-test` and a nonroot account, never opens production approval state, emits HOLD, and exits 78. The test harness is `scripts/test-ge04-q32-real-lock-fd-probe.py`. The operator host needs a matching ALiX build; merely copying the probe script without its compiled module will fail closed. This checks lock behavior but **does not observe actual FD-9 syscalls** or show which other descriptors exist in the `flock` child. An operator-authorized syscall trace of this scratch-only process remains outstanding.

### Fourth subagent channel: corrected classification

The source at `src/agents/subagent-manager.ts` explicitly writes `resolvedCredentialPayload(this.options.config)` or `{}` to `child.stdio[3]` and closes the write side. This is a **credential-related data channel**, not simply an inert pipe. A future test must establish what the payload contains, how the child reads it, whether it is retained, and who can access it. Do not capture or publish the payload in descriptor tracing. The synthetic four-channel shape does not validate these confidentiality properties.

## Scratch-only real lock syscall observation

`scripts/ge04-q32-lock-syscall-trace.py --isolated-test` runs the actual compiled ALiX scratch-lock probe under unprivileged `strace -ff`, observing only `execve`, `dup2`, `dup3`, `close`, and `fcntl`. Raw trace files live only in an automatically deleted temporary directory; the output contains only counts and booleans, not syscall lines, paths, arguments, or credential bytes. It asserts that the underlying lock probe passes and at least one `flock` execution is observed. The count of `dup2`/`dup3` calls targeting FD 9 is diagnostic, **not** a requirement, because process-spawn implementations can use other descriptor setup mechanisms. A passing result is evidence of actual scratch-lock subprocess execution, not a complete descriptor table, not a security clearance, and not a subagent credential confidentiality test.

### Confirmed credential payload behavior and open question

`src/agents/subagent-manager.ts:87-96` serializes configured resolved provider API keys (excluding literal `cred://` references) into JSON for coordination workers. The manager sends it over FD 3 and ends the pipe (`:367`, `:393-396`). `src/agents/subagent-cli.ts:570-591` reads that descriptor to EOF using `readFileSync`, parses it as JSON, filters string values, and passes the result into `loadConfig({ resolvedApiKeys })`. Thus plaintext provider API key values **can** cross this worker boundary by design. The payload must not be included in syscall trace capture. The review has not yet proven minimization to only the worker's selected provider, resistance to untrusted child access, or zeroization; no unauthorized disclosure has been demonstrated. Treat this as an explicit credential-exposure surface requiring separate threat modeling, not a GE-04 clearance.
