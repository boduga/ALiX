# Session Capability Integrations

## Overview

Adapters that wire concrete session implementations behind the platform's
`core.session.*` capability ids. This folder deliberately sits outside the
capability package so the capability core stays free of domain dependencies:
the module imports `src/session/resume.js` lazily inside the registration
function, keeping the dependency out of the capability package boundary.

## Interface

- `registerSessionCapabilities(reg, native)` — registers two native handlers and one composed capability descriptor in a single call (`session-capabilities.ts:registerSessionCapabilities`).
- `core.session.list` — native handler returning `{ output: sessions }` from `listSessions(ctx.cwd)` (`session-capabilities.ts:registerSessionCapabilities`).
- `core.session.show` — native handler taking `args.sessionId`; missing id yields `{ error: "sessionId argument required" }` and an unknown id yields `{ error: \`Session not found: <id>\` }` (`session-capabilities.ts:registerSessionCapabilities`).
- `core.session.summary` — composed capability (`kind: "core"`, `version: "1.0"`) declared through `reg.register` with `requiredPermissions: ["operator"]`, `dependencies: ["core.session.list"]`, `execution: { strategy: "native", timeout: 10_000, cancellable: true }` (`session-capabilities.ts:registerSessionCapabilities`).
- `core.session.summary` handler — consumes the dependency's output array and returns `{ total, first }`, where `first` is the first session's `sessionId`, `"n/a"` when absent, or `"none"` for an empty list (`session-capabilities.ts:registerSessionCapabilities`).

## Invariants

- `core.session.summary` never calls `listSessions` itself; its input is the dependency's output, defaulted to `[]` when the argument is not an array (`session-capabilities.ts:registerSessionCapabilities`).
- `registerSessionCapabilities` is async but does not resolve credentials or configuration; it only imports the session module and registers handlers (`session-capabilities.ts:registerSessionCapabilities`).
- Handler failures for `core.session.show` are returned as structured `{ error }` results rather than thrown (`session-capabilities.ts:registerSessionCapabilities`).

## Side Effects

- Mutates the supplied registry (`reg.register`) and native executor (`native.registerHandler`) during registration (`session-capabilities.ts:registerSessionCapabilities`).
- Reads session state from disk via `listSessions` / `sessionInfo` resolved against the caller-provided `ctx.cwd` (`session-capabilities.ts:registerSessionCapabilities`).
- No network, no process spawning, no writes to `.alix/**` in this module (`session-capabilities.ts:registerSessionCapabilities`).

## Verification

- Run: `pnpm test`
