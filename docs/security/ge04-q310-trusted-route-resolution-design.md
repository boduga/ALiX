# GE-04 Q3.10 — Trusted route resolution (synthetic qualification)

Status: pure qualification prototype, no production integration. GE-04 SECURITY HOLD remains active.

## Verified resolution paths

- `src/operations/config/model-resolver.ts` `createModelResolver` reads canonical `models.*` and resolves a tier (falling back to `models.default`). It does not perform dynamic discovery.
- `src/agents/subagent-manager.ts` `getRoleModel` selects a role tier and returns only `{provider,name}`. The spawn path passes these as CLI overrides, losing fallback/selection metadata from the resolved config.
- `src/agents/subagent-cli.ts` `resolveEffectiveModel` prioritizes CLI provider/model overrides over the canonical tier. The child calls `loadConfig` before this resolution, and then creates its own provider; CLI overrides do not constitute trusted authorization.
- `src/models/providers/routing-adapter.ts` `buildRoutingAdapter` can resolve selection policy via `resolveSelectionModelId`, then derive fallback candidates. This is not currently a scheduler-persisted route authority record.

## Synthetic Q3.10 gate

`src/agents/worker-trusted-route-resolution.ts` uses `createModelResolver` against a caller-provided canonical config, refuses unresolved selection policies, and preserves the configured primary and ordered fallback candidates. It rejects worker-proposed primary/fallback changes. Four tests cover matching route, unresolved selection, substitution, and absent model.

## Integration design requirements

1. Trusted scheduler context (not the worker process) selects the role tier and resolves any dynamic model selection. Record full primary and ordered fallback route, not merely CLI provider/name.
2. Bind the resolved route and provider grant to the post-claim worker identity, execution owner, policy/plan revision, and an explicit route revision under a durable consistency boundary.
3. Ensure the actual worker adapter cannot execute a model or fallback outside that authorized route. Fail closed if runtime discovery or configuration diverges from the recorded decision.
4. Keep the credential broker's source of route authority distinct from worker CLI flags, workspace configuration and worker-supplied identity.
5. Test dynamic discovery, missing tier, altered fallback, concurrent retry, replan, restart and revocation before enabling production issuance.

No production secrets, FD-3 modifications, approval changes or security HOLD release are part of Q3.10.
