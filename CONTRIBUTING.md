# Contributing to ALiX

## Getting Started

1. Fork and clone the repo
2. Run `npm install && npm run build`
3. Run `npm test` to verify everything passes

## Pull Requests

- Keep changes focused — one feature or fix per PR
- Write tests for new code (we use `node:test`)
- Ensure `npm test` passes before submitting

## Commit Style

Use conventional commits:

```
feat: add multi-embedder search
fix: resolve provider test async issues
docs: update README with examples
refactor: extract task-loop module
test: add context compiler cache tests
```

## Code Conventions

- TypeScript, strict mode
- No classes where functions suffice (prefer pure functions for testability)
- `node:test` for unit tests (not mocha/jest)
- Errors use `ApiError` in providers, `ToolResult` in tools
- Events use typed payloads from `src/events/types.ts`

## Project Structure

```
src/          — TypeScript source
tests/        — node:test suite (mirrors src/ layout)
dist/         — Compiled output (generated)
docs/         — Specs, plans, architecture
```

## License

MIT
