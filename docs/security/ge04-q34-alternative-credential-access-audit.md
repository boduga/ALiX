# GE-04 Q3.4 — Coordination worker alternative credential-access audit

**Disposition: SECURITY HOLD. Source inspection only.** No real credentials were read or tested. This audit is not a runtime access-control proof, exhaustive provider audit, or production authorization.

## Confirmed source behavior

| Boundary | Evidence | Consequence for Q3.3 minimization |
|---|---|---|
| Worker config reload | `src/agents/subagent-cli.ts` calls `loadConfig(process.cwd(), { resolvedApiKeys })` before effective model resolution | The FD-3 snapshot is only an override for referenced keys; it is not a provider grant or config-read boundary |
| User/project config files | `src/operations/config/loader.ts` reads `~/.config/alix/config.json` and `<cwd>/.alix/config.json`, merges `apiKeys` with project overrides | A worker with ordinary read access to these files may recover unrelated plaintext keys without FD 3 |
| Plaintext and reference handling | Loader merges all keys; when any `cred://` reference exists, resolves each reference using the FD-3 snapshot if available, otherwise credential store; retains other plaintext entries | Excluded providers can still be resolved or loaded from local configuration |
| Credential-store fallback | Loader calls `chooseBackend()` and `loadCredentialStoreWithKeychainFallback()` when references remain unresolved | A narrowed FD-3 payload may cause worker-side keyring/plain-file credential resolution, defeating the intended grant |
| Environment injection | Loader injects each resolved API key into provider-specific `process.env` names if absent | Worker process can hold keys for unrelated providers in its own environment after loading config; narrowing the spawn environment does not prevent this |
| Child spawn environment | `src/runtime-state/runtime/child-env.ts` includes baseline `PATH`, `HOME`, `SHELL`, temporary/system variables and configured allowlist; `SubagentManager` adds `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` when set | Baseline does not implicitly include API key env vars, but configurable allowlist may include them; DBus/keyring addresses enable an independent access path |
| Worker provider creation | `src/agents/subagent-cli.ts` calls `createProvider()` with effective provider/model and no explicit API key | Environment-based credential discovery may remain relevant; this call does not consume the Q3.3 grant plan |
| Runtime fallback | `buildFallbackChain()` defines model fallback candidates, but this worker `createProvider()` call does not pass the model entry's `routing` field | The Q3.3 planner models configured fallback potential, **not proof that this worker actually executes that fallback chain**. Confirm adapter path before binding grants |
| Additional credentials | `loadConfig()` also resolves tracing Langfuse references when enabled; MCP initialization runs after config loading | Provider API keys are not the entire worker secret surface; trace/MCP credential access needs separate inventory |

## Security implications

1. **FD-3 filtering is transport minimization, not isolation.** A same-UID worker generally retains its user's filesystem permissions; a filtered pipe cannot revoke readable configuration files or credential-store access.
2. **Grant authorization must precede secret resolution.** The current worker loads full config and may resolve all provider references before selecting its effective model. A post-load provider filter would be too late to prevent secret material entering worker memory/environment.
3. **The child environment is not a sufficient boundary.** `buildChildEnv` defaults are narrow, but configurable allowlist and `loadConfig`'s subsequent environment injection must be addressed independently.
4. **DBus address is not itself a secret value.** It can nevertheless enable access to a same-user keyring; no actual keyring permission check was performed in this audit.
5. **Routing consistency is unresolved.** The grant planner uses `buildFallbackChain`, while the inspected worker adapter call passes only provider/name/timeouts/selection. An implementation must derive its grant from the worker's *actual authorized execution route*, not a separate or broader configuration projection.

## Required architecture decisions before production sender changes

- Establish a restricted worker configuration view containing only nonsecret settings and authorized model/route metadata. Do not load all `apiKeys` into worker memory or environment.
- Resolve permitted credentials on the parent/broker side and bind them to a verified run/worker/attempt and effective routing plan. Reject expansion or rerouting outside that plan.
- Choose whether same-UID, same-home workers are acceptable for **transport minimization only**, or whether a separate UID, sandboxed filesystem, restricted environment and brokered credential operations are required for an actual confidentiality boundary.
- Remove or narrowly broker direct credential-store/keyring access for workers requiring isolation; preserve keychain-backed provider compatibility through an explicit reviewed protocol.
- Inventory tracing, MCP/plugin, provider environment, shell/tool execution and error-reporting secret paths separately.

## Proposed isolated-host qualification (synthetic only)

1. Create temporary user/project configs containing *synthetic* unrelated provider canaries, then run the actual worker config loader in a subprocess and record only whether excluded canaries are reachable; never output values.
2. Repeat with a synthetic `cred://` store or isolated fake store and no real DBus/keyring; verify whether omitted FD-3 entries trigger alternative resolution.
3. Verify custom `runtime.envAllowlist` can propagate a synthetic unrelated provider environment variable; record this as a configuration escape path, not an exploit.
4. Test restricted-config and isolated-home prototypes with negative assertions that excluded canaries are unavailable through file, environment and store paths.
5. Perform authorized cross-UID/filesystem/IPC tests before any claim of worker confidentiality. Independent security review remains required.

**Stop condition:** Do not connect the Q3.3 planner to production `resolvedCredentialPayload` as a purported security fix while alternative secret paths remain accessible. Do not relax GE-04 HOLD.

## Test-only restricted worker metadata prototype

`src/agents/worker-config-view.ts` projects a minimal immutable provider/model identity and a copied provider-name list from a caller-supplied grant. `tests/agents/worker-config-view.vitest.ts` verifies that extra model properties, including synthetic secret-like data, are not serialized, and rejects malformed grants and unresolved selections. This **does not** authenticate the grant, prove correspondence to actual runtime routing, block access to on-disk config, or change production `loadConfig`/spawn behavior. A syntactically valid but overbroad caller grant is not prevented by this projection. Production integration remains prohibited under GE-04 HOLD.

## Q3.5 pure worker grant binding prototype

`src/agents/worker-grant-binding.ts` binds a caller-supplied resolved route to `coordinationRunId`, `workerId`, and nonnegative integer `attempt`, recomputing the provider set through the existing routing planner. `tests/agents/worker-grant-binding.vitest.ts` exercises identity substitution, model substitution, fallback expansion, malformed identities and forged provider-list expansion. **This is an in-process consistency check, not authentication or authorization:** a caller able to replace both the binding and model can manufacture a matching pair. It has no signature, durable issuer record, single-use consumption, runtime scheduler authority, or credential-store isolation. No production integration is authorized under GE-04 HOLD.
