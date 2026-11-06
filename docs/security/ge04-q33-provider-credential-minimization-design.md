# GE-04 Q3.3 — Coordination worker credential minimization (DESIGN ONLY)

**Disposition: GE-04 SECURITY HOLD.** This document does not approve production changes, independent issuance, real effects, or relaxation of any existing control. No secret values belong in tests, logs, events, traces or review artifacts.

## Verified current boundaries

- `SubagentManager.spawn()` resolves the role model via `getRoleModel()` and passes `--provider` and `--model` to the worker. For coordination tasks it additionally passes `--credential-fd 3` and writes `resolvedCredentialPayload(config) ?? '{}'` to the fourth stdio channel.
- `resolvedCredentialPayload()` currently serializes **every** nonempty plaintext configured provider API key except literal `cred://` references, regardless of the worker's selected provider. The compiled `readWorkerCredentialSnapshot()` filters nonstring values but does not filter provider names.
- `SubagentCLI.main()` calls `loadConfig(projectRoot, {resolvedApiKeys})`, then resolves its effective model using explicit provider/model overrides. `loadConfig()` merges user/project API keys, can resolve `cred://` through the local credential store, and sets provider-specific environment variables. Filtering FD 3 **alone** does not establish credential isolation.
- `ModelConfig.routing` supports `freeFallback` (OpenRouter only) and explicit provider/model fallbacks; `buildFallbackChain()` defines this ordering. The worker's model adapter construction and dynamic discovery must be traced before deciding which candidates are reachable.
- The child inherits selected runtime environment and may have DBus session address / runtime directory access for the credential store. These are independent authority paths, not credential values, and require separate containment assessment.

## Threat model and intended invariant

An untrusted, compromised or merely overprivileged coordination worker must not receive plaintext credentials for providers it is not authorized to invoke. The **intended** upper bound is the finite set of authorized providers for the worker's resolved primary model and *explicitly permitted* fallback candidates. Provider identity must be bound to the same model-routing decision used at execution, not inferred from the worker's prompt, output, or user-controlled CLI arguments.

**Proposed invariants (not yet implemented):**

1. Parent computes a canonical per-worker credential grant from its authoritative effective model/routing plan; no wildcard provider grant and no default-to-all fallback.
2. Grant includes primary provider and only the providers of enabled, validated fallbacks; deduplicate; reject empty, unknown, malformed, or unexpectedly expanded grants before spawn. A no-key local provider is permitted without an API-key grant.
3. The parent sends only granted provider keys over FD 3; never sends unrelated configured plaintext keys, including during error or retry paths.
4. Child verifies a tamper-resistant binding between the grant and the assigned worker/run/attempt and does not treat untrusted CLI arguments or FD 3 JSON as an authority to expand grants. A simple provider-name filter in the child is insufficient if the child can read other secrets.
5. Credential-store resolution, provider environment variables, runtime env allowlists, DBus/keyring access, config file access and provider-specific fallback behavior are included in the isolation claim; no path may silently restore access to excluded keys.
6. On routing changes or fallback expansion, fail closed or obtain a new authorized grant; never send the full keyring as a compatibility fallback. Avoid logging secret material and ensure crash/error diagnostics cannot echo payloads.
7. The change must preserve existing GE-04 HOLD, scoped-mutation fail-closed behavior, approval checks, and real-effects prohibition.

## Design choice to resolve before implementation

**Option A — in-process logical minimization:** Filter FD-3 payload by a provider allowlist, leaving child filesystem, config and keyring access unchanged. Low-cost compatibility improvement, but **not** a confidentiality boundary against a compromised worker; label only as transport minimization.

**Option B — isolated credential broker:** Parent or separate privileged broker retains secrets and supplies narrowly scoped provider operations/tokens over authenticated IPC; worker cannot read parent config/keyring or arbitrary credentials. Stronger custody boundary but requires sandbox/UID, filesystem and IPC isolation, and a reviewed protocol. This is the preferred direction for a security qualification claiming confidentiality.

**Recommendation:** Implement and qualify Option A only as a clearly scoped reduction in transport exposure, **not** as GE-04 clearance. Define Option B and the OS-level custody model before claiming worker credential isolation. Neither option is authorized for production activation by this document.

## Dependency and test plan

1. **Inventory first:** Trace actual worker adapter construction, model selection/discovery, `buildFallbackChain`, credential-store and `loadConfig` behavior, environment inheritance, config filesystem visibility and MCP/plugin credential access. Identify which components can expand provider access after spawn.
2. **Contract tests:** Pure grant planner with primary-only, same-provider fallback, cross-provider fallback, OpenRouter free fallback, duplicates, unknown provider, invalid selection, missing credential and dynamic reroute. No real keys.
3. **Sender tests:** Spawn a synthetic child with 2–3 synthetic provider canaries; assert FD-3 payload contains exactly granted keys and no excluded canary. Do not print the payload.
4. **Receiver tests:** Reject unexpected provider entries and grant/worker binding mismatches; malformed JSON and truncated pipe must fail closed. Test direct environment and config/keyring bypass separately.
5. **Lifecycle tests:** Parent death, child exit before read, retry/fallback after grant change, concurrent workers with disjoint grants and process restart; ensure no credentials appear in stderr, logs, or event records.
6. **Isolated-host qualification:** Nonroot microcloud3 tests, then explicitly authorized cross-UID and filesystem/IPC containment tests with synthetic credentials. Record negatives and unproven boundaries. Independent review required before changing GE-04 disposition.

## Stop conditions

Stop and retain HOLD if any fallback provider is reachable without a matching grant, if excluded provider credentials remain accessible through child config/environment/keyring, if an untrusted worker can forge grant expansion, or if real effects would be needed to demonstrate the test. No branch merge, production activation, or issuance authorization is implied by passing unit tests.

## Test-only grant planner implementation

`src/agents/credential-grant-planner.ts` implements `planWorkerCredentialGrant(ModelConfig)` using the existing `buildFallbackChain()` authority. It requires a concrete resolved primary model, rejects malformed provider names and fallback model names, deduplicates the primary and configured fallback providers in routing order, and freezes the returned plan. `tests/agents/credential-grant-planner.vitest.ts` exercises eight synthetic positive and fail-closed cases. The planner is **not connected** to `SubagentManager`, FD 3, `loadConfig`, or production credential resolution; it neither reads nor transfers credentials. This is an architectural unit test, **not** a worker confidentiality qualification. Dynamic selection, authorization binding and credential-store/environment bypass remain open.

## Synthetic FD-3 sender containment evidence

`src/agents/credential-grant-fixture.ts` projects synthetic provider canaries using an explicitly supplied authorized-provider set and the test-only grant plan; it rejects mismatched, duplicated or malformed provider grants. `tests/agents/ge04-credential-sender-containment.vitest.ts` spawns real Node children importing the **compiled production credential reader** over FD 3. It verifies primary-only and explicit fallback delivery, exclusion of an unrelated synthetic canary, malformed/expanded grant rejection and early child exit without canary output. These are synthetic test-only sender semantics; neither this fixture nor the grant planner is connected to the production `resolvedCredentialPayload` call. The caller-supplied authorized set is a test oracle, **not** a tamper-resistant production authorization binding. No credential-store, environment, full worker or cross-UID containment claim follows.
