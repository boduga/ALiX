# Contributing to ALiX

Thank you for your interest in contributing to ALiX.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/boduga/ALiX.git
cd ALiX

# Use Node 24+
export PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH"

# Install dependencies
npm install

# Build and test
npm run check
```

`npm run check` runs TypeScript compilation followed by the test suite (198 tests, 4 skipped by default).

## Making Changes

1. **Fork the repository** and create a branch for your change.
2. **Make your changes** — small, focused commits are preferred.
3. **Ensure tests pass** — run `npm run check` before opening a PR.
4. **Write a clear commit message** — describe what and why, not just "fix bug."

## What Makes a Good PR

- **Focused** — one concern per PR, reviewable in under 15 minutes.
- **Tested** — includes tests that verify behavior, not just presence.
- **Documented** — if you add a non-obvious feature, explain it in the PR description.
- **In scope** — does not expand beyond the stated change. If you find related issues, open a separate issue.

## Test Requirements

All PRs must pass `npm run check`:

```bash
npm run build   # TypeScript compilation
npm test        # 198 tests (194 passing, 4 skipped)
```

### Skipped Integration Tests

Four tests are skipped by default because they require live API credentials:

- `runTask creates session and returns result` (agent-loop.test.ts)
- `runTask loops on tool calls` (agent-loop.test.ts)
- `runTask respects max iterations` (agent-loop.test.ts)
- `run task creates event log and returns plan` (run-flow.test.ts)

To run these, set the `TEST_WITH_LIVE_API=1` environment variable.

## Code Style

- TypeScript with strict mode enabled
- No external runtime dependencies beyond the existing package set
- Error messages must be **actionable**: what failed, why, and how to fix it
- No placeholder TODOs in committed code
- Prefer `src/` organization — no `lib/` directory

## Reporting Issues

Bug reports are welcome. A good report includes:
- Steps to reproduce the issue
- Expected behavior vs. actual behavior
- Your operating system, Node version, and provider configuration
- Relevant session log (found at `.alix/sessions/<id>/events.jsonl`)

For feature requests, open an issue first to discuss the proposal before writing code.

## License

By contributing to ALiX, you agree that your contributions will be licensed under the MIT License.