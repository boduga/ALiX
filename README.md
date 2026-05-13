# ALiX

**Agentic Lifecycle & Intelligence eXchange**

ALiX is a local-first agentic coding harness. The MVP provides a TypeScript/Node CLI, event-sourced session logs, RepoMapLite, a mock provider, policy-gated primitives, patch-engine foundations, verification discovery, and a vanilla JavaScript inspector UI.

## Current MVP Loop

```text
chat -> repo map lite -> plan -> event log -> inspector
```

The current provider is deterministic and local-only:

```text
provider: mock
model: mock-planner
```

## Requirements

- Node 24+
- npm

On this machine, Codex should run Node/npm commands with:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH
```

## Install

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm install
```

## Build And Test

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

This runs:

```bash
npm run build
npm test
```

## CLI Usage

Build first:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run build
```

Show help:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/src/cli.js --help
```

Run a mock task:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/src/cli.js run "summarize this repo"
```

Show effective config:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/src/cli.js config show
```

Start the inspector:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/src/cli.js serve
```

Then open:

```text
http://127.0.0.1:4137
```

## Repository Layout

```text
src/
  cli.ts                  CLI entrypoint
  run.ts                  MVP run flow
  config/                 Config schema/defaults/loader
  events/                 JSONL event log and replay projection
  repomap/                RepoMapLite
  providers/              Provider adapter interface and mock provider
  policy/                 Policy decisions and approval queue
  patch/                  Patch-engine primitives
  checkpoints/            File-copy checkpoint primitive
  verifier/               Verification discovery/runner
  server/                 Local inspector server
  ui/                     Vanilla JS inspector UI
tests/                    Node test runner tests
docs/                     Research, architecture specs, and implementation plan
```

## Runtime Artifacts

ALiX writes local runtime state under:

```text
.alix/
```

These files are ignored by git. Session event logs live under:

```text
.alix/sessions/<session-id>/events.jsonl
```

## Development Status

Completed MVP tasks:

- npm/TypeScript scaffold
- config loader
- event-sourced session kernel
- RepoMapLite
- mock provider adapter
- policy engine and approvals
- patch engine primitives
- checkpoints and verification discovery
- CLI run flow
- local inspector server
- final MVP verification

Recommended next hardening work:

- strengthen patch safety before real providers
- make the inspector render live session events
- add the first real provider adapter
