# CLI Routing Implementation Plan

**Goal:** Replace the ~79 inline `if (command === "...")` blocks in `src/cli.ts` with a `COMMAND_ROUTER` map. Each command handler returns an exit code. `cli.ts` becomes a router.

**Architecture:** A `Record<string, () => Promise<{ handler: (args: string[]) => Promise<number> }>>` map at the top of cli.ts. The dispatcher loads the handler, calls it with args, and `process.exit()` with the return value.

**Spec:** `docs/superpowers/specs/2026-07-25-cli-routing-design.md`

### Task 1: Add COMMAND_ROUTER + dispatcher + extract 6 core commands

**Files:**
- Modify: `src/cli.ts` — add router map at top, replace if-blocks with dispatcher
- Extract: `src/cli/commands/run.ts`, `session.ts`, `plan.ts`, `review.ts`, `apply.ts`, `submit.ts`

**The COMMAND_ROUTER map** (add near top of file):

```ts
type CliHandler = (args: string[]) => Promise<number>;

const COMMAND_ROUTER: Record<string, () => Promise<{ handler: CliHandler }>> = {};
```

The dispatcher (replace the bottom-of-file `console.error('Unknown command')`):

```ts
const loader = COMMAND_ROUTER[command];
if (loader) {
  const mod = await loader();
  const code = await mod.handler(args);
  process.exit(code);
}
```

For commands not yet extracted, keep the existing inline blocks. Add an entry to COMMAND_ROUTER for each extracted command. Existing inline blocks for extracted commands are removed.

Extract `run` (currently lines ~958-1112), `session` (lines ~125-127), `plan`, `review`, `apply`, and `submit` (lines ~46-100) into their own handler files following the pattern in `runs.ts`.

Each handler file exports:
```ts
export async function handler(args: string[]): Promise<number> {
  // ... body, return 0 for success, 1 for failure
}
```

Replace all `process.exit(0)` / `process.exit(1)` calls in extracted handlers with `return 0` / `return 1`. For the shared error at the end: `process.exit(1)` stays because it's the last-resort fallthrough.

The remaining ~70 inline commands stay in cli.ts but are now inside the router structure. Future PRs can extract them one at a time.

Report contract:
- Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- Commits: commit hashes
- Test summary: one line
- Concerns

Return only status + commits + test summary.
