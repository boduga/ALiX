# ALiX Manual Test Suite

> **Purpose:** Manual test scripts for ALiX v0.2.0-rc.1
> **Tester:** Run each test step-by-step and mark results
> **Setup:** `cd <project-root> && npm run build` before running tests
>
> **Automated tests also available:** See `tests/manual/suite-*.test.ts`. Run all with:
> ```bash
> npm run build && node --test dist/tests/manual/suite-*.test.js
> ```

---

## How to Use

1. Each test has a **Setup**, **Steps**, and **Expected Result**
2. Run the command listed, observe the output
3. Mark `[PASS]` or `[FAIL]` after each test
4. If a test fails, note the actual output in the **Notes** section
5. Most tests have an equivalent automated version in `suite-*.test.ts`

---

## Test Suite A: Basic CLI (`alix run`)

### A.1: Hello World (read-only, no plan)

```bash
node bin/alix.js run "echo hello" --session-mode bypass --no-stream
```

**Expected:**
- No plan generated (no "## Summary" or "## Changes" output)
- Output shows `hello`
- Session ID printed
- Completes in < 10 seconds

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.2: List files (read-only, no plan)

```bash
node bin/alix.js run "ls" --session-mode bypass --no-stream
```

**Expected:**
- No plan generated
- Lists files in project root (package.json, src/, tests/, etc.)
- Completes quickly

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.3: Direct execution with `--no-plan`

```bash
node bin/alix.js run "who is the president of Nigeria" --session-mode bypass --no-plan
```

**Expected:**
- Skips plan generation entirely (no plan output)
- Returns an answer (may not be accurate without web search)

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.4: Development task with plan mode (approve)

```bash
echo "y" | node bin/alix.js run "add a healthz endpoint" --session-mode bypass --no-stream
```

**Expected:**
- Plan is generated with Summary, Changes, Verification, Risk Assessment sections
- Plan printed to stdout
- After approval (via `echo "y"`), execution proceeds
- Tool calls are made (file reads, patch apply)
- Summary of work printed

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.5: Development task with plan rejection

```bash
echo "n" | node bin/alix.js run "add a healthz endpoint" --session-mode bypass --no-stream
```

**Expected:**
- Plan generated and printed
- Rejected with "Plan rejected. Task cancelled."
- No tool execution happens
- Session returned immediately

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.6: Plan detail view (d key)

```bash
printf 'd\ny\n' | node bin/alix.js run "add a healthz endpoint" --session-mode bypass --no-stream
```

**Expected:**
- Plan printed
- After pressing `d`, expanded details shown (file counts)
- Plan re-printed
- Then `y` approves and executes

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.7: Streaming output

```bash
node bin/alix.js run "echo hello" --session-mode bypass
```

**Expected:**
- Output appears character-by-character or line-by-line (streaming)
- Visible output before the command completes

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.8: Task with scope expansion (denied)

Run in a fresh test directory, or use `--mode=ask`:

```bash
node bin/alix.js run "create a new file called test.txt with content 'hello'" --session-mode ask --no-stream
```

**Expected:**
- Plan generated and printed
- Plan approved, execution starts
- When tool wants to create a file, permission prompt appears
- Type `n` to deny → task continues without creating the file

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.9: --help flag

```bash
node bin/alix.js --help
```

**Expected:**
- Shows usage text with all commands
- Mentions plan mode as default
- Shows `--no-plan`, `--no-stream`, `--mode=` flags
- Version displayed

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### A.10: --version flag

```bash
node bin/alix.js --version
```

**Expected:**
- Prints `0.2.0-rc.1`

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite B: Plan Mode (`--plan` default behavior)

### B.1: Research task auto-approves plan

```bash
node bin/alix.js run "research the best caching strategies" --session-mode bypass --no-stream
```

**Expected:**
- No plan approval prompt shown
- No plan output printed
- Task executes directly

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### B.2: Plan saved to disk

After running A.4, check:

```bash
ls -la .alix/plans/
```

**Expected:**
- A `.md` file exists in `.alix/plans/`
- File name matches the session ID from the run
- File contains the plan content (Summary, Changes, Verification, Risk Assessment)

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### B.3: Empty plan rejection

Run a task with a single character:

```bash
node bin/alix.js run "x" --session-mode bypass --no-stream
```

**Expected:**
- Plan generated (or task executed directly if classified as read-only)
- No crash or error

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite C: Configuration

### C.1: Show config

```bash
node bin/alix.js config show
```

**Expected:**
- Shows current configuration (model, permissions, etc.)
- Does not crash
- Shows provider and model name

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### C.2: Set API key

```bash
# Non-interactive test (just verify the command exists)
node bin/alix.js config set-key 2>&1 | head -5
```

**Expected:**
- Shows provider selection menu
- Interactive prompt for selecting a provider

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### C.3: Set default model

```bash
# Just verify the command launches the menu
node bin/alix.js config set-default-model 2>&1 | head -5
```

**Expected:**
- Shows provider selection
- Fetches models from the selected provider API

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### C.4: Set tier model

```bash
node bin/alix.js config set-tier 2>&1 | head -5
```

**Expected:**
- Shows tier selection menu (thinking, coding, fast)
- Then provider selection

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite D: Init

### D.1: Init without prompt (bare init)

```bash
mkdir -p /tmp/alix-test-init && cd /tmp/alix-test-init
rm -rf .alix .git AGENTS.md
node /path/to/alix/bin/alix.js init
```

**Expected:**
- `.alix/config.json` created
- `AGENTS.md` created
- Git initialized (if not already)
- `.gitignore` updated with `.alix/` entry
- Project type detected (Node.js if package.json exists, Generic otherwise)

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### D.2: Init with scaffold prompt (requires provider)

```bash
cd /tmp && mkdir -p alix-test-scaffold && cd alix-test-scaffold
node /path/to/alix/bin/alix.js init "create a Fastify API server with TypeScript"
```

**Expected:**
- `.alix/config.json` created
- Agent runs the scaffold task
- Fastify project files created (package.json, tsconfig.json, src/ directory)
- `Session:` printed at the end

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite E: Chat Mode

### E.1: Start chat session

```bash
echo "/exit" | node bin/alix.js chat --session-mode bypass
```

**Expected:**
- Chat session starts
- Prints session ID
- Shows "Type /exit or /quit to end"
- Exits cleanly when `/exit` typed

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### E.2: Ask a question in chat

```bash
printf 'what is 2+2?\n/exit\n' | node bin/alix.js chat --session-mode bypass
```

**Expected:**
- Question sent to model
- Response printed
- Session saved

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### E.3: Chat commands

```bash
printf '/help\n/exit\n' | node bin/alix.js chat
```

**Expected:**
- Shows available commands: /exit, /quit, /clear, /context, /model, /remember, /task, /decision

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### E.4: Session listing

```bash
node bin/alix.js chat --list
```

**Expected:**
- Lists recent sessions with message count and timestamp
- Or "No sessions found." if none exist

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite F: Memory

### F.1: List memory

```bash
node bin/alix.js memory list
```

**Expected:**
- Lists all memory entries
- Or empty list if none

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### F.2: Add memory

```bash
node bin/alix.js memory add --name test-note --content "This is a test memory entry"
```

**Expected:**
- Memory entry added
- No crash

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### F.3: Memory search

```bash
node bin/alix.js memory list --query test
```

**Expected:**
- Searches memory entries
- Returns matching results

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite G: MCP

### G.1: List MCP servers

```bash
node bin/alix.js mcp list
```

**Expected:**
- Lists connected MCP servers
- Shows the default `fetch` server
- Shows tools available from each server

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### G.2: MCP test (fetch)

```bash
node bin/alix.js mcp test fetch
```

**Expected:**
- Tests the fetch MCP server connection
- Reports success or failure

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### G.3: Discover MCP package

```bash
node bin/alix.js mcp discover mcp-server-fetch
```

**Expected:**
- Searches npm for the MCP package
- Shows package information

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite H: Extensions

### H.1: List extensions

```bash
node bin/alix.js extension list
```

**Expected:**
- Lists installed extensions (skills, hooks)
- Shows their names and descriptions
- Or shows empty list if none installed

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### H.2: Search extensions (requires internet)

```bash
node bin/alix.js extension search test
```

**Expected:**
- Searches extension registry
- Shows results or "no results"

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite I: Inspector (Server)

### I.1: Start inspector server

```bash
timeout 5 node bin/alix.js serve 2>&1 || true
```

**Expected:**
- Server starts
- Shows URL: `http://127.0.0.1:4137`
- Logs incoming connections

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### I.2: Inspector health check

```bash
node bin/alix.js serve &
sleep 2
curl http://127.0.0.1:4137/api/health 2>/dev/null || echo "Health endpoint not found"
kill %1 2>/dev/null
```

**Expected:**
- Health endpoint returns OK
- Server responds

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite J: TUI Mode

### J.1: TUI launches

```bash
# Press q immediately to quit
echo "q" | timeout 5 node bin/alix.js tui 2>&1 || true
```

**Expected:**
- TUI starts (may need a real terminal)
- Shows session interface
- Exits cleanly

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite K: Agent (Subagent)

### K.1: Spawn explorer subagent

```bash
node bin/alix.js agent explorer "list the files in src/" --session-mode bypass 2>&1
```

**Expected:**
- Subagent spawned
- Returns findings about src/ directory
- Role is "explorer" (read-only)

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### K.2: Spawn reviewer subagent

```bash
node bin/alix.js agent reviewer "review src/task-classifier.ts" --session-mode bypass 2>&1
```

**Expected:**
- Subagent spawned
- Reviews the file
- Returns feedback

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite L: Error Handling

### L.1: Empty task

```bash
node bin/alix.js run ""
```

**Expected:**
- Error message shown
- Non-zero exit code
- Does not crash or hang

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### L.2: Unknown command

```bash
node bin/alix.js unknowncommand
```

**Expected:**
- Shows help text
- Does not crash

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### L.3: Invalid flag combination

```bash
node bin/alix.js run "test" --no-plan --mode=invalid
```

**Expected:**
- If mode is invalid, task may still proceed with default session mode
- No crash or unhandled exception

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### L.4: Interrupt during plan (Ctrl+C)

```bash
# Run in background, kill after 2 seconds
timeout 3 node bin/alix.js run "add a healthz endpoint" 2>&1 || true
```

**Expected:**
- Plan generated
- On timeout/SIGINT, process exits cleanly
- No zombie processes

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite M: Cross-Feature

### M.1: Init then run in same directory

```bash
cd /tmp && mkdir -p alix-cross-test && cd alix-cross-test
/path/to/alix/bin/alix.js init
/path/to/alix/bin/alix.js run "echo 'hello from alix'" --session-mode bypass --no-stream
```

**Expected:**
- Init creates `.alix/config.json`
- Run uses the config to execute the task
- Output shows `hello from alix`
- Session logged to `.alix/sessions/`

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### M.2: Session replay via inspector

```bash
# Run a task first
node bin/alix.js run "ls" --session-mode bypass --no-stream
# Note the session ID from output
# Start inspector
node bin/alix.js serve &
sleep 2
# Open inspector URL in browser: http://127.0.0.1:4137
# Find the session in the Sessions list
# Click to view session replay
kill %1 2>/dev/null
```

**Expected:**
- Inspector shows the session in the list
- Session events are replayable (tool calls, outputs, decisions)
- $ cost is calculated and displayed

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite N: Web Tools

### N.1: Web search (requires BRAVE_API_KEY)

```bash
BRAVE_API_KEY="your-key-here" node bin/alix.js run "search the web for latest AI news" --session-mode bypass --no-plan --no-stream
```

**Expected:**
- Agent uses web_search tool
- Returns search results
- Responds based on results

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### N.2: Web fetch (requires BRAVE_API_KEY)

```bash
BRAVE_API_KEY="your-key-here" node bin/alix.js run "fetch https://example.com and summarize the page" --session-mode bypass --no-plan --no-stream
```

**Expected:**
- Agent uses web_fetch tool
- Fetches page content
- Summarizes the content

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Test Suite O: Long-Running / Stability

### O.1: Multiple rapid tasks

```bash
for i in 1 2 3 4 5; do
  node bin/alix.js run "echo task $i" --session-mode bypass --no-stream
done
```

**Expected:**
- All 5 tasks complete successfully
- No memory leaks or crashes
- Each gets its own session ID
- Sessions directory has 5 new entries

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

### O.2: Session persistence between tasks

```bash
# Run first task
node bin/alix.js run "echo first task" --session-mode bypass --no-stream
# Run second task — verify sessions accumulate
ls .alix/sessions/ | wc -l
```

**Expected:**
- Session count increases with each run
- Events JSONL files are present in each session directory
- No session files are corrupted

**Result:** `[  ]` PASS / `[  ]` FAIL
**Notes:**

---

## Regression Checklist

Run before every release:

| # | Test | Status |
|---|------|--------|
| A.1 | Hello World (echo) | `[  ]` |
| A.2 | List files (ls) | `[  ]` |
| A.4 | Plan + approve | `[  ]` |
| A.5 | Plan + reject | `[  ]` |
| A.9 | Help text | `[  ]` |
| A.10 | Version | `[  ]` |
| C.1 | Config show | `[  ]` |
| D.1 | Init | `[  ]` |
| E.1 | Chat start/exit | `[  ]` |
| L.1 | Empty task error | `[  ]` |
| L.2 | Unknown command | `[  ]` |
| O.1 | Rapid tasks | `[  ]` |

---

## Bug Report Template

```
## Bug Report

**Test:** <test-id> (e.g., A.3)

**Command:**
```
<command that failed>
```

**Expected:**
<what should happen>

**Actual:**
<what actually happened>

**Environment:**
- OS: <linux/mac/windows>
- Node version: <node -v>
- ALiX version: <node bin/alix.js --version>
- Model provider: <deepseek/google/openai>

**Session ID:** <session-id from output>

**Session Events:**
```
<tail -50 .alix/sessions/<id>/events.jsonl>
```
```
