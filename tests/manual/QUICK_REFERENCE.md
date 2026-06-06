# Automated Test Runner

```bash
npm run build && node --test dist/tests/manual/suite-*.test.js
```

Runs all 10 suites (57 tests). Results in ~5 minutes.
Some tests skip if no API key or TTY is available.

---

### Test Suite A: Basic CLI (`alix run`)

| ID | Test | Expected | Status |
|----|------|----------|--------|
| A.1 | `echo hello` (--session-mode bypass --no-stream) | No plan, prints "hello" | `[  ]` |
| A.2 | `ls` (--session-mode bypass --no-stream) | No plan, lists files | `[  ]` |
| A.3 | `who is the president` (--no-plan) | Skips plan, answers question | `[  ]` |
| A.4 | Plan mode approve (echo "y" pipe) | Plan generated, executes after approval | `[  ]` |
| A.5 | Plan mode reject (echo "n" pipe) | Plan rejected, task cancelled | `[  ]` |
| A.6 | Detail view (d key) | Shows expanded details | `[  ]` |
| A.7 | Streaming output | Character-by-character output | `[  ]` |
| A.8 | Scope expansion denied | Permission prompt, task continues | `[  ]` |
| A.9 | --help | Shows all commands | `[  ]` |
| A.10 | --version | Shows 0.2.0-rc.1 | `[  ]` |

### Test Suite B: Plan Mode

| ID | Test | Expected | Status |
|----|------|----------|--------|
| B.1 | Research task | No plan prompt, direct execution | `[  ]` |
| B.2 | Plan saved to disk | .alix/plans/<session>.md exists | `[  ]` |

### Test Suite C: Configuration

| ID | Test | Expected | Status |
|----|------|----------|--------|
| C.1 | config show | Shows model/perms/settings | `[  ]` |
| C.2 | config set-key | Provider selection menu | `[  ]` |
| C.3 | config set-default-model | Provider + model selection | `[  ]` |
| C.4 | config set-tier | Tier selection menu | `[  ]` |

### Test Suite D: Init

| ID | Test | Expected | Status |
|----|------|----------|--------|
| D.1 | Bare init | .alix/config.json + AGENTS.md | `[  ]` |
| D.2 | Init with scaffold | Agent scaffolds the project | `[  ]` |

### Test Suite E: Chat

| ID | Test | Expected | Status |
|----|------|----------|--------|
| E.1 | Start/exit | Session created, exits cleanly | `[  ]` |
| E.2 | Ask question | Model responds | `[  ]` |
| E.3 | /help command | Shows available commands | `[  ]` |
| E.4 | --list | Lists recent sessions | `[  ]` |

### Test Suite F: Memory

| ID | Test | Expected | Status |
|----|------|----------|--------|
| F.1 | memory list | Lists entries or empty | `[  ]` |
| F.2 | memory add | Entry saved | `[  ]` |
| F.3 | memory list --query | Searches entries | `[  ]` |

### Test Suite G: MCP

| ID | Test | Expected | Status |
|----|------|----------|--------|
| G.1 | mcp list | Shows fetch server + tools | `[  ]` |
| G.2 | mcp test fetch | Connection test | `[  ]` |
| G.3 | mcp discover | Searches npm | `[  ]` |

### Test Suite H: Extensions

| ID | Test | Expected | Status |
|----|------|----------|--------|
| H.1 | extension list | Lists installed extensions | `[  ]` |
| H.2 | extension search | Searches registry | `[  ]` |

### Test Suite I: Inspector

| ID | Test | Expected | Status |
|----|------|----------|--------|
| I.1 | serve start | Server starts, URL shown | `[  ]` |
| I.2 | Health check | Returns OK | `[  ]` |

### Test Suite J: TUI

| ID | Test | Expected | Status |
|----|------|----------|--------|
| J.1 | TUI launch | Starts and exits cleanly | `[  ]` |

### Test Suite K: Subagents

| ID | Test | Expected | Status |
|----|------|----------|--------|
| K.1 | explorer subagent | Returns file findings | `[  ]` |
| K.2 | reviewer subagent | Returns code review | `[  ]` |

### Test Suite L: Error Handling

| ID | Test | Expected | Status |
|----|------|----------|--------|
| L.1 | Empty task | Error message | `[  ]` |
| L.2 | Unknown command | Shows help | `[  ]` |
| L.3 | Invalid flag | Graceful handling | `[  ]` |
| L.4 | Ctrl+C during plan | Clean exit | `[  ]` |

### Test Suite M: Cross-Feature

| ID | Test | Expected | Status |
|----|------|----------|--------|
| M.1 | Init then run | Config reused across commands | `[  ]` |
| M.2 | Session replay via inspector | Tool calls + cost visible | `[  ]` |

### Test Suite N: Web Tools

| ID | Test | Expected | Status |
|----|------|----------|--------|
| N.1 | web_search | Search results returned | `[  ]` |
| N.2 | web_fetch | Page content fetched | `[  ]` |

### Test Suite O: Stability

| ID | Test | Expected | Status |
|----|------|----------|--------|
| O.1 | 5 rapid tasks | No memory leaks, all complete | `[  ]` |
| O.2 | Session accumulation | Sessions persist correctly | `[  ]` |

---

## Quick Run (single command per suite)

```bash
# A: Basic CLI
echo "y" | node bin/alix.js run "echo hello" --session-mode bypass --no-stream
echo "y" | node bin/alix.js run "ls" --session-mode bypass --no-stream

# B: Plan mode
echo "y" | node bin/alix.js run "add a readme badge" --session-mode bypass --no-stream

# C: Config
node bin/alix.js config show

# D: Init
mkdir -p /tmp/alix-manual-test && cd /tmp/alix-manual-test && node /path/to/alix/bin/alix.js init

# L: Error handling
node bin/alix.js run ""
node bin/alix.js unknowncommand
```
