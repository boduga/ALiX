# P4.3-S — ALiX Security and Trust Hardening
## Detailed Implementation Plan

**Date:** 2026-06-17  
**Status:** Execution-ready plan  
**Target repository:** `boduga/ALiX`  
**Baseline reviewed:** `f0ab074620dba936617702946cbe8a224b0fcc5f`  
**Observability baseline:** `8367775b9b3c4be70a858333a1402faa1ad13147`  
**Source architecture:** `P4.3-S — ALiX Security and Trust Hardening`  
**Recommended branch prefix:** `security/p4-3s-*`  
**Primary implementation language:** TypeScript, Node.js 24+, ESM  
**Test framework:** `node:test` + `node:assert/strict`  
**Inspector frontend:** Existing vanilla JavaScript UI  
**Durable runtime state:** Existing `.alix/` file stores and append-only JSONL

---

## 1. Purpose

This document converts the approved P4.3-S architecture into an implementation sequence that can be executed as small, reviewable pull requests.

The work has six principal outcomes:

1. The Inspector is local-only and authenticated by default.
2. Every data-bearing Inspector route is explicitly authorized and redacted.
3. HTTP and SSE resource use remains bounded under abuse and slow clients.
4. Audit history becomes tamper-evident and safe under concurrent ALiX processes.
5. Security-sensitive configuration becomes attributable, signed, and rollback-aware.
6. The exact tested npm artifact is the artifact that is published.

This plan deliberately preserves the current ALiX runtime architecture:

- The Inspector remains read-only.
- CLI workflows remain authoritative for approvals, recovery, execution, and configuration mutation.
- The current TypeScript P4.2 observability stack remains the monitoring foundation.
- The existing event log remains the canonical session write-ahead log.
- Security features are added behind compatibility-safe migrations and explicit gates.

---

## 2. Scope

### 2.1 Included

- Inspector binding, authentication, browser sessions, authorization, and route policy
- Host, origin, proxy, TLS, HTTP parser, request, rate, and connection controls
- JSON and SSE redaction
- Shared, bounded observability and session SSE delivery
- Audit hash chaining, concurrent append coordination, verification, and checkpoints
- Credential migration and project-secret rejection
- Centralized config mutation, signing, provenance, and anti-rollback state
- Security metrics, passive health, alerts, CLI doctor, and security gate
- Dependency lifecycle-script policy, advisory exceptions, SBOM, tarball verification
- Exact-artifact publication and immutable workflow dependencies
- Threat model, adversarial tests, operator documentation, and migration documentation

### 2.2 Explicitly excluded

- Web-based approval, denial, repair, execution, or config mutation
- Replacing the Inspector frontend framework
- Encrypting all historical session event logs
- A WebSocket transport
- A second Python or SQLite monitoring stack
- A claim of protection against root/administrator compromise
- A claim that the audit chain is tamper-proof
- Remote multi-user identity federation
- OAuth/OIDC integration
- Package extraction or broad kernel refactoring

---

## 3. Non-negotiable invariants

Every pull request in this track must preserve these invariants:

1. **Default deny:** an unregistered `/api/*` route does not execute.
2. **Read-only Inspector:** no workspace or runtime mutation through HTTP.
3. **No credentials in URLs:** tokens never appear in query strings or fragments.
4. **No raw credentials at rest in the project:** project `.alix/` must not contain active raw tokens, API keys, private keys, or browser sessions.
5. **No raw credentials in external observability:** Inspector, SSE, audit, metrics, config display, exports, and support bundles are redacted.
6. **Bounded state:** rate buckets, sessions, queues, replay rings, listeners, timers, and buffers have hard limits and cleanup.
7. **Passive health:** health endpoints do not perform full verification, package audits, signing, rotation, repair, or tests.
8. **Same bytes:** signed config is verified from the exact parsed bytes subsequently used.
9. **Serialized audit append:** audit sequence assignment and append cannot race across processes.
10. **Exact artifact:** the published tarball is the tarball that passed the release gate.
11. **Closed metrics vocabulary:** security metric names, label keys, and label values are registered and bounded.
12. **Fail closed in production:** security-check crashes and invalid trust states do not degrade to silent allowance.

---

## 4. Engineering conventions

### 4.1 TypeScript

- Use `.js` import extensions.
- Avoid `any`; isolate unavoidable compatibility casts at adapters.
- Use discriminated unions for trust states, authentication methods, and security results.
- Inject clocks, ID generators, and filesystem seams where deterministic testing is required.
- Do not call `Date.now()` directly in core security logic when a clock can be passed.
- Never compare secret strings directly; compare fixed-length digests with constant-time comparison.
- Do not log caught objects before passing them through the redactor.

### 4.2 Filesystem

- Use atomic temp-file write followed by same-filesystem rename.
- Use `lstat`, realpath containment, and symlink checks before sensitive writes.
- Create user-state directories with restrictive permissions.
- Verify permissions after sensitive writes.
- Keep Windows ACL uncertainty explicit in `security doctor`.
- Do not assume a small append is atomically correct across all supported filesystems.

### 4.3 HTTP

- Validate the route descriptor before authentication.
- Validate `Host`, method, URL length, and basic headers before expensive work.
- Apply pre-auth abuse controls before token verification.
- Apply post-auth controls by principal and route class.
- Use explicit secure response APIs.
- Return stable public error codes, not internal exception messages.
- Reject GET bodies.
- Bound authentication request bodies.

### 4.4 Metrics and audit

- Never use token IDs, request IDs, run IDs, worker IDs, file paths, raw routes, raw hosts, raw origins, or full client addresses as metric labels.
- Never include raw secret values or secret digests in user-visible evidence.
- Security audit append failure must not recursively append another audit record.
- Redaction failure must produce a safe replacement, not the original object.

---

## 5. Branching and delivery model

### 5.1 Branch rules

Use one branch per pull request:

```text
security/p4-3s0-loopback-boundary
security/p4-3sa-redaction
security/p4-3sa-metric-registry
security/p4-3sb-route-policy
security/p4-3sb-token-auth
security/p4-3sb-browser-session
security/p4-3sc-network-policy
security/p4-3sc-stream-hubs
security/p4-3sd-audit-chain
security/p4-3sd-audit-verifier
security/p4-3se-credentials
security/p4-3se-config-provenance
security/p4-3se-config-signing
security/p4-3sf-supply-chain
security/p4-3sg-security-gate
security/p4-3sg-docs-reconciliation
```

### 5.2 Pull request limits

A security PR should normally:

- Introduce one new trust boundary or one migration.
- Include tests for the exact security claim.
- Avoid unrelated formatting and refactoring.
- Include migration/compatibility notes.
- Include an evidence section in the PR description.
- State the rollback mechanism.
- Avoid combining authentication, audit migration, config migration, and release changes.

### 5.3 Required PR evidence

Each PR must attach or paste:

- `npm run typecheck`
- Relevant focused test command
- Relevant integration or stress command
- `npm run build`
- A security acceptance checklist for that PR
- Any configuration before/after example
- Any migration output example
- Resource evidence where the PR claims bounded behavior

---

## 6. Dependency graph

```text
Baseline capture
    |
    v
P4.3-S0  Loopback boundary correction
    |
    v
P4.3-Sa1 Redaction foundation
    |
    +---------------------+
    |                     |
    v                     v
P4.3-Sa2 Metrics       P4.3-Sb1 Route registry
    |                     |
    |                     v
    |                 P4.3-Sb2 Token auth
    |                     |
    |                     v
    |                 P4.3-Sb3 Browser sessions
    |                     |
    +----------+----------+
               |
               v
        P4.3-Sc Network controls
               |
               v
        P4.3-Sc Shared SSE hubs
               |
       +-------+--------+
       |                |
       v                v
P4.3-Sd Audit      P4.3-Se Credentials
       |                |
       v                v
P4.3-Sd Verify     P4.3-Se Mutation/provenance
                        |
                        v
                  P4.3-Se Signing/rollback
       \                /
        \              /
         v            v
        P4.3-Sf Supply chain
               |
               v
        P4.3-Sg Threat model, gate, docs
```

P4.3-Sd and P4.3-Se may proceed in parallel after the Inspector boundary and redaction foundation are stable.

---

## 7. Status vocabulary

Use these task states consistently:

- `[ ] Not started`
- `[-] In progress`
- `[x] Complete`
- `[!] Blocked`
- `[~] Deferred`
- `[?] Decision required`

A milestone is complete only after:

1. Implementation is merged.
2. Focused and integration tests pass.
3. Documentation is updated.
4. Migration behavior is demonstrated.
5. Security evidence is captured.
6. The milestone gate is green.

---

# 8. Preflight — Baseline Capture and Repository Inventory

## 8.1 Objective

Create a reproducible pre-security baseline and an inventory of every route, config writer, secret-bearing field, audit writer, metrics emitter, and release path.

## 8.2 Tasks

### Repository baseline

- [ ] Record the starting commit SHA.
- [ ] Create a tag or protected baseline branch for P4.3-S work.
- [ ] Run `npm ci`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:unit:node`.
- [ ] Run `npm run test:integration`.
- [ ] Run `npm run test:soak:quick`.
- [ ] Run `node dist/src/cli.js doctor`.
- [ ] Capture all baseline failures separately from P4.3-S regressions.

### Route inventory

- [ ] Enumerate every path handled in `src/server/server.ts`.
- [ ] Enumerate every path handled by coordination routes.
- [ ] Enumerate every path handled by observability routes.
- [ ] Enumerate static asset routes.
- [ ] Classify each route as public, authenticated read, expensive read, or SSE.
- [ ] Confirm no existing state-changing HTTP route exists.
- [ ] Add a checked-in route inventory fixture used later by route coverage tests.

### Config writer inventory

- [ ] Search for `writeFile`, `appendFile`, `rename`, and config path construction.
- [ ] Inventory `set-default-model`.
- [ ] Inventory `set-tier`.
- [ ] Inventory MCP add/remove/discover.
- [ ] Inventory model profile apply/install.
- [ ] Inventory init/onboarding writers.
- [ ] Inventory tests and helper writers.
- [ ] Mark each production writer that must migrate to `ConfigMutationService`.

### Credential inventory

- [ ] Identify all uses of `apiKeys`.
- [ ] Identify MCP `headers` and `env` fields.
- [ ] Identify model/provider credentials in environment variables.
- [ ] Identify config display and export paths.
- [ ] Identify support bundle paths.
- [ ] Verify `.gitignore` coverage for current runtime secret locations.
- [ ] Define legacy credential migration fixtures.

### Audit inventory

- [ ] Identify all `AuditStore.append()` call sites.
- [ ] Inventory current `AuditAction` values.
- [ ] Measure a representative large audit log read.
- [ ] Identify all callers depending on newest-first ordering.
- [ ] Create fixtures for legacy valid, malformed, truncated, and concurrent audit logs.

### Metrics inventory

- [ ] Inventory `MinimalMetrics` names and emitters.
- [ ] Inventory `MetricsStore` writers.
- [ ] Inventory telemetry normalization call sites.
- [ ] Confirm whether a concrete `TelemetrySink` exists.
- [ ] Inventory health, alert, trend, cost, CLI, TUI, REST, and SSE consumers.
- [ ] Record current metric ordering and filter behavior.

### Release inventory

- [ ] Record every CI workflow action and version reference.
- [ ] Inventory install/build/test/release commands.
- [ ] Inventory lifecycle scripts in the resolved dependency tree.
- [ ] Record current `npm pack` contents.
- [ ] Record current publish sequence.
- [ ] Verify whether the packed smoke-tested artifact is retained.

## 8.3 Deliverables

```text
docs/security/baseline-inventory.md
tests/fixtures/security/route-inventory.json
tests/fixtures/security/config-writers.json
tests/fixtures/security/legacy-audit/
tests/fixtures/security/legacy-config/
```

## 8.4 Gate

- [ ] Baseline test results are recorded.
- [ ] Every current API route is inventoried.
- [ ] Every current production config writer is inventoried.
- [ ] Every current credential-bearing configuration field is inventoried.
- [ ] Current audit, metrics, and publish paths are documented.
- [ ] No P4.3-S implementation begins with an unknown route or config writer.

---

# 9. P4.3-S0 — Immediate Boundary Correction

## 9.1 Objective

Remove the highest-risk current exposure: an unauthenticated Inspector that binds to all interfaces by default.

## 9.2 Prerequisites

- Preflight inventory complete.
- Current server and config tests passing or baseline failures documented.

## 9.3 Implementation tasks

### S0.1 Change the default binding

Files:

```text
src/config/defaults.ts
tests/config-loader.test.ts
tests/config/fresh-install-onboarding.test.ts
```

Tasks:

- [ ] Change `ui.host` from `0.0.0.0` to `127.0.0.1`.
- [ ] Confirm a fresh config inherits loopback.
- [ ] Preserve an explicitly configured host.
- [ ] Add a migration warning for explicit `0.0.0.0`.
- [ ] Ensure `alix serve` displays the actual bound URL.
- [ ] Ensure browser-open logic handles `127.0.0.1`.

### S0.2 Add preliminary UI security schema

Files:

```text
src/config/schema.ts
src/config/defaults.ts
src/config/loader.ts
src/config/validator.ts
tests/config-loader.test.ts
tests/config-validator.test.ts
```

Add a compatibility-safe shape:

```typescript
type UiSecurityConfig = {
  authentication: "required" | "disabled-loopback-development";
  remoteAccess: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
  trustedProxyCidrs: string[];
  requireTlsForRemote: boolean;
};
```

Tasks:

- [ ] Add `ui.security` as an optional input with secure defaults.
- [ ] Merge nested `ui.security` values correctly.
- [ ] Warn when authentication is disabled.
- [ ] Reject authentication-disabled mode on non-loopback hosts.
- [ ] Reject `remoteAccess: false` with a non-loopback host in production mode.
- [ ] Preserve compatibility for existing configs that have no `ui.security`.

### S0.3 Add preliminary Host policy

Files:

```text
src/security/inspector/host-policy.ts
src/server/server.ts
tests/security/inspector/host-policy.test.ts
tests/server/server.test.ts
```

Tasks:

- [ ] Parse and normalize the `Host` header.
- [ ] Allow configured loopback forms by default.
- [ ] Support IPv6 loopback.
- [ ] Reject an absent Host for HTTP/1.1 API requests.
- [ ] Reject malformed hosts and ports.
- [ ] Reject an unapproved hostname before route execution.
- [ ] Keep `/healthz` minimal but subject to Host validation.
- [ ] Return a stable `invalid_host` error for APIs.
- [ ] Do not include the rejected raw Host in metrics.

### S0.4 Add baseline response headers

Files:

```text
src/server/server.ts
src/server/security-headers.ts
tests/server/server.test.ts
```

Tasks:

- [ ] Add `X-Content-Type-Options: nosniff`.
- [ ] Add `Referrer-Policy: no-referrer`.
- [ ] Add `Permissions-Policy`.
- [ ] Add `Cross-Origin-Resource-Policy: same-origin`.
- [ ] Add `Cache-Control: no-store` to API responses.
- [ ] Add `frame-ancestors 'none'` through CSP.
- [ ] Inventory inline scripts/styles before final CSP enforcement.
- [ ] Ensure SSE keeps `Cache-Control: no-cache` and `X-Accel-Buffering: no`.

### S0.5 Add secure startup validation

Files:

```text
src/security/inspector/remote-access-policy.ts
src/cli.ts
src/cli/commands/security.ts
tests/cli/serve-security.test.ts
```

Tasks:

- [ ] Resolve whether the configured host is loopback.
- [ ] Refuse insecure remote startup in production mode.
- [ ] Print a high-visibility warning in approved development mode.
- [ ] Include the exact remediation fields required.
- [ ] Do not print tokens or credentials.
- [ ] Add a `security doctor` placeholder that reports boundary state.

### S0.6 Documentation

Files:

```text
README.md
docs/configuration.md
docs/security/inspector-security.md
```

Tasks:

- [ ] Correct all statements about the default Inspector URL.
- [ ] Document explicit remote access as opt-in.
- [ ] Document that remote access is not yet approved until authentication lands.
- [ ] Document the compatibility behavior for existing `0.0.0.0` configs.

## 9.4 Tests

Run:

```bash
npm run typecheck
npm run build
node --test dist/tests/security/inspector/host-policy.test.js
node --test dist/tests/server/server.test.js
node --test dist/tests/config-loader.test.js
```

Required cases:

- [ ] Fresh install binds to `127.0.0.1`.
- [ ] Explicit `127.0.0.1`, `localhost`, and `::1` work.
- [ ] Explicit `0.0.0.0` fails or warns according to mode.
- [ ] Disallowed Host is rejected before route handling.
- [ ] `/healthz` returns only `OK`.
- [ ] API responses include baseline security headers.
- [ ] Existing config without `ui.security` still loads.

## 9.5 Evidence

- [ ] `ss`, `netstat`, or platform equivalent shows only loopback on fresh config.
- [ ] A request using a foreign Host header is rejected.
- [ ] A browser can still load the local Inspector shell.
- [ ] No data route has become public accidentally.

## 9.6 Rollback

Rollback consists of reverting only the default host and preliminary policy files. No durable migration is performed in S0.

## 9.7 Completion gate

- [ ] Fresh ALiX does not listen on a non-loopback interface.
- [ ] Unsafe remote startup fails closed in production.
- [ ] Host validation and security headers are tested.
- [ ] Documentation matches behavior.

---

# 10. P4.3-Sa1 — Redaction Foundation

## 10.1 Objective

Create a reusable, non-throwing, bounded detector and redactor that can protect all external security surfaces.

## 10.2 Design deliverables

```text
src/security/redaction/classifications.ts
src/security/redaction/secret-detector.ts
src/security/redaction/redaction-policy.ts
src/security/redaction/redactor.ts
src/security/redaction/profiles.ts
src/security/redaction/safe-error.ts
tests/security/redaction/
```

## 10.3 Detailed tasks

### Sa1.1 Define classifications and profiles

- [ ] Define the closed `RedactionClassification` union.
- [ ] Define profiles: `public`, `operational`, `administrative`, `support_bundle`.
- [ ] Define which classifications each profile removes.
- [ ] Define stable replacement markers.
- [ ] Define a safe truncated-value representation.
- [ ] Define maximum depth, properties, arrays, strings, and output bytes.

### Sa1.2 Build the detector

- [ ] Port useful explicit patterns from `SecretScanner`.
- [ ] Remove raw source-line context from findings.
- [ ] Return only spans, classification, and confidence.
- [ ] Add Authorization, Proxy-Authorization, Cookie, and Set-Cookie detection.
- [ ] Add credential URL detection.
- [ ] Add JWT detection.
- [ ] Add private-key block detection.
- [ ] Keep high-entropy detection disabled by default.
- [ ] Add custom-pattern support without allowing unbounded regex execution.
- [ ] Guard against catastrophic regex behavior with input size limits and safe patterns.
- [ ] Ensure global regex state is reset per scan.

### Sa1.3 Build structural redaction

- [ ] Redact primitives, arrays, plain objects, maps, and sets safely.
- [ ] Preserve harmless scalar types.
- [ ] Handle Date and Error explicitly.
- [ ] Handle BigInt through a safe string representation.
- [ ] Handle cycles with `WeakSet`.
- [ ] Catch throwing getters and proxies.
- [ ] Avoid invoking arbitrary `toJSON()` on untrusted values.
- [ ] Limit recursion depth.
- [ ] Limit object property count.
- [ ] Limit array count.
- [ ] Limit string scan length.
- [ ] Limit total serialized output.
- [ ] Redact exact normalized sensitive key names.
- [ ] Avoid broad `key` substring matching.
- [ ] Ensure explicit secret patterns override allowlists.
- [ ] Never return the original input when redaction fails.

### Sa1.4 Refactor the existing SecretScanner

- [ ] Preserve compatibility for policy code that only needs `hasSecret`.
- [ ] Replace or deprecate `context` and raw match exposure.
- [ ] Ensure findings stored or displayed by policy cannot contain source secrets.
- [ ] Add a compatibility adapter if existing tests rely on `SecretFinding`.
- [ ] Document the deprecation.

### Sa1.5 Add safe error projection

- [ ] Define stable error codes.
- [ ] Map internal exceptions to safe public errors.
- [ ] Redact internal error details before local logging.
- [ ] Preserve request ID for operator correlation.
- [ ] Never return stack traces through the Inspector.

## 10.4 Tests

Required suites:

```text
tests/security/redaction/secret-detector.test.ts
tests/security/redaction/redactor.test.ts
tests/security/redaction/redactor-limits.test.ts
tests/security/redaction/redactor-errors.test.ts
tests/security/redaction/false-positives.test.ts
```

Required cases:

- [ ] OpenAI, Google, AWS, GitHub, Slack, bearer, basic auth, JWT, PEM.
- [ ] Secrets nested in arrays and objects.
- [ ] Headers and cookies.
- [ ] Credential-bearing URLs.
- [ ] Secret in Error message and cause.
- [ ] Cyclic graph.
- [ ] Throwing getter.
- [ ] Proxy trap failure.
- [ ] Huge string.
- [ ] Huge array.
- [ ] Deep object.
- [ ] `keyboardLayout`, `monkeyPatch`, and other benign key names.
- [ ] Explicit secret pattern in an otherwise allowlisted field.
- [ ] Redactor internal failure yields a safe sentinel.

## 10.5 Gate

- [ ] No detector result contains raw source context.
- [ ] Redaction cannot throw through a response path.
- [ ] Redaction limits are deterministic.
- [ ] False-positive fixtures pass.
- [ ] Existing policy secret checks continue to work.

---

# 11. P4.3-Sa2 — Closed Metrics Registry and Security Telemetry

## 11.1 Objective

Extend the current P4.2 observability system instead of creating a parallel monitoring subsystem.

## 11.2 Files

```text
src/observability/metric-registry.ts
src/observability/security-telemetry.ts
src/observability/telemetry-envelope.ts
src/observability/metrics-store.ts
src/observability/observability-config.ts
tests/observability/metric-registry.test.ts
tests/observability/security-telemetry.test.ts
tests/observability/metrics-store.test.ts
```

## 11.3 Detailed tasks

### Sa2.1 Define metric descriptors

```typescript
type MetricDefinition = {
  name: string;
  type: MetricType;
  unit: string;
  description: string;
  allowedLabelKeys: readonly string[];
  allowedLabelValues?: Record<string, readonly string[]>;
};
```

- [ ] Register all existing production metric names.
- [ ] Register the approved security metric names.
- [ ] Reject unknown names in strict production mode.
- [ ] Provide a compatibility warning mode for legacy metrics.
- [ ] Validate type against descriptor.
- [ ] Validate label keys.
- [ ] Validate enum values.
- [ ] Reject labels above the key limit.
- [ ] Reject overlong label values.
- [ ] Reject non-finite values.

### Sa2.2 Add security category

- [ ] Add `"security"` to `TelemetryCategory`.
- [ ] Map `security.*` event prefixes to the security category.
- [ ] Map `security_` metric names to the security category.
- [ ] Add tests for category inference.
- [ ] Preserve schema compatibility or increment schema version explicitly.

### Sa2.3 Build SecurityTelemetry adapter

Provide methods that do not accept arbitrary labels:

```typescript
securityTelemetry.authAttempt(result, method)
securityTelemetry.authorizationDenied(permission, routeClass)
securityTelemetry.rateLimitRejected(routeClass, scope)
securityTelemetry.redaction(classification, sink)
securityTelemetry.sseActive(stream, value)
securityTelemetry.auditAppend(result)
securityTelemetry.configVerification(state)
securityTelemetry.securityGate(result, durationMs)
```

- [ ] Construct label enums internally.
- [ ] Redact any payload before persistence.
- [ ] Avoid IDs and client addresses as labels.
- [ ] Make emission failure non-fatal to request execution.
- [ ] Expose an in-memory fake for tests.

### Sa2.4 Correct MetricsStore query semantics

- [ ] Move metric-name filtering into the store query.
- [ ] Define ascending or descending order explicitly.
- [ ] Apply `limit` after filters.
- [ ] Add safe maximum limits.
- [ ] Stream all reads.
- [ ] Preserve retention race handling.
- [ ] Document ordering for REST and CLI consumers.

### Sa2.5 Reconcile documentation

- [ ] Mark the Python metrics catalog as legacy.
- [ ] Create the TypeScript metrics catalog.
- [ ] Document every security metric, type, labels, source, and alert use.
- [ ] Document that WASM metrics remain deferred unless WASM is an active runtime.

## 11.4 Gate

- [ ] Security telemetry uses the current JSONL MetricsStore.
- [ ] Unknown security metric names fail validation.
- [ ] Label cardinality is bounded by both keys and value vocabulary.
- [ ] No security metric label contains a path, ID, raw route, token, or address.
- [ ] Metrics API filtering and limits are correct.

---

# 12. P4.3-Sb1 — Route Security Registry and Secure Response Context

## 12.1 Objective

Replace scattered route security assumptions with one complete, testable, default-deny route registry.

## 12.2 Files

```text
src/security/inspector/route-policy.ts
src/security/inspector/security-context.ts
src/security/inspector/authorization.ts
src/server/secure-response.ts
src/server/security-middleware.ts
src/server/server.ts
src/server/coordination-routes.ts
src/observability/observability-routes.ts
tests/security/inspector/route-policy.test.ts
tests/security/inspector/authorization.test.ts
tests/server/route-coverage.test.ts
```

## 12.3 Detailed tasks

### Sb1.1 Define route descriptors

- [ ] Define route IDs.
- [ ] Define exact method.
- [ ] Define path matcher.
- [ ] Define authentication mode.
- [ ] Define required permission.
- [ ] Define route class.
- [ ] Define redaction profile.
- [ ] Define streaming flag.
- [ ] Define maximum query/result characteristics where relevant.

### Sb1.2 Register every current route

- [ ] Static shell and assets.
- [ ] `/healthz`.
- [ ] Graph list and projection.
- [ ] Registry agents/tools.
- [ ] Policy list/eval.
- [ ] Daemon status/tasks.
- [ ] Approvals list.
- [ ] Runtime events.
- [ ] Audit list/filter.
- [ ] Session compare/snapshot/events.
- [ ] Observability health/metrics/alerts/stream.
- [ ] Coordination routes.
- [ ] Authentication session/logout routes when added.
- [ ] Passive security status route when added.

### Sb1.3 Add coverage enforcement

- [ ] Add a test that enumerates server route registrations.
- [ ] Compare against the route policy registry.
- [ ] Fail when an API route is implemented without a descriptor.
- [ ] Fail when a descriptor points to no implemented route.
- [ ] Fail when a data-bearing API route is marked public.
- [ ] Fail when a P4.3-S route uses an unsupported mutation method.

### Sb1.4 Build secure JSON response API

```typescript
interface SecureJsonResponder {
  ok(value: unknown, profile?: RedactionProfile): void;
  error(code: string, status: number, details?: unknown): void;
}
```

- [ ] Redact before serialization.
- [ ] Apply `Cache-Control: no-store`.
- [ ] Apply content type and security headers.
- [ ] Enforce output byte limits.
- [ ] Provide safe error fallback if serialization fails.
- [ ] Record redaction metrics without recursive output.
- [ ] Prevent direct data API use of `res.end(JSON.stringify(...))`.

### Sb1.5 Refactor route contexts

- [ ] Make coordination route registration async and context-aware.
- [ ] Make observability handlers consume the security context.
- [ ] Move URL parsing to one trusted location.
- [ ] Move error normalization to one trusted location.
- [ ] Validate path parameters before filesystem construction.
- [ ] Preserve current read-only behavior and response compatibility where safe.

## 12.4 Tests

- [ ] Every route has the expected permission.
- [ ] Unknown API route is denied.
- [ ] No data route is public.
- [ ] Public health contains no details.
- [ ] Secure responder redacts nested secrets.
- [ ] Secure responder handles cyclic values.
- [ ] Internal exceptions do not reach clients.
- [ ] Existing valid route output remains structurally usable.

## 12.5 Gate

- [ ] Route coverage test proves complete registration.
- [ ] All data routes pass through a secure response context.
- [ ] Default deny is active.
- [ ] Inspector remains read-only.

---

# 13. P4.3-Sb2 — Token Store, Bearer Authentication, and CLI

## 13.1 Objective

Add user-scoped, hash-only Inspector credentials for API clients.

## 13.2 Files

```text
src/security/inspector/auth-store.ts
src/security/inspector/auth-service.ts
src/security/inspector/token-format.ts
src/security/platform/user-state-paths.ts
src/cli/commands/security.ts
src/cli.ts
tests/security/inspector/auth-store.test.ts
tests/security/inspector/auth-service.test.ts
tests/cli/inspector-auth.test.ts
```

## 13.3 Detailed tasks

### Sb2.1 Platform state directory

- [ ] Implement Linux XDG state resolution.
- [ ] Implement macOS Application Support resolution.
- [ ] Implement Windows LocalAppData resolution.
- [ ] Provide deterministic test overrides.
- [ ] Create directories with restrictive permissions.
- [ ] Verify non-symlink location and containment.

### Sb2.2 Token generation and parsing

- [ ] Generate 32 random bytes.
- [ ] Encode base64url without padding.
- [ ] Generate opaque token ID.
- [ ] Format `alix_i_<id>_<secret>`.
- [ ] Strictly parse prefix, ID, and secret.
- [ ] Reject oversized or malformed tokens before hashing.
- [ ] Hash with SHA-256.
- [ ] Compare fixed-length buffers using constant-time comparison.

### Sb2.3 Auth store

- [ ] Store hash and metadata only.
- [ ] Use atomic write.
- [ ] Restrict permissions.
- [ ] Reject symlinked auth files.
- [ ] Add schema version.
- [ ] Add token name, role, workspace IDs, expiry, rotation metadata, revocation.
- [ ] Bound token count.
- [ ] Add cleanup for expired/revoked records.
- [ ] Never display token hashes.

### Sb2.4 Rotation and revocation

- [ ] Create new token without deleting the old verifier.
- [ ] Set grace window on old token.
- [ ] Reject old token after grace.
- [ ] Revoke immediately when requested.
- [ ] Audit token lifecycle without raw token.
- [ ] Emit bounded security telemetry.

### Sb2.5 CLI

```text
alix inspector auth create --name <name> --role <role>
alix inspector auth list
alix inspector auth rotate <token-id> --grace <duration>
alix inspector auth revoke <token-id>
alix inspector auth doctor
```

- [ ] Display raw token exactly once.
- [ ] Warn the operator to store it securely.
- [ ] Support `--json` without including raw token except create/rotate result.
- [ ] Confirm revocation interactively unless `--yes`.
- [ ] Redact command errors.

### Sb2.6 Bearer authentication middleware

- [ ] Parse one Authorization header.
- [ ] Reject multiple/combined credentials.
- [ ] Require `Bearer`.
- [ ] Reject token in query string.
- [ ] Validate workspace scope.
- [ ] Validate expiry, grace, and revocation.
- [ ] Return a principal without carrying the raw token.
- [ ] Emit success/failure audit according to retention policy.
- [ ] Emit bounded metrics.

## 13.4 Tests

- [ ] Create/list/rotate/revoke.
- [ ] Raw token is not persisted.
- [ ] Hash is not printed.
- [ ] Wrong ID and wrong secret.
- [ ] Constant-length comparison path.
- [ ] Expiry and grace.
- [ ] Workspace mismatch.
- [ ] Store permission failure.
- [ ] Interrupted atomic write.
- [ ] Symlink attack.
- [ ] Token count bound.
- [ ] Query-string token rejection.

## 13.5 Gate

- [ ] Bearer-authenticated curl client can read an allowed route.
- [ ] Missing or invalid token cannot read any data route.
- [ ] Raw tokens exist only at creation/rotation output.
- [ ] Auth state is outside the project workspace.

---

# 14. P4.3-Sb3 — Browser Session Exchange and Inspector Login

## 14.1 Objective

Support browser REST and native EventSource without query-string or browser-storage credentials.

## 14.2 Files

```text
src/security/inspector/browser-session-store.ts
src/security/inspector/auth-service.ts
src/server/auth-routes.ts
src/ui/index.html
src/ui/app.js
src/ui/styles.css
tests/security/inspector/browser-session.test.ts
tests/server/auth-routes.test.ts
tests/inspector-stream.test.ts
```

## 14.3 Detailed tasks

### Sb3.1 Session store

- [ ] Generate opaque session IDs.
- [ ] Store sessions in memory only.
- [ ] Bind session to principal, workspace, creation, expiry, and idle expiry.
- [ ] Bound total session count.
- [ ] Use LRU/expiry cleanup.
- [ ] Invalidate all sessions on server restart.
- [ ] Invalidate principal sessions on token revocation where practical.
- [ ] Never persist session cookies.

### Sb3.2 Session exchange endpoint

`POST /api/auth/session`

- [ ] Enforce strict body size.
- [ ] Accept token only in the request body or Authorization header.
- [ ] Validate same-origin policy.
- [ ] Apply auth route rate limit.
- [ ] Create session after token validation.
- [ ] Set `HttpOnly`.
- [ ] Set `SameSite=Strict`.
- [ ] Set `Path=/`.
- [ ] Set `Secure` when HTTPS.
- [ ] Avoid echoing token.
- [ ] Return principal role and safe session expiry only.

### Sb3.3 Logout endpoint

`POST /api/auth/logout`

- [ ] Require an active browser session.
- [ ] Remove the session.
- [ ] Expire the cookie.
- [ ] Remain idempotent.
- [ ] Audit logout without sensitive data.

### Sb3.4 UI login

- [ ] Show login form when API returns 401.
- [ ] Submit token directly to session exchange.
- [ ] Do not store token in localStorage or sessionStorage.
- [ ] Clear token input after response.
- [ ] Handle expired session by returning to login.
- [ ] Preserve intended view after successful login.
- [ ] Provide a logout control.
- [ ] Avoid token-bearing browser console logs.
- [ ] Update CSP-compatible UI code.

### Sb3.5 Cookie authentication

- [ ] Parse only the named ALiX session cookie.
- [ ] Ignore unrelated cookies.
- [ ] Validate expiry and workspace.
- [ ] Enforce Origin/Fetch Metadata on cookie-authenticated requests.
- [ ] Allow native EventSource to authenticate with the cookie.
- [ ] Ensure Bearer auth and session auth produce the same principal shape.

## 14.4 Tests

- [ ] Valid exchange creates cookie.
- [ ] Invalid exchange does not create cookie.
- [ ] Cookie flags are correct.
- [ ] Secure flag behavior follows transport.
- [ ] Session expiry and idle expiry.
- [ ] Server restart invalidates session.
- [ ] Logout is idempotent.
- [ ] Token never enters browser storage.
- [ ] Native EventSource receives authenticated data.
- [ ] Cross-origin cookie request is rejected.
- [ ] Session store remains bounded.

## 14.5 Gate

- [ ] Browser Inspector can authenticate and stream using an HttpOnly cookie.
- [ ] No URL or browser-storage token is used.
- [ ] Curl/SDK Bearer authentication remains functional.
- [ ] Session state is bounded and ephemeral.

---

# 15. P4.3-Sc1 — Host, Origin, Proxy, TLS, HTTP, and Rate Controls

## 15.1 Objective

Harden the complete network boundary and bound abusive request state.

## 15.2 Files

```text
src/security/inspector/host-policy.ts
src/security/inspector/origin-policy.ts
src/security/inspector/client-address.ts
src/security/inspector/remote-access-policy.ts
src/security/inspector/rate-limiter.ts
src/security/inspector/connection-limiter.ts
src/server/http-limits.ts
src/server/security-middleware.ts
src/config/schema.ts
src/config/defaults.ts
src/config/validator.ts
tests/security/inspector/
tests/stress/inspector-abuse.test.ts
```

## 15.3 Detailed tasks

### Sc1.1 Final Host policy

- [ ] Define exact default loopback hosts.
- [ ] Support configured exact remote hostnames.
- [ ] Normalize case and port.
- [ ] Reject userinfo, path, invalid Unicode, and malformed bracketed IPv6.
- [ ] Reject DNS-rebinding Host values.
- [ ] Avoid reflecting raw Host in errors.

### Sc1.2 Origin and Fetch Metadata

- [ ] Accept same-origin requests.
- [ ] Accept configured exact origins.
- [ ] Forbid wildcard origins with credentials.
- [ ] Permit non-browser Bearer clients with no Origin.
- [ ] Require same-origin for cookie-authenticated requests.
- [ ] Validate `Sec-Fetch-Site` where present.
- [ ] Reject `null` origin for credentialed requests unless explicitly designed.
- [ ] Add Vary headers where relevant.

### Sc1.3 Trusted proxy handling

- [ ] Parse configured CIDRs.
- [ ] Trust forwarding headers only when peer address is in an approved CIDR.
- [ ] Normalize the selected client address.
- [ ] Bound forwarded chain length.
- [ ] Reject malformed forwarding headers.
- [ ] Report proxy-policy uncertainty in doctor.
- [ ] Do not support `trustedProxy: true`.

### Sc1.4 Remote TLS policy

- [ ] Detect loopback versus non-loopback bind.
- [ ] Detect direct TLS or trusted proxy termination evidence.
- [ ] Reject cleartext remote Bearer authentication.
- [ ] Require secure cookies remotely.
- [ ] Require exact allowed origins and hosts remotely.
- [ ] Add startup validation and doctor checks.

### Sc1.5 HTTP parser and server bounds

- [ ] Configure maximum header size.
- [ ] Configure headers timeout.
- [ ] Configure request timeout.
- [ ] Configure keep-alive timeout.
- [ ] Configure maximum requests per socket.
- [ ] Enforce maximum URL length.
- [ ] Reject GET bodies.
- [ ] Enforce auth body limit.
- [ ] Handle slow-header attack tests.

### Sc1.6 Two-stage rate limiter

- [ ] Use monotonic time.
- [ ] Implement token bucket.
- [ ] Bound bucket count.
- [ ] Evict idle buckets.
- [ ] Evict oldest-idle bucket at cap.
- [ ] Normalize IPv4 and IPv6.
- [ ] Bound key length.
- [ ] Implement pre-auth address + route-class limits.
- [ ] Implement post-auth principal + address + route-class limits.
- [ ] Emit `Retry-After`.
- [ ] Emit safe rate-limit headers.
- [ ] Add fake-clock deterministic tests.

### Sc1.7 Connection limiter

- [ ] Bound total active SSE.
- [ ] Bound per principal.
- [ ] Bound per address.
- [ ] Reserve/release atomically in-process.
- [ ] Ensure cleanup is idempotent.
- [ ] Add diagnostics counters.

## 15.4 Tests

- [ ] DNS rebinding Host.
- [ ] Foreign Host.
- [ ] Disallowed Origin.
- [ ] Wildcard credential origin.
- [ ] Forged forwarding header.
- [ ] Trusted proxy outside CIDR.
- [ ] Remote HTTP Bearer attempt.
- [ ] Oversized headers and URL.
- [ ] Slow header delivery.
- [ ] Random-key bucket flood.
- [ ] IPv4/IPv6 normalization.
- [ ] Rate refill and burst.
- [ ] Global/per-principal/per-address connection caps.

## 15.5 Gate

- [ ] Network boundary fails closed remotely.
- [ ] Local Bearer and browser sessions continue to work.
- [ ] Rate state and connection state are bounded.
- [ ] Proxy headers are never trusted implicitly.
- [ ] Stress test shows no unbounded map growth.

---

# 16. P4.3-Sc2 — Shared Observability and Session SSE Hubs

## 16.1 Objective

Remove per-client expensive work, whole-file polling, and unbounded slow-client behavior.

## 16.2 Files

```text
src/server/secure-sse.ts
src/server/observability-stream-hub.ts
src/server/session-stream-hub.ts
src/server/observability-stream.ts
src/server/server.ts
tests/server/observability-stream.test.ts
tests/inspector-stream.test.ts
tests/stress/inspector-abuse.test.ts
tests/soak/inspector-stream-soak.test.ts
```

## 16.3 Detailed tasks

### Sc2.1 Secure SSE connection

- [ ] Apply SSE headers only after authentication and authorization.
- [ ] Serialize through the redactor.
- [ ] Enforce per-event byte limit.
- [ ] Enforce total buffered bytes.
- [ ] Enforce buffered event count.
- [ ] Observe `res.write()` backpressure.
- [ ] Wait for `drain`.
- [ ] Disconnect after backpressure timeout.
- [ ] Maintain one idempotent cleanup function.
- [ ] Track heartbeat and lifetime timers.
- [ ] Release limiter reservations on all close/error paths.

### Sc2.2 Observability stream hub

- [ ] Create one producer per Inspector server instance.
- [ ] Reuse health snapshot service.
- [ ] Reuse alert evaluation state appropriately.
- [ ] Read metric samples once per cycle.
- [ ] Run anomaly detection once per cycle.
- [ ] Redact before replay storage.
- [ ] Store immutable redacted events.
- [ ] Maintain bounded replay ring.
- [ ] Maintain server epoch and sequence.
- [ ] Fan out without per-client recomputation.
- [ ] Start and stop with server lifecycle.

### Sc2.3 Session stream hub

- [ ] Create one tailer per session.
- [ ] Share tailer among subscribers.
- [ ] Read incrementally from byte offset.
- [ ] Maintain bounded partial-line buffer.
- [ ] Handle file creation after subscription.
- [ ] Handle truncation and replacement.
- [ ] Validate session ID before path construction.
- [ ] Parse and filter visible events.
- [ ] Redact before replay/fan-out.
- [ ] Stop tailer when no subscribers remain after idle grace.

### Sc2.4 Replay semantics

Observability:

```text
<server-epoch>:<sequence>
```

Session:

```text
non-negative event sequence integer
```

- [ ] Validate malformed IDs.
- [ ] Handle old epoch.
- [ ] Handle cursor below replay floor.
- [ ] Handle cursor above head.
- [ ] Send explicit `replay.reset` where required.
- [ ] Bound replay count.

### Sc2.5 Resource instrumentation

- [ ] Gauge active SSE by stream type.
- [ ] Counter rejected connections by bounded reason.
- [ ] Counter disconnects by bounded reason.
- [ ] Track hub subscribers internally for doctor.
- [ ] Expose no client IDs as metric labels.

## 16.4 Tests

- [ ] 25 clients use one producer cycle.
- [ ] Health/metrics/anomaly call counts do not scale with client count.
- [ ] Slow client disconnects after timeout.
- [ ] Client that never drains cannot grow memory unbounded.
- [ ] Rapid connect/disconnect releases listeners and timers.
- [ ] Replay floor and old epoch behavior.
- [ ] Session file append is delivered without whole-file reread.
- [ ] Partial JSONL line is carried safely.
- [ ] Truncated session file resets safely.
- [ ] Server close stops hubs.

## 16.5 Evidence

Capture:

- Process RSS before and after connection soak.
- Active handles/listeners before and after.
- Producer invocation count for 1 versus 25 clients.
- Disk-read behavior for session append.
- No leaked timers after close.

## 16.6 Gate

- [ ] Expensive observability work is shared.
- [ ] Session events use incremental reads.
- [ ] All buffers and replay state are bounded.
- [ ] Slow clients cannot create unbounded memory.
- [ ] Shutdown cleanup passes soak testing.

---

# 17. P4.3-Sd1 — Canonical Audit Chain and Concurrent Writer

## 17.1 Objective

Make audit records tamper-evident and prevent chain forks under concurrent CLI and daemon processes.

## 17.2 Files

```text
src/security/audit/canonical-json.ts
src/security/audit/audit-lock.ts
src/security/audit/audit-chain-writer.ts
src/audit/audit-store.ts
src/audit/audit-types.ts
tests/security/audit/canonical-json.test.ts
tests/security/audit/audit-chain-writer.test.ts
tests/stress/audit-concurrency.test.ts
```

## 17.3 Detailed tasks

### Sd1.1 Canonical JSON specification

- [ ] Document key ordering.
- [ ] Document UTF-8 encoding.
- [ ] Document number handling.
- [ ] Reject non-finite numbers.
- [ ] Reject undefined, function, and symbol.
- [ ] Preserve array order.
- [ ] Define string escaping.
- [ ] Add domain/version prefix to hashes.
- [ ] Publish test vectors in fixtures.

### Sd1.2 Audit v2 types

- [ ] Add `version: 2`.
- [ ] Add sequence.
- [ ] Add previous hash.
- [ ] Add record hash.
- [ ] Preserve current action/details compatibility.
- [ ] Extend security actions.
- [ ] Define legacy record parsing separately.

### Sd1.3 Redacting audit adapter

- [ ] Redact details before canonicalization.
- [ ] Preserve only approved correlation fields.
- [ ] Avoid raw client address by default.
- [ ] Avoid token/hash/cookie/header values.
- [ ] Handle redaction failure with a safe details sentinel.
- [ ] Avoid recursive audit emission.

### Sd1.4 Cross-process lock

- [ ] Create lock with exclusive semantics.
- [ ] Include PID, host, creation time, and nonce.
- [ ] Retry with bounded backoff.
- [ ] Detect stale owner.
- [ ] Require explicit stale recovery policy.
- [ ] Audit stale recovery after writer is operational.
- [ ] Release in `finally`.
- [ ] Handle process crash fixtures.

### Sd1.5 Chain append transaction

- [ ] Acquire lock.
- [ ] Read/validate head sidecar.
- [ ] Confirm tail if sidecar is missing or stale.
- [ ] Determine next sequence.
- [ ] Determine previous hash.
- [ ] Redact record.
- [ ] Canonicalize body.
- [ ] Hash body + sequence + previous hash.
- [ ] Append one JSONL line.
- [ ] Flush according to durability policy.
- [ ] Atomically update head sidecar.
- [ ] Release lock.
- [ ] Return v2 record.

### Sd1.6 Legacy activation boundary

- [ ] Read exact legacy bytes.
- [ ] Count legacy records.
- [ ] Compute exact byte length.
- [ ] Compute segment digest.
- [ ] Append `security.audit.integrity_enabled` as first v2 record.
- [ ] Mark legacy segment unverified.
- [ ] Make activation idempotent.

## 17.4 Tests

- [ ] Canonical output test vectors.
- [ ] Key-order independence.
- [ ] Invalid value rejection.
- [ ] Genesis record.
- [ ] Sequential records.
- [ ] Hash binds previous hash.
- [ ] Hash binds sequence.
- [ ] Redaction occurs before hash.
- [ ] Concurrent processes produce one contiguous sequence.
- [ ] Stale sidecar recovery.
- [ ] Lock timeout.
- [ ] Stale lock handling.
- [ ] Legacy activation is idempotent.

## 17.5 Gate

- [ ] 100+ concurrent append operations yield no duplicate/gap/fork.
- [ ] Every v2 record hash binds body, sequence, and previous link.
- [ ] Legacy boundary records exact segment evidence.
- [ ] Audit details are redacted before persistence.

---

# 18. P4.3-Sd2 — Streaming Verification, Queries, and Checkpoints

## 18.1 Objective

Detect alteration, deletion, insertion, reordering, duplication, malformed lines, and truncation without loading the complete log into memory.

## 18.2 Files

```text
src/security/audit/audit-verifier.ts
src/security/audit/audit-checkpoint.ts
src/audit/audit-store.ts
src/cli/commands/security.ts
src/cli.ts
tests/security/audit/audit-verifier.test.ts
tests/security/audit/audit-checkpoint.test.ts
tests/security/audit/audit-large-log.test.ts
```

## 18.3 Detailed tasks

### Sd2.1 Streaming verifier

- [ ] Read with `createReadStream` and `readline`.
- [ ] Track line number.
- [ ] Track byte offset.
- [ ] Parse legacy and v2 segments explicitly.
- [ ] Verify sequence continuity.
- [ ] Verify previous link.
- [ ] Recompute record hash.
- [ ] Detect duplicate sequence.
- [ ] Detect gaps.
- [ ] Detect reorder.
- [ ] Distinguish malformed interior line from truncated tail.
- [ ] Compare final record to head sidecar.
- [ ] Return structured findings.
- [ ] Exit non-zero on integrity failure.

### Sd2.2 Audit query refactor

- [ ] Replace whole-file `readFile()` query implementation.
- [ ] Stream and retain only the requested bounded result set.
- [ ] Preserve newest-first semantics.
- [ ] Preserve action/graph/approval filtering.
- [ ] Do not silently skip malformed lines in verification mode.
- [ ] In normal query mode, return corruption status separately.

### Sd2.3 Checkpoint keys

- [ ] Generate separate audit checkpoint keypair.
- [ ] Store private key user-scoped.
- [ ] Store public key ID.
- [ ] Restrict permissions.
- [ ] Support explicit trusted public key import.
- [ ] Never place private key in project state.

### Sd2.4 Checkpoint creation and verification

- [ ] Include workspace ID.
- [ ] Include sequence and record hash.
- [ ] Include creation time and signer key ID.
- [ ] Sign canonical checkpoint payload.
- [ ] Verify signature.
- [ ] Verify workspace.
- [ ] Verify checkpoint refers to an existing valid chain record.
- [ ] Support output to operator-selected external location.
- [ ] Document same-host versus external anchoring honestly.

### Sd2.5 CLI

```text
alix audit verify
alix audit verify --json
alix audit checkpoint --output <path>
alix audit checkpoint-verify <path>
```

- [ ] Stable exit codes.
- [ ] Safe evidence.
- [ ] No secret material in JSON output.
- [ ] Clear remediation.

## 18.6 Adversarial tests

- [ ] Modify record body.
- [ ] Modify previous hash.
- [ ] Modify sequence.
- [ ] Delete record.
- [ ] Insert record.
- [ ] Reorder records.
- [ ] Duplicate record.
- [ ] Interior malformed JSON.
- [ ] Truncated tail.
- [ ] Stale head sidecar.
- [ ] Corrupt head sidecar.
- [ ] Alter legacy segment.
- [ ] Alter checkpoint.
- [ ] Wrong workspace checkpoint.
- [ ] Wrong public key.
- [ ] Large log memory bound.

## 18.7 Gate

- [ ] All defined tampering is detected.
- [ ] Large-log verification is streaming.
- [ ] Query behavior remains usable.
- [ ] Checkpoints are called tamper-evident evidence, not tamper-proof guarantees.

---

# 19. P4.3-Se1 — Credential Store and Legacy Migration

## 19.1 Objective

Remove active credentials from project configuration and provide a safe compatibility migration.

## 19.2 Files

```text
src/security/credentials/credential-store.ts
src/security/credentials/credential-reference.ts
src/security/credentials/credential-migration.ts
src/security/platform/user-config-paths.ts
src/config/schema.ts
src/config/loader.ts
src/config/validator.ts
src/cli/commands/security.ts
tests/security/credentials/
tests/config-loader.test.ts
```

## 19.3 Detailed tasks

### Se1.1 Credential store

- [ ] Resolve platform user config path.
- [ ] Define versioned credential schema.
- [ ] Store provider API keys.
- [ ] Store MCP header/env credentials.
- [ ] Use atomic write and restrictive permissions.
- [ ] Reject symlink targets.
- [ ] Bound credential entry name and value size.
- [ ] Never expose values through list/doctor.
- [ ] Support environment variables as higher-priority ephemeral sources.

### Se1.2 Credential references

```text
${credential:provider.openai.api_key}
${credential:mcp.github.authorization}
```

- [ ] Define strict reference syntax.
- [ ] Resolve only at the point of provider/MCP construction.
- [ ] Prevent recursive references.
- [ ] Prevent references in unsupported fields.
- [ ] Redact unresolved reference diagnostics safely.
- [ ] Preserve non-secret MCP configuration in project config.

### Se1.3 Legacy detection

- [ ] Detect `apiKeys` in user config.
- [ ] Detect `apiKeys` in project config.
- [ ] Detect literal secret-like MCP headers/env.
- [ ] Report `legacy-secrets-present` trust state.
- [ ] Warn once in development.
- [ ] Reject project secrets in production.
- [ ] Provide exact migration command.

### Se1.4 Migration transaction

1. Read legacy config once.
2. Identify credential fields.
3. Write credentials atomically.
4. Verify credential write.
5. Create sanitized new config.
6. Write sanitized config atomically.
7. Verify sanitized config.
8. Write provenance event later through mutation service.
9. Retain recovery backup with restrictive permissions until success.
10. Remove backup according to documented policy.

Tasks:

- [ ] Make migration idempotent.
- [ ] Preserve original if credential write fails.
- [ ] Preserve original if config rewrite fails.
- [ ] Never print values.
- [ ] Support dry run.
- [ ] Support JSON report.
- [ ] Support user and project sources separately.

### Se1.5 CLI

```text
alix security credentials doctor
alix security credentials migrate
alix security credentials migrate --dry-run
```

## 19.4 Tests

- [ ] User `apiKeys` migration.
- [ ] Project `apiKeys` migration.
- [ ] MCP header/env migration.
- [ ] Failed credential write leaves config unchanged.
- [ ] Failed config write leaves recoverable state.
- [ ] Idempotent second run.
- [ ] No values in output.
- [ ] Symlink attack.
- [ ] Permission failure.
- [ ] Production rejects remaining project secrets.
- [ ] Environment override works without persistence.

## 19.5 Gate

- [ ] Production config cannot contain active raw credentials.
- [ ] Legacy migration is transactional and recoverable.
- [ ] Provider and MCP clients resolve credentials without exposing them.
- [ ] Credential values never appear in Inspector or doctor output.

---

# 20. P4.3-Se2 — Central Config Mutation and Provenance

## 20.1 Objective

Ensure every production config change passes through one attributable, testable mutation path.

## 20.2 Files

```text
src/config/config-mutation-service.ts
src/security/config/config-provenance.ts
src/security/config/config-digest.ts
src/cli.ts
src/cli/commands/init.ts
src/models/model-install.ts
MCP/model/profile config writer files
tests/security/config/config-mutation-service.test.ts
tests/security/config/config-provenance.test.ts
tests/config/config-writer-coverage.test.ts
```

## 20.3 Detailed tasks

### Se2.1 Mutation service

- [ ] Support user and project config targets.
- [ ] Read once.
- [ ] Validate path mutation.
- [ ] Reject secret values in project target.
- [ ] Apply mutation to an immutable copy.
- [ ] Validate resulting config.
- [ ] Compute previous and new digest.
- [ ] Write atomically.
- [ ] Verify post-write bytes.
- [ ] Emit provenance after successful write.
- [ ] Return changed paths and trust impact.
- [ ] Support dry-run.
- [ ] Support rollback on provenance failure according to policy.

### Se2.2 Migrate every writer

- [ ] Default model writer.
- [ ] Tier writer.
- [ ] MCP add.
- [ ] MCP remove.
- [ ] MCP discover.
- [ ] Model profile apply.
- [ ] Model install profile update.
- [ ] Init/onboarding.
- [ ] Any other production writer found by inventory.

### Se2.3 Writer coverage test

- [ ] Search production source for direct writes to config paths.
- [ ] Allow only the mutation service implementation and test fixtures.
- [ ] Fail CI when a new bypass writer appears.
- [ ] Document the approved pattern for future code.

### Se2.4 Provenance chain

- [ ] Define schema.
- [ ] Sequence records.
- [ ] Hash-chain records.
- [ ] Record actor and command.
- [ ] Record changed paths only.
- [ ] Record previous/new digest.
- [ ] Record reason when provided.
- [ ] Never record changed values.
- [ ] Add streaming verifier.
- [ ] Add user-visible history command.

### Se2.5 CLI

```text
alix config history
alix config history --json
alix config verify-provenance
```

## 20.4 Tests

- [ ] Every writer uses mutation service.
- [ ] Changed paths are accurate.
- [ ] No values enter provenance.
- [ ] Concurrent config writers are serialized or fail safely.
- [ ] Atomic write interruption.
- [ ] Invalid resulting config is not written.
- [ ] Project secret mutation is rejected.
- [ ] Provenance body/link/sequence tampering is detected.

## 20.5 Gate

- [ ] Direct production config writes are eliminated.
- [ ] Every supported change has provenance.
- [ ] Provenance contains no values.
- [ ] Future bypasses fail CI.

---

# 21. P4.3-Se3 — Config Signing, Trust Evaluation, and Anti-Rollback

## 21.1 Objective

Verify security-sensitive configuration before execution and detect stale, incomplete, unknown-key, and rollback states.

## 21.2 Files

```text
src/security/config/config-projection.ts
src/security/config/config-signing.ts
src/security/config/config-key-store.ts
src/security/config/config-version-store.ts
src/security/config/trust-policy.ts
src/config/loader.ts
src/config/config-mutation-service.ts
src/cli/commands/security.ts
tests/security/config/
```

## 21.3 Detailed tasks

### Se3.1 Required signed projection

- [ ] Define required paths in code.
- [ ] Include permissions.
- [ ] Include runtime.
- [ ] Include secret-reference-only MCP configuration.
- [ ] Include ownership.
- [ ] Include tool config.
- [ ] Include subagent role policy.
- [ ] Include UI security.
- [ ] Include policy references and workspace boundaries.
- [ ] Exclude raw credentials and ephemeral runtime state.
- [ ] Reject a manifest missing a required path.

### Se3.2 Key store

- [ ] Generate config signing keypair.
- [ ] Store private key user-scoped.
- [ ] Restrict permissions.
- [ ] Assign key ID from public key digest.
- [ ] Support public trust-key import.
- [ ] Support key rotation without silently trusting unknown keys.
- [ ] Report permission uncertainty.

### Se3.3 Manifest

- [ ] Add schema version.
- [ ] Add monotonic config version.
- [ ] Add signed time.
- [ ] Add signer key ID.
- [ ] Add required policy version.
- [ ] Add covered paths.
- [ ] Add content digest.
- [ ] Sign canonical manifest payload.
- [ ] Store manifest project-side without private material.

### Se3.4 Same-read trust loader

- [ ] Read user and project config bytes once.
- [ ] Parse those bytes.
- [ ] Build projections from those parsed objects.
- [ ] Verify manifests.
- [ ] Merge the same parsed objects.
- [ ] Apply environment overrides with explicit trust reporting.
- [ ] Return effective config plus trust report.
- [ ] Never verify one read and execute another.

### Se3.5 Anti-rollback

- [ ] Store last accepted config version per workspace user-side.
- [ ] Reject lower version in production.
- [ ] Detect a changed config with unchanged version/signature.
- [ ] Support explicit administrative rollback override.
- [ ] Require reason.
- [ ] Audit override.
- [ ] Update accepted version only after successful verification.

### Se3.6 Mutation integration

- [ ] Mark signature stale after covered-path changes.
- [ ] Optionally re-sign when authorized.
- [ ] Never auto-sign an untrusted mutation silently.
- [ ] Return next-step command.
- [ ] Keep non-covered changes from unnecessarily invalidating signature.

### Se3.7 CLI

```text
alix security config keygen
alix security config sign
alix security config verify
alix security config trust-key <path>
alix security config allow-rollback --reason "<reason>"
```

## 21.4 Tests

- [ ] Valid verified config.
- [ ] Unsigned config.
- [ ] Changed covered field.
- [ ] Changed uncovered field.
- [ ] Missing required path.
- [ ] Unknown key.
- [ ] Corrupt signature.
- [ ] Corrupt digest.
- [ ] Replayed old signed config.
- [ ] Environment override is reported.
- [ ] Same-read TOCTOU fixture.
- [ ] Private-key permission failure.
- [ ] Key rotation.
- [ ] Rollback override audit.

## 21.5 Gate

- [ ] Production rejects invalid, stale, incomplete, unknown-key, and rollback states.
- [ ] Required path coverage is code-defined.
- [ ] The verified parsed object is the object executed.
- [ ] No private key exists in the repository.

---

# 22. P4.3-Sf — Supply-Chain Policy and Exact-Artifact Publication

## 22.1 Objective

Make dependency installation, exception handling, package contents, and publication reproducible and inspectable.

## 22.2 Files

```text
src/security/supply-chain/dependency-policy.ts
src/security/supply-chain/security-exceptions.ts
src/security/supply-chain/package-verifier.ts
security/lifecycle-script-allowlist.json
security/audit-exceptions.json
scripts/verify-lifecycle-scripts.mjs
scripts/check-supply-chain.sh
scripts/release-gate.sh
.github/workflows/ci.yml
.github/workflows/publish.yml
.github/dependabot.yml
tests/security/supply-chain/
```

## 22.3 Detailed tasks

### Sf.1 Lifecycle-script inventory and allowlist

- [ ] Inspect lockfile for packages with lifecycle scripts.
- [ ] Record package, version/range, scripts, reason, owner, and expiry.
- [ ] Fail on new unapproved lifecycle-script packages.
- [ ] Fail on expired entries.
- [ ] Provide a review command and machine-readable result.
- [ ] Separate inspection install from approved rebuild/test lanes.
- [ ] Confirm native packages still build.

### Sf.2 Advisory policy

- [ ] Run production audit separately from full audit.
- [ ] Parse JSON deterministically.
- [ ] Classify production versus development findings.
- [ ] Add exception schema with owner, rationale, created, expiry.
- [ ] Fail expired exceptions.
- [ ] Fail unexcepted findings at configured severity.
- [ ] Do not claim code-path reachability.

### Sf.3 Lockfile and dependency checks

- [ ] Verify exact direct dependencies.
- [ ] Verify lockfile exists.
- [ ] Run deterministic lockfile freshness check.
- [ ] Fail on dirty lockfile diff.
- [ ] Retain minimum release age policy.
- [ ] Document emergency override process.

### Sf.4 Immutable workflow dependencies

- [ ] Pin `actions/checkout` to SHA.
- [ ] Pin `actions/setup-node` to SHA.
- [ ] Pin every other action to SHA.
- [ ] Add Dependabot/Renovate workflow update configuration.
- [ ] Set explicit least-privilege workflow permissions.
- [ ] Review use of repository write and id-token permissions.

### Sf.5 Tarball verifier

- [ ] Create allowed path set.
- [ ] Create deny patterns.
- [ ] Reject `.env*`.
- [ ] Reject `.alix/`.
- [ ] Reject credentials/auth/token files.
- [ ] Reject private keys.
- [ ] Reject audit/session logs.
- [ ] Reject secret-like fixture content.
- [ ] Reject unexpected absolute source paths in maps.
- [ ] Emit safe evidence.

### Sf.6 SBOM and checksum

- [ ] Generate an approved standard SBOM.
- [ ] Associate it with package version and commit.
- [ ] Compute SHA-256 of tarball.
- [ ] Store checksum file.
- [ ] Upload tarball, SBOM, checksum as workflow artifacts.
- [ ] Attach same files to GitHub release.

### Sf.7 Pack once, test once, publish exact artifact

Revised flow:

1. Install approved dependencies.
2. Build and test.
3. `npm pack --json`.
4. Verify package contents.
5. Install tarball into clean temp directory.
6. Run smoke tests against installed package.
7. Generate SBOM.
8. Compute checksum.
9. Retain tarball.
10. Publish `npm publish <tarball> --provenance --access public`.
11. Create/attach GitHub release artifacts.

Tasks:

- [ ] Remove release-gate deletion of the verified tarball.
- [ ] Pass artifact path between workflow steps/jobs safely.
- [ ] Verify checksum immediately before publish.
- [ ] Refuse source-tree `npm publish`.
- [ ] Ensure package version/tag consistency.
- [ ] Keep provenance enabled.

## 22.4 Tests

- [ ] New lifecycle script fails.
- [ ] Expired lifecycle exception fails.
- [ ] Unexcepted production advisory fails.
- [ ] Expired advisory exception fails.
- [ ] Lockfile drift fails.
- [ ] Unexpected tarball file fails.
- [ ] Secret-like tarball content fails.
- [ ] Checksum mismatch fails.
- [ ] Missing SBOM fails.
- [ ] Source-tree publish attempt is not used.
- [ ] Published artifact path equals verified artifact path.
- [ ] Moving action tag is detected.

## 22.5 Gate

- [ ] CI dependency policy is deterministic.
- [ ] Exceptions expire.
- [ ] Workflow actions are immutable.
- [ ] The exact tested tarball is published.
- [ ] SBOM and checksum are retained with the release.
- [ ] npm provenance remains active.

---

# 23. P4.3-Sg1 — Passive Security Health and Alerts

## 23.1 Objective

Expose security posture through the current observability stack without making health reads active or mutating.

## 23.2 Files

```text
src/observability/health-snapshot.ts
src/observability/alert-engine.ts
src/observability/security-telemetry.ts
src/observability/observability-config.ts
src/tui/health-panel.ts
src/server/observability-stream-hub.ts
tests/observability/security-health.test.ts
tests/observability/security-alerts.test.ts
```

## 23.3 Detailed tasks

### Sg1.1 Security health state

Add:

```typescript
type SecurityHealth = {
  inspectorAuth: HealthStatus;
  auditIntegrity: HealthStatus;
  configTrust: ConfigTrustState | "unknown";
  supplyChain: HealthStatus;
  lastSecurityGateAt?: string;
  lastSecurityGatePassed?: boolean;
};
```

- [ ] Read Inspector auth configuration and passive store status.
- [ ] Read latest cached audit verification report.
- [ ] Read current config trust result.
- [ ] Read latest supply-chain/security gate report.
- [ ] Never trigger full verification from health collection.
- [ ] Return `unknown` when evidence is absent.
- [ ] Incorporate security state into overall health according to documented policy.

### Sg1.2 Alerts

Add rules for:

- [ ] Authentication disabled unexpectedly.
- [ ] Non-loopback bind without approved remote security.
- [ ] Authentication rejection spike.
- [ ] Rate-limit rejection spike.
- [ ] SSE saturation.
- [ ] Redaction failure.
- [ ] Audit verification failure.
- [ ] Invalid/stale/rollback config trust.
- [ ] Expired supply-chain exception.
- [ ] Failed security gate.

- [ ] Define threshold, duration, cooldown, and severity.
- [ ] Use bounded dimensions only.
- [ ] Ensure GET health/alerts does not persist new state unexpectedly.
- [ ] Document response/remediation.

### Sg1.3 Surfaces

- [ ] Add security section to CLI observability health.
- [ ] Add compact security section to TUI health.
- [ ] Add security events to shared SSE.
- [ ] Add admin-only passive `/api/security/status`.
- [ ] Redact all status evidence.

## 23.4 Gate

- [ ] Security health is passive.
- [ ] Unknown is never reported as healthy.
- [ ] Alerts use registered metrics/dimensions.
- [ ] Inspector security status contains no credentials or hashes.

---

# 24. P4.3-Sg2 — Security Doctor and Acceptance Gate

## 24.1 Objective

Turn security claims into executable checks with stable evidence and exit codes.

## 24.2 Files

```text
src/security/acceptance/security-check-registry.ts
src/security/acceptance/security-doctor.ts
src/security/acceptance/security-report.ts
src/cli/commands/security.ts
src/cli.ts
package.json
scripts/release-gate.sh
tests/security/acceptance/
```

## 24.3 Check registry

Each check:

```typescript
type SecurityCheck = {
  id: string;
  category: SecurityCategory;
  run(context: SecurityCheckContext): Promise<SecurityCheckResult>;
};
```

Rules:

- [ ] IDs are stable.
- [ ] Checks cannot contain secrets in evidence.
- [ ] A thrown checker becomes `error`.
- [ ] Production gate treats `error` as failure.
- [ ] Doctor can report warnings without mutating state.
- [ ] Gate can invoke approved active test commands explicitly.

## 24.4 Doctor checks

Inspector:

- [ ] Loopback or approved remote bind.
- [ ] Authentication required.
- [ ] Host/origin policy valid.
- [ ] Trusted proxy CIDRs valid.
- [ ] TLS requirement satisfied.
- [ ] Auth store permissions acceptable.
- [ ] Route registry coverage complete.
- [ ] SSE configuration bounded.

Redaction:

- [ ] Redactor self-test.
- [ ] Required profiles present.
- [ ] Config display uses redactor.

Audit:

- [ ] Chain enabled or legacy state explicit.
- [ ] Latest verification report status.
- [ ] Lock/head paths valid.
- [ ] Checkpoint key permissions.

Config/credentials:

- [ ] No project raw credentials.
- [ ] Credential store permissions.
- [ ] Config trust state.
- [ ] Provenance integrity.
- [ ] Anti-rollback state.

Supply chain:

- [ ] Lifecycle exceptions unexpired.
- [ ] Advisory exceptions unexpired.
- [ ] Workflow actions pinned.
- [ ] Latest gate result.
- [ ] Package verifier configuration present.

## 24.5 Commands

```text
alix security doctor
alix security doctor --json
alix security gate
alix security gate --json
npm run test:security
```

Exit codes:

```text
0 pass
1 check failed
2 checker/internal error
3 invalid invocation/configuration
```

## 24.6 Gate composition

The release security gate runs:

- [ ] Typecheck.
- [ ] Build.
- [ ] Focused security tests.
- [ ] Security integration tests.
- [ ] Inspector abuse stress test.
- [ ] Audit concurrency test.
- [ ] Config migration/signing tests.
- [ ] Supply-chain checks.
- [ ] Package verification.
- [ ] Security doctor against packaged install.
- [ ] Machine-readable report generation.

## 24.7 Gate

- [ ] A crashing checker fails closed.
- [ ] JSON report contains no sensitive evidence.
- [ ] Release gate consumes the security report.
- [ ] Packaged-artifact doctor passes.
- [ ] Security gate result is retained as release evidence.

---

# 25. P4.3-Sg3 — Threat Model, Documentation, and Roadmap Reconciliation

## 25.1 Objective

Make the implemented trust model understandable to operators and maintainers and resolve conflicting milestone/document names.

## 25.2 Files

```text
docs/security/threat-model.md
docs/security/inspector-security.md
docs/security/audit-integrity.md
docs/security/config-trust.md
docs/security/credential-migration.md
docs/security/supply-chain.md
docs/observability/metrics-catalog.md
docs/observability-runbook.md
docs/configuration.md
docs/operator-handbook.md
README.md
docs/superpowers/plans/2026-06-17-p4-productionization-observability-adoption.md
```

## 25.3 Documentation tasks

### Threat model

- [ ] Assets.
- [ ] Trust boundaries.
- [ ] Threat actors.
- [ ] Entry points.
- [ ] Abuse cases.
- [ ] Security controls.
- [ ] Residual risks.
- [ ] Explicit limits.
- [ ] Malicious project/plugin/MCP output.
- [ ] Localhost webpage and DNS rebinding attacks.
- [ ] Concurrent process risks.
- [ ] Supply-chain risks.

### Inspector guide

- [ ] Default local operation.
- [ ] Token creation.
- [ ] Browser login.
- [ ] Rotation and revocation.
- [ ] Remote proxy/TLS requirements.
- [ ] Host/origin settings.
- [ ] Rate and SSE settings.
- [ ] Read-only invariant.
- [ ] Troubleshooting.

### Audit guide

- [ ] Legacy segment.
- [ ] v2 chain.
- [ ] Verification.
- [ ] Lock recovery.
- [ ] Checkpoints.
- [ ] External anchoring.
- [ ] Tamper-evident terminology.

### Config trust guide

- [ ] Credential migration.
- [ ] Mutation service.
- [ ] Provenance.
- [ ] Signing.
- [ ] Trust states.
- [ ] Anti-rollback.
- [ ] Recovery and key rotation.

### Supply-chain guide

- [ ] Lifecycle allowlist.
- [ ] Advisory exceptions.
- [ ] Lockfile policy.
- [ ] SBOM/checksum.
- [ ] Exact-artifact publish.
- [ ] npm provenance.

### Metrics reconciliation

- [ ] Archive/label legacy Python metrics document.
- [ ] Publish current TypeScript metric catalog.
- [ ] List security metrics and alert rules.
- [ ] Describe passive health semantics.

### Roadmap

- [ ] Rename security track consistently to P4.3-S or formally renumber.
- [ ] Rename current UX track to P4.3-UX until final renumbering.
- [ ] Update dependencies so security precedes remote/expanded UX.

## 25.4 Gate

- [ ] Documentation matches actual commands and config.
- [ ] No document claims API keys are absent before migration.
- [ ] No document claims audit is tamper-proof.
- [ ] No document describes the legacy Python monitoring stack as current.
- [ ] Roadmap contains no duplicate P4.3 identity.

---

# 26. Adversarial Acceptance Matrix

The following matrix must be represented by automated tests or an explicitly approved manual platform check.

## 26.1 Authentication and browser sessions

- [ ] Missing token.
- [ ] Malformed token.
- [ ] Wrong token ID.
- [ ] Correct ID/wrong secret.
- [ ] Revoked token.
- [ ] Expired token.
- [ ] Rotated token within grace.
- [ ] Rotated token after grace.
- [ ] Wrong workspace.
- [ ] Insufficient role.
- [ ] Session fixation.
- [ ] Expired browser session.
- [ ] Cookie request from foreign origin.
- [ ] Query-string token.
- [ ] Auth-store permission failure.
- [ ] Atomic-write interruption.
- [ ] Session-store capacity exhaustion.

## 26.2 Network boundary

- [ ] DNS-rebinding Host.
- [ ] Alternate Host.
- [ ] Missing Host.
- [ ] Disallowed Origin.
- [ ] `null` Origin.
- [ ] Wildcard origin with credentials.
- [ ] Forged proxy header.
- [ ] Untrusted forwarding peer.
- [ ] Overlong forwarding chain.
- [ ] Remote cleartext Bearer.
- [ ] Oversized headers.
- [ ] Overlong URL.
- [ ] GET with body.
- [ ] Oversized auth body.
- [ ] Slow header delivery.

## 26.3 Authorization and route coverage

- [ ] Viewer matrix across all routes.
- [ ] Operator matrix across all routes.
- [ ] Admin matrix across all routes.
- [ ] Unknown route default deny.
- [ ] Implemented route without descriptor fails CI.
- [ ] Descriptor without implementation fails CI.
- [ ] Public static asset cannot expose workspace data.
- [ ] Public health returns only minimal status.
- [ ] Admin data is still redacted.
- [ ] No state-changing route exists.

## 26.4 Redaction

- [ ] API key.
- [ ] Bearer token.
- [ ] Basic auth.
- [ ] Cookie/Set-Cookie.
- [ ] Private key.
- [ ] JWT.
- [ ] Password assignment.
- [ ] Credential URL.
- [ ] Environment-like object.
- [ ] Nested arrays/objects.
- [ ] Error/cause.
- [ ] Metric labels/dimensions.
- [ ] Audit details.
- [ ] Cyclic object.
- [ ] Throwing getter/proxy.
- [ ] Depth limit.
- [ ] Property limit.
- [ ] Array limit.
- [ ] String limit.
- [ ] Output-byte limit.
- [ ] Benign high-entropy ID.
- [ ] Benign field containing `key`.
- [ ] Explicit secret under allowlist.
- [ ] Redactor internal failure.

## 26.5 Rate, connection, and SSE

- [ ] Pre-auth flood.
- [ ] Invalid-token flood.
- [ ] Authenticated burst.
- [ ] Random-address bucket flood.
- [ ] IPv4 normalization.
- [ ] IPv6 normalization.
- [ ] Global SSE cap.
- [ ] Per-principal cap.
- [ ] Per-address cap.
- [ ] Slow client.
- [ ] Never-draining client.
- [ ] Replay below floor.
- [ ] Old epoch.
- [ ] Cursor above head.
- [ ] Malformed cursor.
- [ ] Lifetime expiry.
- [ ] Shutdown cleanup.
- [ ] Reconnect leak.
- [ ] Multi-client producer sharing.

## 26.6 Audit

- [ ] Concurrent process append.
- [ ] Body alteration.
- [ ] Link alteration.
- [ ] Sequence alteration.
- [ ] Deletion.
- [ ] Insertion.
- [ ] Reorder.
- [ ] Duplicate.
- [ ] Interior malformed line.
- [ ] Tail truncation.
- [ ] Stale head.
- [ ] Corrupt head.
- [ ] Stale lock.
- [ ] Legacy segment alteration.
- [ ] Checkpoint alteration.
- [ ] Wrong workspace checkpoint.
- [ ] Wrong signer.
- [ ] Large-log streaming.

## 26.7 Config and credentials

- [ ] Covered config changed after signing.
- [ ] Uncovered config changed.
- [ ] Missing required covered path.
- [ ] Unknown key.
- [ ] Corrupt manifest.
- [ ] Replayed valid old config.
- [ ] Environment override.
- [ ] Project raw API key.
- [ ] Project raw MCP credential.
- [ ] Failed migration preserves original.
- [ ] Direct writer bypass.
- [ ] Provenance deletion/reorder/alteration.
- [ ] Private-key permission failure.
- [ ] Symlinked target.
- [ ] Production trust enforcement.
- [ ] Explicit rollback override with audit.

## 26.8 Supply chain

- [ ] New lifecycle script.
- [ ] Expired lifecycle exception.
- [ ] Production advisory.
- [ ] Expired advisory exception.
- [ ] Lockfile drift.
- [ ] Unexpected tarball file.
- [ ] Secret-like tarball content.
- [ ] Checksum mismatch.
- [ ] SBOM failure.
- [ ] Verified/published artifact mismatch.
- [ ] Moving action tag.
- [ ] Gate checker crash.

---

# 27. Migration and Rollout Strategy

## 27.1 Compatibility modes

Define explicit modes:

```text
development
production
```

Development may warn for:

- Unsigned config.
- Legacy user credentials.
- Missing prior audit verification.
- Loopback authentication-disabled mode when explicitly configured.

Production must reject:

- Non-loopback insecure Inspector.
- Authentication-disabled Inspector.
- Project raw credentials.
- Invalid/stale/incomplete/unknown-key/rollback config trust.
- Expired supply-chain exceptions.
- Failed release security gate.

## 27.2 Recommended rollout sequence

1. Merge S0 and release a patch/RC.
2. Merge redaction and metrics registry.
3. Merge route registry with compatibility logging.
4. Merge token auth and require it by default.
5. Merge browser sessions.
6. Merge network and SSE controls.
7. Activate audit v2 with legacy boundary.
8. Offer credential migration with warnings.
9. Enforce project-secret rejection in production.
10. Centralize config mutation.
11. Enable signing in warning mode.
12. Enforce signing in production after migration tooling is stable.
13. Replace release publication flow.
14. Enable final security gate.

## 27.3 Rollback principles

- Never delete legacy audit data during migration.
- Never remove legacy credentials until secure write and sanitized config write both verify.
- Retain a restrictive recovery copy only for the documented migration window.
- Keep auth tokens independently revocable.
- Keep config signing enforcement configurable during initial rollout.
- Do not roll back by accepting an older config silently; use the explicit rollback override.
- Release workflow rollback must retain the last verified tarball and checksum.

---

# 28. Risk Register

| Risk | Impact | Mitigation | Verification |
|---|---|---|---|
| Route missed during refactor | Unauthorized data access | Route registry + coverage test + default deny | Route coverage CI |
| Browser SSE breaks under auth | Inspector unusable | HttpOnly session exchange | Native EventSource integration |
| Redactor leaks on exception | Credential exposure | Non-throwing safe sentinel | Failure injection tests |
| Redactor over-redacts data | Operator usability loss | Exact keys, explicit patterns, false-positive suite | Fixture tests |
| Auth state leaks into project | Secret disclosure | Platform user-state paths | Filesystem tests |
| Token rotation invalidates all clients | Operational disruption | Multi-record verifier grace | Rotation tests |
| Per-client SSE work remains | DoS/resource amplification | Shared producer call-count tests | Stress evidence |
| Audit chain forks | Integrity failure | Cross-process lock | Concurrency test |
| Audit lock deadlocks | Availability loss | Bounded retry/stale policy | Crash/stale tests |
| Config writer bypasses provenance | Unattributed changes | Source coverage test | CI guard |
| Old signed config replayed | Policy rollback | Monotonic version state | Replay tests |
| Credential migration loses key | Service outage | Two-phase migration and backup | Failure tests |
| Native dependency install breaks | CI/build outage | Lifecycle allowlist + approved rebuild | Clean install CI |
| Different artifact published | Supply-chain integrity loss | Publish exact tarball | Checksum/path assertion |
| Security health performs active work | Endpoint DoS/mutation | Passive artifact reads only | Mock call-count tests |
| Windows ACL cannot be proven | False security claim | Explicit unknown/degraded doctor result | Windows CI/manual evidence |

---

# 29. Pull Request Checklist Template

Use this in every P4.3-S pull request:

```markdown
## Scope
- Security milestone:
- Trust boundary changed:
- Non-goals:

## Files changed
- 

## Security claims
- 

## Compatibility
- Existing config:
- Existing runtime state:
- Existing CLI/API behavior:

## Tests
- [ ] Typecheck
- [ ] Build
- [ ] Focused unit tests
- [ ] Integration tests
- [ ] Adversarial tests
- [ ] Cross-platform tests where applicable

## Evidence
- 

## Metrics/audit impact
- New metrics:
- New audit actions:
- Redaction profile:

## Migration
- Required:
- Dry-run:
- Rollback:

## Risks
- 

## Completion criteria
- [ ] All milestone acceptance criteria met
```

---

# 30. Suggested Package Scripts

Add progressively:

```json
{
  "scripts": {
    "test:security": "node --test --test-timeout=60000 dist/tests/security/**/*.test.js",
    "test:security:inspector": "node --test --test-timeout=60000 dist/tests/security/inspector/**/*.test.js",
    "test:security:audit": "node --test --test-timeout=60000 dist/tests/security/audit/**/*.test.js",
    "test:security:config": "node --test --test-timeout=60000 dist/tests/security/config/**/*.test.js dist/tests/security/credentials/**/*.test.js",
    "test:security:supply-chain": "node --test --test-timeout=60000 dist/tests/security/supply-chain/**/*.test.js",
    "test:stress:inspector": "node --test --test-timeout=120000 dist/tests/stress/inspector-abuse.test.js",
    "test:stress:audit": "node --test --test-timeout=120000 dist/tests/stress/audit-concurrency.test.js",
    "security:doctor": "node dist/src/cli.js security doctor",
    "security:gate": "node dist/src/cli.js security gate --json",
    "verify:lifecycle-scripts": "node scripts/verify-lifecycle-scripts.mjs",
    "verify:supply-chain": "bash scripts/check-supply-chain.sh"
  }
}
```

Adjust glob behavior for Windows-compatible CI where necessary.

---

# 31. Security Metrics and Alert Mapping

| Control | Metric | Health/alert use |
|---|---|---|
| Authentication | `security_auth_attempts_total` | Rejection spike |
| Authorization | `security_authz_denials_total` | Unexpected denial spike |
| Host policy | `security_host_rejections_total` | Rebinding/misconfiguration signal |
| Origin policy | `security_origin_rejections_total` | Browser attack/misconfiguration |
| Rate limiting | `security_rate_limit_rejections_total` | Abuse/saturation |
| SSE | `security_sse_connections_active` | Saturation |
| SSE rejection | `security_sse_connections_rejected_total` | Capacity/abuse |
| SSE disconnect | `security_sse_disconnects_total` | Slow-client/backpressure |
| Redaction | `security_redactions_total` | Operational count only |
| Redaction failure | `security_redaction_failures_total` | Critical alert |
| Audit append | `security_audit_appends_total` | Append failure alert |
| Audit verify | `security_audit_verification_failures_total` | Critical integrity alert |
| Config trust | `security_config_verifications_total` | Invalid/stale/rollback alert |
| Supply chain | `security_supply_chain_findings_total` | Release/dependency alert |
| Security gate | `security_gate_runs_total` | Failed release gate |
| Gate duration | `security_gate_duration_ms` | Operational trend |

No table entry authorizes high-cardinality labels.

---

# 32. Final Release Gate

The final P4.3-S release candidate is accepted only when all checks below pass.

## Inspector

- [ ] Default binding is loopback.
- [ ] Authentication is required.
- [ ] Browser and Bearer authentication work.
- [ ] Every data route has a permission.
- [ ] Unknown routes fail closed.
- [ ] Inspector remains read-only.
- [ ] Remote cleartext credentials are rejected.
- [ ] Host/origin/proxy policies pass.
- [ ] Security headers and CSP pass.

## Redaction

- [ ] All Inspector JSON is redacted.
- [ ] All Inspector SSE is redacted.
- [ ] Audit details are redacted before hashing.
- [ ] Security telemetry is redacted and bounded.
- [ ] Config display is redacted.
- [ ] Exports/support bundles are redacted.
- [ ] Failure injection cannot leak original values.

## Resource safety

- [ ] Pre/post-auth limits are bounded.
- [ ] Session store is bounded.
- [ ] SSE connections and buffers are bounded.
- [ ] Observability work is shared.
- [ ] Session tails are incremental.
- [ ] Slow clients are disconnected.
- [ ] Soak test shows no meaningful handle/timer/listener leak.

## Audit

- [ ] Concurrent writes produce one chain.
- [ ] All tampering fixtures are detected.
- [ ] Legacy segment is explicit.
- [ ] Verification streams.
- [ ] Checkpoint verification works.
- [ ] Terminology is tamper-evident.

## Config and credentials

- [ ] No project raw credentials in production.
- [ ] Every config writer uses the mutation service.
- [ ] Provenance verifies.
- [ ] Required signed paths are enforced.
- [ ] Invalid/stale/unknown/incomplete/rollback states fail production.
- [ ] Same-read verification is proven.
- [ ] Private keys are user-scoped.

## Supply chain

- [ ] Lifecycle scripts are reviewed.
- [ ] Exceptions are unexpired.
- [ ] Lockfile is fresh.
- [ ] Actions are pinned.
- [ ] Tarball contents pass.
- [ ] SBOM exists.
- [ ] Checksum verifies.
- [ ] Packaged smoke tests pass.
- [ ] Exact verified tarball is published.
- [ ] npm provenance is enabled.

## Documentation and operations

- [ ] Threat model matches implementation.
- [ ] Security doctor passes.
- [ ] Security gate passes.
- [ ] Metrics catalog matches TypeScript implementation.
- [ ] Roadmap naming is reconciled.
- [ ] Migration and rollback instructions are tested.

---

# 33. Definition of Done

P4.3-S is complete when:

1. Fresh ALiX exposes no unauthenticated project data outside loopback.
2. Every data-bearing Inspector route is authenticated, authorized, rate-limited, and redacted.
3. Browser SSE works with an HttpOnly session, not a URL or storage token.
4. Remote access requires explicit hosts, origins, proxy CIDRs, and TLS.
5. HTTP, session, limiter, SSE, and replay state are bounded.
6. One observability producer serves all clients.
7. Session event delivery is incremental and shared.
8. Audit v2 appends are serialized and verifiably chained.
9. Every defined audit tampering case is detected.
10. Project config contains no active raw credentials in production.
11. Every config mutation has provenance.
12. Security-sensitive config has enforced signed coverage and rollback detection.
13. Security metrics extend the existing P4.2 stack with bounded labels.
14. Security health is passive and unknown is never promoted to healthy.
15. CI enforces dependency scripts, advisories, exceptions, lockfile, action pins, and package contents.
16. The exact verified tarball is published with an SBOM, checksum, and npm provenance.
17. The threat model, operator guide, metrics catalog, and roadmap agree with the code.
18. `npm run test:security` and `alix security gate --json` pass on supported release platforms.

---

## Appendix A — Recommended PR Sequence

```text
PR 01  P4.3-S0 loopback default, preliminary Host policy, headers, docs
PR 02  Secret detector and bounded structural redactor
PR 03  Closed metric registry and security telemetry
PR 04  Route registry, security context, secure JSON response
PR 05  User-scoped token auth store and CLI
PR 06  Browser session exchange and UI login
PR 07  Host/origin/proxy/TLS policy and two-stage limits
PR 08  Secure SSE, shared observability hub, shared session tailer
PR 09  Canonical audit v2 writer and concurrency lock
PR 10  Audit verifier, legacy boundary, checkpoints, query streaming
PR 11  Credential store, references, and legacy migration
PR 12  Config mutation service and provenance
PR 13  Config signing, trust states, and anti-rollback
PR 14  Lifecycle/advisory policy, action pinning, tarball verifier
PR 15  Exact-artifact release flow, SBOM, checksum
PR 16  Passive security health, alerts, doctor, and security gate
PR 17  Threat model, operator docs, metrics reconciliation, roadmap naming
```

## Appendix B — Recommended first action

Implement **PR 01 / P4.3-S0** first:

```text
Change the Inspector default host from 0.0.0.0 to 127.0.0.1,
reject unsafe non-loopback startup without explicit security configuration,
add Host validation and baseline response headers,
and add regression tests.
```

No later milestone should be used as a reason to postpone this boundary correction.
