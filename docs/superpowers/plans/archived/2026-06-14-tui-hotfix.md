# TUI Interactive-Input Hotfix

## Context

`alix tui` hangs silently in a real interactive terminal. The recent TTY guard (commit `861317e`) prevents the silent-exit regression but exposes a deeper bug: `src/cli/commands/tui.ts:16-27` uses `process.stdin.once("data", ...)` without resuming the stream. In TTY mode, `process.stdin` starts paused, so the `'data'` listener never fires and the `while (true)` loop blocks on the first `readLine()`. Commit `861317e`'s "robust readLine with buffered input" claim is overstated — the diff only added the TTY guard.

The same bug pattern exists in `src/tui/cursor.ts: getCursorPosition()` (relies on stdin flowing mode to receive the CSI DSR response).

Goal: make the TUI actually receive interactive input in a real terminal, with a PTY regression test that proves it, without breaking CI on hosts that can't build `node-pty`.

GitNexus impact: `readLine` has 1 direct caller (`runTui`), 1 process affected, LOW risk. Cursor has 1 caller (`isAtLineStart` in the same file). Both safe to modify.

User-approved approach: `readline.createInterface` for `readLine`, `resume()` + 250 ms timeout for cursor, PTY test gated by `ALIX_PTY_TESTS=1`, delete the stale `tui (Copy).ts` duplicate.

## Files

| File | Change |
|------|--------|
| `src/cli/commands/tui.ts` | Replace manual `readLine()` with `readline.createInterface({ terminal: true })`; keep `> ` prompt; keep `\t`/`tab` fallback for tab navigation; close on exit and SIGINT |
| `src/tui/cursor.ts` | In `getCursorPosition()`: call `process.stdin.resume()`, raise timeout to 250 ms, add `settled` guard, always clean up listener + timer; fallback `{x:0,y:0}` on timeout preserved |
| `package.json` | Add `node-pty@1.1.0-beta34` to devDependencies; add `test:pty:tui` script; exclude `dist/tests/pty/*` from `test:node:ci` |
| `tests/pty/tui-pty.test.ts` *(new)* | `node:test` suite, gated by `ALIX_PTY_TESTS=1`, spawns `node dist/src/cli.js tui --mode bypass` in a real PTY (`node-pty`), sends `?`, `tab`, `exit` and asserts output |
| `src/cli/commands/tui (Copy).ts` | `git rm` (stale duplicate — confirmed unused by grep) |

Reuse: `readline.createInterface` is already the established pattern in `src/cli/commands/{review,apply,chat,prompt}.ts` — mirror it.

## Implementation

### 1. `src/cli/commands/tui.ts`

Add import at top:
```ts
import { createInterface, type Interface as RLInterface } from "node:readline";
```

Module-scope handle + new `readLine()`:
```ts
let rl: RLInterface | null = null;

function readLine(): Promise<string | null> {
  if (!rl) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onLine = (line: string) => {
      rl!.removeListener("line", onLine);
      if (line === "") { resolve(null); return; }
      if (line === "\t" || line.toLowerCase() === "tab") { resolve("\t"); return; }
      if (line.toLowerCase() === "exit" || line.toLowerCase() === "quit") { resolve(null); return; }
      resolve(line);
    };
    rl.once("line", onLine);
    rl.prompt(true);
  });
}
```

In `runTui()`, immediately after the TTY guard (line 43), create the interface:
```ts
rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,  // critical — without this, stdin stays paused in TTY mode
});
rl.setPrompt("> ");
try { process.stdin.resume(); } catch { /* already flowing */ }
```

Update the SIGINT handler to also close the readline:
```ts
process.on("SIGINT", () => {
  try { rl?.close(); } catch { /* ignore */ }
  rl = null;
  tui.destroy();
  process.exit(0);
});
```

Right before the final `tui.destroy();` (line 197), close the readline:
```ts
try { rl.close(); } catch { /* already closed */ }
rl = null;
```

The downstream `if (task === null) break;` and tab/exit handling in the loop continue to work — `null` now covers empty Enter, `exit`/`quit`, AND EOF; `\t` is still resolved so the `task === "\t"` check at line 114 keeps working for non-TTY test pipelines.

### 2. `src/tui/cursor.ts`

Replace `getCursorPosition` (lines 16-38) with:
```ts
export async function getCursorPosition(): Promise<Position> {
  process.stdout.write("\x1b[6n");
  return new Promise((resolve) => {
    let result = "";
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      process.stdin.removeListener("data", handler);
    };
    const finish = (pos: Position) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(pos);
    };
    const handler = (chunk: Buffer | string) => {
      result += typeof chunk === "string" ? chunk : chunk.toString();
      const match = result.match(/\x1b\[(\d+);(\d+)R/);
      if (match) finish({ x: parseInt(match[2]), y: parseInt(match[1]) });
    };
    try { process.stdin.resume(); } catch { /* already flowing */ }
    process.stdin.on("data", handler);
    timer = setTimeout(() => finish({ x: 0, y: 0 }), 250);
  });
}
```

Contract preserved: `isAtLineStart` at line 58 compares `pos.x === 1`; `{x:0,y:0}` fallback yields `false`, matching the old behaviour.

### 3. `package.json`

Add `node-pty` to `devDependencies` (alphabetical slot between `minimatch` and `typescript`):
```json
"node-pty": "1.1.0-beta34",
```

Add `test:pty:tui` script after `test:manual:tui`:
```json
"test:pty:tui": "ALIX_PTY_TESTS=1 node --test --test-concurrency=1 dist/tests/pty/tui-pty.test.js",
```

Exclude the new directory from `test:node:ci`:
```json
"test:node:ci": "find dist/tests -name '*.test.js' ! -path 'dist/tests/manual/*' ! -path 'dist/tests/pty/*' -print0 | xargs -0 node --test",
```

### 4. `tests/pty/tui-pty.test.ts` (new)

- `import` `node-pty` (`spawn`, `IPty`) and standard `node:test`.
- `const ENABLED = process.env.ALIX_PTY_TESTS === "1";` — early skip when not set.
- Single `it("accepts interactive input over a real PTY", ...)` that:
  1. `ptySpawn(process.execPath, [CLI, "tui", "--mode", "bypass"], { name: "xterm-256color", cols: 120, rows: 30, cwd: process.cwd() })`.
  2. `await waitFor(proc, "ALiX TUI", 10_000)`.
  3. `proc.write("?\r")` → `await waitFor(proc, "Commands:", 5_000)` → assert `Commands:` in buffer.
  4. `proc.write("tab\r")` → `await waitFor(proc, "Panel: ", 5_000)` → assert `Panel: ` in buffer.
  5. `proc.write("exit\r")` → wait for `proc.onExit` with 5 s timeout → assert `exitCode === 0` and no signal.
- `after()` always kills the proc. `waitFor` uses a `setTimeout` that rejects on needle miss.

CLI path resolution: `join(__dirname, "..", "..", "..", "src", "cli.js")` (file lands at `dist/tests/pty/tui-pty.test.js` after build, so target is `dist/src/cli.js`).

### 5. Delete the duplicate

```
git rm "src/cli/commands/tui (Copy).ts"
```

Pre-check: `grep -rn 'tui (Copy)' src/ tests/` — if anything imports it, do not delete in this hotfix; defer.

## Risks (consolidated)

1. **`terminal: true` is mandatory** for `readline.createInterface` — without it, the original bug recurs. Easy to forget.
2. **Tab via real keystroke**: in cooked mode a literal tab moves the cursor to the next tab stop and is not delivered to the `line` event. The text fallback `task.toLowerCase() === "tab"` is the only user-facing path for tab navigation. The `\t` literal check stays as a safety net for non-TTY callers (e.g. the test that pipes `"\t\n"`).
3. **`tui.appendOutput` vs `rl.prompt`**: ink renders into a separate region; readline owns the prompt line. They do not share a buffer (verified by `chat.ts:105-107` using the same pattern without issue).
4. **`node-pty` requires a C++ toolchain**. Gated env flag keeps it out of CI on hosts that cannot build it. The test is excluded from `test:node:ci` by the `find` glob.
5. **`getCursorPosition` double-resolution**: rapid calls could resolve twice if a previous timer fires after a new probe. The `settled` guard handles this.

## Verification

Run from `/home/babasola/Projects/Monolith`, in order:

1. `npm run build` — must compile cleanly; `dist/tests/pty/tui-pty.test.js` must exist.
2. `npm run test:manual:tui` — existing smoke tests still pass; the `?\n` test will now actually match `Commands:` rather than the TTY guard.
3. `npm run test:node:ci` — full node suite stays green; PTY test is excluded by the glob.
4. `ALIX_PTY_TESTS=1 npm run test:pty:tui` — new PTY test passes in < 10 s.
5. Per CLAUDE.md: `mcp__gitnexus__detect_changes` — confirm only `src/cli/commands/tui.ts`, `src/tui/cursor.ts`, `package.json`, `package-lock.json`, `tests/pty/tui-pty.test.ts` appear in the diff (plus the deletion of `tui (Copy).ts`). No unintended files.
6. **Real-terminal proof** (the actual regression; cannot be replaced by any of the above):
   ```
   node dist/src/cli.js tui
   ```
   - Type `?` + Enter → `Commands:` appears.
   - Type `tab` + Enter → `Panel: <name>` appears.
   - Type `exit` + Enter → process exits 0.

## Commit

```
fix(tui): unhang TUI by using readline.createInterface + resume stdin

The TUI hung silently in a real terminal because process.stdin stays
paused in TTY mode; the previous readLine() registered a `data`
listener without resuming the stream, so the listener never fired.

- Replace readLine() in src/cli/commands/tui.ts with a single
  readline.createInterface({ terminal: true }) per runTui() and
  rl.prompt-style prompt, matching the pattern used by
  review/apply/chat/prompt.
- Make src/tui/cursor.ts: getCursorPosition() explicitly
  process.stdin.resume(), clean up the listener and timer on every
  resolution path, and bump the timeout to 250ms.
- Add a gated PTY regression test in tests/pty/tui-pty.test.ts that
  spawns `alix tui` in a real PTY (via node-pty), sends ?, tab, exit,
  and asserts the expected output. Gated behind ALIX_PTY_TESTS=1 so
  CI hosts that cannot build node-pty are not broken.
- Add node-pty devDependency, test:pty:tui script, and exclude
  dist/tests/pty/* from test:node:ci.
- Remove stale duplicate src/cli/commands/tui (Copy).ts.

Hotfix; not part of M37.
```
