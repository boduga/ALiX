# Workbench controller

## Purpose

Renderer-neutral Workbench input and intent transitions shared by the ANSI canvas and the OpenTUI renderer.

## Ownership

| Path | Responsibility |
|------|----------------|
| `selection-intent.ts` | Pure agent/task/artifact/run selection resolution. |
| `store-intent.ts` | Store-only intents; returns declarative host effects. |
| `host-intent.ts` | Effectful intents via `WorkbenchHostPorts`. |

## Local Contracts

- These modules mutate only `WorkbenchStore` and return declarative effects or call `WorkbenchHostPorts`; they never touch terminal I/O or runtime services.
- A host implements `WorkbenchHostPorts`; the ANSI app is one implementation and the OpenTUI host is the other.
- Follow-toggle stays host-side: stopping follow must anchor the transcript before the dispatch.
- Each intent is handled by exactly one layer: selection, store-only, or host-effectful.

## Work Guidance

- Add a new intent to exactly one layer; keep the store transition in the controller and the side effects behind a port.

## Verification

- Run `pnpm build` and `pnpm test:vitest tests/tui/workbench`.

## Child DOX Index

None.
