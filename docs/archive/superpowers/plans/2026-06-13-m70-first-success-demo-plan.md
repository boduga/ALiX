# M0.70 — First Success Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the "10-minute first success" path for ALiX by adding `alix inspector open` (start the Inspector HTTP server and open a browser) and documenting the full happy path from init through demo.

**Architecture:** One new CLI command that reuses the existing `startServer()` from `src/server/server.ts`, auto-enables the UI regardless of config, and opens the browser with platform-appropriate shell commands. No new server code, no new panels, no new API routes.

**Tech Stack:** TypeScript, existing `startServer()` from `src/server/server.ts`, `child_process.execFile` for browser open, existing docs.

**Spec:** This is the full happy path documented end-to-end:
```
alix init
alix models doctor
alix models fit
alix models apply-profile balanced-local --dry-run
alix models install-profile balanced-local
alix run "inspect this repository and explain the architecture"
alix inspector open
```

---

## File Structure

### Modify
- `src/cli.ts` — add `alix inspector open` command handler and help text
- `docs/user-manual.md` — add First Success Demo section with the happy path

---

### Task 1: Add `alix inspector open` command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add the inspector open handler**

Find the `alix serve` block (around line 1049) and add a new block after it for `alix inspector open`:

```typescript
// --- alix inspector -- start Inspector server and open browser ---
if (command === "inspector" && args[0] === "open") {
  const { startServer } = await import("./server/server.js");
  const { loadConfig } = await import("./config/loader.js");
  const { execFile } = await import("node:child_process");
  const { platform } = await import("node:os");

  const config = await loadConfig(process.cwd());
  const host = config.ui?.host ?? "localhost";
  const port = config.ui?.port ?? 3000;

  const server = await startServer(process.cwd(), host, port);
  const url = `http://${host}:${port}`;

  // Open browser (platform-aware)
  const platformName = platform();
  try {
    if (platformName === "darwin") {
      execFile("open", [url]);
    } else if (platformName === "win32") {
      execFile("cmd", ["/c", "start", url]);
    } else {
      execFile("xdg-open", [url]);
    }
  } catch {
    // Browser open is best-effort — user can copy the URL
  }

  console.log(`\n  ALiX Inspector: ${url}\n`);
  console.log("  Press Ctrl+C to stop the server.\n");

  // Block until SIGINT
  await new Promise(() => {});
}
```

- [ ] **Step 2: Add help text**

Find the help commands listing (around the `alix doctor` / `alix daemon doctor` section) and add:
```typescript
  alix inspector open      Start the Inspector web UI and open browser
```

Also update the `alix serve` description to clarify:
```typescript
  alix serve               Start the Inspector server (requires ui.enabled: true in config)
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 4: Quick smoke test**

```bash
npm run build
node dist/src/cli.js inspector open &
sleep 2
curl -s http://localhost:3000/healthz
kill %1 2>/dev/null
```
Expected: healthz returns "OK"

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add alix inspector open — start Inspector and open browser"
```

---

### Task 2: Document the First Success Demo happy path

**Files:**
- Modify: `docs/user-manual.md`

- [ ] **Step 1: Add First Success Demo section**

Add a new section after the Model Profiles section titled "First Success Demo" or "Quick Start" that walks through the full happy path:

```markdown
## First Success Demo

ALiX can go from zero to a running agent in about 10 minutes. Here's the full path:

### 1. Initialize

```bash
cd my-project
alix init
```

This creates `.alix/config.json`, initializes git if needed, and sets sensible defaults.

### 2. Run the diagnostic

```bash
alix models doctor
```

This checks your hardware (OS, RAM, GPU), local runtime (Ollama installed/running), configured API providers, and profile compatibility. It tells you what's working and what needs attention.

### 3. Find your best profile

```bash
alix models fit
```

This ranks the five built-in profiles by your hardware and use case. The top recommendation is the best starting point.

### 4. Preview and apply

```bash
alix models apply-profile balanced-local --dry-run
alix models install-profile balanced-local
```

`--dry-run` shows what would change before anything is written. `install-profile` pulls required Ollama models (for local profiles) and writes the config patch.

### 5. Run your first task

```bash
alix run "inspect this repository and explain the architecture"
```

ALiX loads repo context, plans the task, and executes it through configured tools.

### 6. Open the Inspector

```bash
alix inspector open
```

This starts the web-based Inspector UI and opens it in your browser. Explore session traces, tool calls, and policy decisions live.
```

- [ ] **Step 2: Commit**

```bash
git add docs/user-manual.md
git commit -m "docs: add First Success Demo quick start guide"
```

---

### Verification

1. `npm run build` — clean compile
2. `node dist/src/cli.js inspector open` — starts server and opens browser (verify manually)
3. Shortcut: `alix init && alix models doctor && alix models fit && alix inspector open`
4. Per CLAUDE.md: `mcp__gitnexus__detect_changes` — confirm only `src/cli.ts` and `docs/user-manual.md` changed
