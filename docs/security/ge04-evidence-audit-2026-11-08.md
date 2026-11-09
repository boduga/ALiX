# GE-04 evidence audit — baseline after PR #1096

**Disposition: SECURITY HOLD ACTIVE.** This audit distinguishes repository-observed behavior from independently qualified production authority. Source inspection and local unit tests are **not** independent security assessment.

Baseline: `main` at `b89aca89`. Acceptance inventory: [`ge04-acceptance-ledger-2026-11-08.md`](ge04-acceptance-ledger-2026-11-08.md). GitHub issue status: 13 open GE-04-titled issues at audit start.

## Verified implementation facts and remaining acceptance gaps

| Workstream | Direct repository evidence | What it proves | Remaining acceptance gap |
|---|---|---|---|
| R1-B1 (#1054) | `src/agents/worker-supervisor.ts` declares `WorkerSupervisor`, `requireWorkerSupervisor`, and `unavailableWorkerSupervisor` | Canonical contract and explicit deny-only fallback exist | Not proven that all real worker launch paths must use the trusted supervisor; native launch independently qualified |
| R1-B2 / Q3.1 (#1055, #1050) | `src/agents/worker-supervisor-linux-lifecycle.ts`, `src/agents/worker-broker-linux-registration.ts`, `docs/security/ge04-q31-distinct-uid-qualification.md` | Linux registration/lifecycle experiments and operator-reported distinct-UID evidence exist | Independently provisioned trusted supervisor, kernel-authenticated per-request identity, hostile FD-delegation and process-reuse qualification |
| R1-C (#1056) | `src/agents/subagent-cli.ts` still accepts `--credential-fd`; `src/agents/subagent-manager.ts` still has `--credential-fd 3` and credential payload path | Legacy credential-bearing worker path remains reachable in source | Broker-owned credentialed model operations and complete worker secret removal |
| R1-D (#1057) | `scripts/ge04-q32-process-effect-probe.py` and its tests; `src/execution/filesystem/supervisor-effect-executor.ts` always returns DENY | Isolated synthetic scratch syscall experiment exists; local probe tests passed 6/6 | Independently custodied issuer, authenticated request/verdict, production final-effect serialization, durable crash/unknown-outcome reconciliation |
| R1-E (#1058) | `src/agents/subagent-manager.ts` retains optional `supervisorWorkerLifecycle` and cooperative `GE04_READY` FD4; `src/agents/subagent-cli.ts` retains legacy FD3 reader | Legacy migration not finished | Remove legacy paths only after B1/B2/C/D; static bypass guards and migration/rollback tests |
| R1-F (#1059) | `docs/security/ge04-production-worker-lifecycle.md` explicitly requires independent Q13 clearance | Release gate is documented | Independent external qualification, adversarial matrix and signed release decision not evidenced |
| CAP/NATIVE/CONTAINER/QUAL/ADMIT (#1063–#1067) | `src/agents/linux-containment-discovery.ts` returns `supportedForQualification:false` and `authorizedForWorkerLaunch:false`; `src/agents/linux-containment-capabilities.ts` also sets `authorizedForWorkerLaunch:false` | Capability discovery does not authorize workers | Real native/container isolation evidence, cross-environment matrix, production admission gate |
| Scoped mutation (#1040) | `src/execution/filesystem/scoped-mutation.ts` factory always returns `UnavailableScopedMutationService`; supervisor effect executor always denies | Production scoped mutation remains fail-closed | All six issue #1040 release criteria, including independently administered trust anchors, native syscall protection, and external security sign-off |

## Local verification

- Command: `python3 -B scripts/test-ge04-q32-process-effect-probe.py`
- Result: **6 tests passed**, 2026-11-08, local development machine; synthetic scratch-only process probe. This does not qualify real privileged effects.
- Source check: `rg -n 'credential-fd|GE04_READY|supervisorWorkerLifecycle|createScopedMutationService\(' src` confirmed legacy worker credential and cooperative startup paths still exist.
- No independent privileged host tests, full TypeScript regression suite, production credential use, or real filesystem mutation was executed as part of this audit.

## Prioritized next acceptance work

1. **B1 first:** prove no bypass around the canonical supervisor in all production worker entry points; add static regression guard and real lifecycle integration tests, keeping credentials disabled.
2. **B2 + NATIVE:** provision independently controlled restricted worker and supervisor; test per-request authentication and FD delegation; prove pre-exec containment and safe kill/recovery on disposable hosts.
3. **C:** move credentialed inference to broker; reject any reusable secret delivery to workers; cover paid/keyless/streaming/fallback/revocation.
4. **D + #1040:** integrate authenticated issuer/supervisor with durable effect claim and last-syscall revocation ordering; test crash ambiguity and fail-closed recovery without blind retry.
5. **E:** migrate every caller and remove FD3/FD4 legacy paths; add static and end-to-end regression gates.
6. **QUAL + F:** independent adversarial review and Q13 release decision; preserve HOLD on any incomplete evidence.

## Acceptance semantics

- **IMPLEMENTED**: code exists at a referenced revision; not automatically safe or integrated.
- **LOCALLY TESTED**: named test command and result on a named environment; not independent qualification.
- **INDEPENDENTLY QUALIFIED**: separately administered test host, artifact hashes, kernel/UID/runtime evidence, negative cases, reviewer and signed disposition.
- **PRODUCTION AUTHORIZED**: all release prerequisites pass and explicit Q13 clearance is recorded. **No workstream is marked production authorized in this audit.**
