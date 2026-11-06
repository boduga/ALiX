# GE-04 Q3.16 — Scheduler/executor route parity qualification

**Status: parity checker and documented production divergence only. GE-04 SECURITY HOLD remains active.**

`assertExecutorRouteParity` checks a Q3.14 snapshot against claimed worker identity, owner, plan revision, route revision and scheduler canonical model, then compares primary and ordered fallback routes against the executor's proposed effective route. `describeCurrentChildCliRoute` models the current child CLI's actual `createProvider` arguments (provider/name, selection and matching timeouts, but no routing). The helper is diagnostic, not a trusted authority or live executor hook.

## Confirmed gap

`SubagentManager.getRoleModel` resolves canonical tier then returns only `{provider,name}`. `spawn` passes those as `--provider` and `--model`. In `subagent-cli.ts`, `resolveEffectiveModel` applies those overrides and `createProvider` receives provider/name, selection and timeouts, **not** `routing.fallbacks` or `routing.freeFallback`. Therefore a scheduler route with fallbacks cannot be assumed to match child execution. An explicit name override also clears selection. The worker loads broad configuration/credentials before effective model resolution.

## Tests

`tests/agents/worker-executor-route-parity.vitest.ts` covers exact route acceptance, detection of dropped fallbacks in the current CLI, substituted/reordered routes, owner/attempt/plan/route/revocation drift, and unresolved selection. No production scheduler or child CLI behavior is changed.

## Next gate

Q3.17 must establish one scheduler-owned, resolved route contract that the child executor actually consumes and verifies before provider initialization, with an authenticated boundary independent of worker-editable config. Do not enable credentials until same-UID credential-store/config/environment bypasses are contained and broker-side authorization is enforced. A pure route digest is not a signature.
