# GE-04 R1 — canonical worker and credential authority design

**Status:** Design proposal requiring independent threat review; not implementation, security qualification, positive credential admission or hold clearance. **Source baseline:** PR #1052 / `4d9081d0`, with R0 inventory at `docs/security/ge04-r0-worker-execution-inventory.md`.

## Decision: one execution path, no fallback

The execution kernel must own a mandatory `WorkerSupervisor` interface for every worker-producing entry point (CLI/chat, daemon, coordination tools, HTTP, runtime builder, evaluation, restart). `SubagentManager` may remain a coordination facade only during migration, not an independent launcher or policy authority. After migration, delete the optional `ge04WorkerLifecycle`, FD3 snapshot, `--credential-fd`, worker credential reader, cooperative `--ge04-startup-fd` security mechanism, direct worker keyring inheritance and alternate worker spawn code. Unsupported platform or unavailable supervisor means **explicit refusal**, never legacy fallback. Preserve supported task functionality through new contracts, not compatibility shims.

### Trust and process ownership

1. **Trusted controller** owns durable coordination/attempt records, policy revisions, approvals and budgets. Controller cannot delegate policy authority to worker input.
2. **Privileged Linux supervisor** launches worker under a distinct restricted UID with constrained HOME, environment, mount/filesystem access, inherited FDs and outbound connectivity. Root-owned launcher binary and executable chain must be pinned/verified; verify lifetime identity, registration and revocation. Avoid depending on cooperative JavaScript startup for isolation.
3. **Trusted broker** owns secret store, credential resolution, provider transport and admission. Broker accepts AF_UNIX connections and authenticates each actual accepted peer through kernel credentials (`SO_PEERCRED`) in the trusted native boundary. A text report, `VerifiedBrokerPeer` struct or JSON-supplied PID is never attestation.
4. **Untrusted worker** owns task reasoning, tool requests and nonsecret state only. It cannot load raw `apiKeys`, access secret files/keyring, read privileged environment or make arbitrary credential-bearing provider calls. Broker sends sanitized model/tool results, never reusable keys.
5. **Broker-to-supervisor binding** resolves the authenticated peer to the live registered process generation and immutable coordination run/worker/attempt. Revalidate at effect boundary; process exit, UID mismatch, PID reuse, stale epoch or revocation denies.

## Credential flow: brokered model inference

```text
Worker (restricted UID; no keys)
  -> bounded authenticated AF_UNIX request (task / model operation; no secrets)
  -> native peer attestation and broker-owned live worker binding
  -> current governance: route, provider, approval, policy revision, budgets,
     expiry, revocation, nonce replay and effect authorization
  -> broker-owned model/provider adapter and credential store
  -> broker performs provider HTTPS request with secret in broker memory only
  -> sanitized model response/stream -> worker
```

**No worker-side `loadConfig` credential resolution.** `src/operations/config/loader.ts:189-277` currently resolves `cred://` and populates `process.env`; `src/agents/subagent-cli.ts:605-606` calls it in the worker. The replacement needs a **nonsecret task configuration projection** produced by trusted code (provider/model selection and policy-scoped capabilities, no raw `apiKeys`, tracing secrets, MCP tokens or environment secrets). Never rely on removing FD3 alone. A worker must not receive a URL to a credentialed proxy that can be used as an unrestricted capability; bind each request to a scoped operation and enforce destination, size, method, budget, response filtering and cancellation. Local/keyless models may use a separately authorized no-secret transport, not a bypass around worker governance.

**Provider registry migration:** `src/models/providers/registry.ts:82-136` accepts an `apiKey`; provider constructors such as `openai-provider.ts`, `anthropic-provider.ts`, `gemini-provider.ts` and `openrouter-provider.ts` can fall back to `process.env`. Provider construction for credentialed calls must move to the broker; worker-facing adapters must use authenticated broker requests. Model discovery (`model-resolver.ts`, `model-discovery.ts`, `catalog.ts`), streaming, fallback and routing must preserve task policy and budget semantics at each broker call. No worker-provided provider URL or route may override broker-owned policy.

## Authorization and atomicity blockers

- `worker-broker-governed-admission.ts` currently performs asynchronous authorization and then separate `replayLedger.consumeAuthenticated`. This does **not** by itself establish atomic authorization plus nonce consumption plus final external effect. Design a single broker-owned durable claim/consume operation with fencing and explicit crash/unknown-effect reconciliation before positive admission.
- `worker-broker-authorization.ts` maintains an in-memory `used` nonce set in addition to broker replay storage. Do not treat in-memory replay protection as cross-process/restart authority.
- `worker-broker-transport.ts` accepts an injected `attestPeer` callback; `worker-broker-linux-peercred.ts` currently depends on undocumented Node `socket._handle.fd` and helper stdout. Neither is a production kernel-authenticated handoff contract. Use a reviewed native socket accept/attest/dispatch boundary, or a securely transferred accepted FD with verified provenance; forbid diagnostic stdout from driving admission.
- Every stream and tool/model request needs bounded framing, cancellation, timeouts, maximum input/output, backpressure, audit attribution and safe failure on disconnect. Streaming must not permit post-revocation continuation.

## Explicit interface sketch (not code to deploy)

- `WorkerSupervisor.launch(authorizedAttempt, nonSecretConfig) -> WorkerHandle` (trusted-only; atomic registration, revocable lifetime identity, isolated process)
- `WorkerHandle.cancel()/wait()/evidence()` (no credential material)
- `BrokerModelClient.complete/stream(authorizedOperation, request)` (worker-side IPC client, no credential handles)
- `BrokerAdmission.authorizeAndClaim(kernelPeer, registeredAttempt, operation)` (broker-side durable single-use or explicitly scoped lease; never trust worker-supplied identity)
- `CredentialedModelExecutor.execute(claim, request)` (broker-only provider calls; no raw secret response)

## Implementation slices and hard gates

| Slice | Deliverable | Required verification |
| --- | --- | --- |
| R1-A | Complete source/runtime entry-point and credential-provider inventory; design/threat review | Every worker caller mapped; all secret resolution paths and direct provider calls enumerated |
| R1-B | Supervisor and native peer transport | Cross-UID negative tests, inherited-FD/keyring denial, forged peer/PID reuse rejection, authenticated provenance |
| R1-C | Nonsecret config projection + broker-owned model adapter | No `apiKeys`/secret env in worker, local and paid provider routes governed, streaming/fallback cancellation tests |
| R1-D | Durable admission/effect authorization | Concurrent nonce replay, stale approval, policy revision, crash recovery and external-effect unknown tests |
| R1-E | All-consumer migration and legacy deletion | CLI/daemon/HTTP/coordination/recovery parity; zero reachable old flags/FD3/readers; static reintroduction guard |
| R1-F | Independent security + migration qualification | Linux x86-64 real hostile worker, upgrade/restore, CPU-only and release-gate evidence; explicit hold clearance |

**Dependency:** R1-B and R1-C may be developed on isolated branches with no production admission. R1-D must precede any credential-backed positive path. R1-E is mandatory for completion, not deferred technical debt. No phase can claim a completed replacement while a production legacy path remains.

## Open questions for threat review

1. How will the native supervisor pin process identity across `exec` and PID reuse (pidfd or equivalent) while preserving daemon crash recovery?
2. What exact native IPC protocol carries requests, streams, cancellations and backpressure without trusting Node helper stdout?
3. Which credential backends and MCP/tool secrets require broker ownership beyond model API keys?
4. How will user-owned workspaces and local model runtimes be mounted/accessed without exposing HOME or secret-service sockets?
5. Which supported historical records/configurations need explicit migration and rollback tools under Q04/Q05?
6. How will the broker reconcile a provider request sent before a crash but without a durable outcome receipt, without duplicating paid or externally effectful calls?

Until these questions are resolved and tested, **GE-04 SECURITY HOLD stays active**.
