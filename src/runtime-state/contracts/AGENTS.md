# DOX — Contracts

## Purpose

Type-only authority boundaries and schema contracts. No runtime, no I/O.

## Ownership

- `tool-schemas.ts`, `plan-schemas.ts`, `proposal-schemas.ts`, `llm-schemas.ts`, `provider-tool-schemas.ts`, `contract-diagnostics.ts`, `helpers.ts` — Effect Schema runtime contracts per domain.
- `index.ts` — barrel; re-exports schemas plus R1 ports.
- `runtime-fact-port.ts` — append-only fact boundary; failures explicit, no atomicity claim (R2 adds transactions).
- `runtime-state-reader.ts` — read-only versioned state.
- `authorized-execution-port.ts` — execution only with `AuthorizationEnvelope` (`operator | policy | delegated | system`; `operator` never inferred).
- `approval-decision-port.ts` — decisions with actor/source provenance.
- `ownership-authority.ts` — acquire/validate/renew/release; reuses `src/coordination/ownership/ownership-types.ts`.
- `agent-lifecycle-port.ts` — canonical lifecycle transitions.
- `model-resolver.ts` — single reader for canonical `models.*`; reuses `src/operations/config/schema.ts`.
- `context-compiler.ts` — provenance-aware outbound context with explicit redaction claim.
- `tool-capability-registry.ts` — one tool/capability catalogue contract.
- `metrics-sink.ts` — one metric observation contract.
- `runtime-event.ts` — R2 canonical runtime-event envelope (`RuntimeEvent`, `RuntimeActorType`): entity-versioned facts with causation/correlation ids and actor provenance; the shape the transactional ledger stores.

## Local Contracts

- Ports are interfaces only. They describe authority, never implementation.
- Ports reuse domain types via `import type`; never duplicate them.
- `tests/architecture/r1-boundary-freeze.test.ts` pins the freeze; `r1-allowlist.json` is shrink-only with R0 refs and removal phases.
- `tests/architecture/layer-boundaries.test.ts` pins the direction of value imports between the 12 subsystems (`experience-top`, `state-foundational`, `models-foundational`); `layer-allowlist.json` is shrink-only with R0 refs and removal phases. A new reverse-layer import fails; a stale entry fails.

## Verification

- `npx tsc -p tsconfig.json --noEmit` — ports compile, no collisions.
- `node scripts/check-dead-modules.mjs` — ports reachable via barrel.
- `tests/contracts/*.vitest.ts` — schema suites.
- `tests/architecture/r1-boundary-freeze.test.ts` — freeze suite.

## Child DOX Index

None.
