# CLI Command Routing — Design Spec

**Date:** 2026-07-25
**Status:** Draft

## Problem

`src/cli.ts` is 3,144 lines with ~79 inline `if (command === "...")` blocks. ~236 `process.exit()` calls make it untestable. 4 commands have already been extracted to per-file handlers (`runs`, `init`, `tui`, `demo`) — this pattern should be applied to all commands.

## Design

Replace the flat `if/if/if...` chain with a command registry. Each command maps to a handler file. `cli.ts` becomes a router.

### Command handler signature

```ts
// Each handler file exports:
export async function handler(args: string[]): Promise<number>;
// Returns exit code — 0 for success, 1 for failure.
// Never calls process.exit() itself.
```

### Registration

A simple synchronous map at the top of cli.ts:

```ts
const COMMAND_ROUTER: Record<string, () => Promise<{ handler: (args: string[]) => Promise<number> }>> = {
  run: () => import("./cli/commands/run.js"),
  session: () => import("./cli/commands/session.js"),
  plan: () => import("./cli/commands/plan.js"),
  review: () => import("./cli/commands/review.js"),
  apply: () => import("./cli/commands/apply.js"),
  submit: () => import("./cli/commands/submit.js"),
  config: () => import("./cli/commands/config.js"),
  tui: () => import("./cli/commands/tui.js"),
  // ... etc
};
```

### Router logic

Replace the 79 if-blocks at the bottom of the file with:

```ts
const loader = COMMAND_ROUTER[command];
if (loader) {
  const mod = await loader();
  const exitCode = await mod.handler(args);
  process.exit(exitCode);
}
console.error(`Unknown command: ${command}`);
process.exit(1);
```

### Migration strategy

Each command handler follows the established pattern (e.g. `runs.ts`). The handler:

1. Parses its sub-args
2. Returns exit code instead of calling `process.exit(0)`
3. Throws `new CliError(message, exitCode)` for structured errors

Existing inline commands are moved one at a time into `src/cli/commands/<name>.ts`. Large multi-subcommand commands (config, security, graph) can be extracted as a group.

## Files changed

| File | Action |
|------|--------|
| `src/cli.ts` | Replace ~79 if-blocks with `COMMAND_ROUTER` map + router logic. Keep help text. |
| `src/cli/commands/*.ts` | Extract each inline command block into its own file following the runs.ts pattern. |

Only high-touch commands should be extracted first: `run`, `session`, `plan`, `review`, `apply`, `submit`. The remaining ~70 commands can be extracted incrementally.
