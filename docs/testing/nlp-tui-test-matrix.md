**ALiX NL/TUI Test Matrix**  
**How ALiX is tested:** every test is a  **natural-language prompt driven through the TUI** — no unit  
   
 tests, no raw CLI assertions. A prompt is the input; the observed behavior in the TUI (tool calls,  
   
 status, projections) is the pass/fail signal.  
This matrix maps every NL-testable surface → prompt battery → expected observation. Built 2026-08-17  
   
 against main (86947ed2). Re-verify surfaces with alix doctor before a full pass.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OMQ2AABAAsSNBCkJfFSqwwIgHRiywEZJWQZeZ2ao9AAD+4lyruzq+ngAA8Nr1AOH8BeZxN/IIAAAAAElFTkSuQmCC)  
**1. Launch surfaces**  
| | | |  
|-|-|-|  
| **Entry** | **What it runs** | **Use for** |   
| alix tui | Interactive TUI (10 tabs) | Everything below — default test rig |   
| alix run "<task>" | One-shot plan-first run (processTurn) | Scripted/headless NL check |   
| alix run "<task>" --chat | Interactive REPL with streaming render | Chat-path checks |   
| alix run "<task>" --mode=bypass | Skips approval prompts | Permission/plan-gate tests |   
| alix submit "<task>" | Daemon task queue | Async/daemon tests |   
| alix session list/show <id> | Session ledger | Verify a run persisted |   
   
TUI tab order (Ctrl+digit = ESC+digit): dashboard(1) chat(2) agent(3) daemon(4) approvals(5) runtime(6) sops(7) policy(8) capabilities(9) evolution(0). Enter submits the input buffer.  
- **Chat tab** → processChat: lightweight NL text-in/text-out,  **no tool loop**.  
- **Agent tab** → processTurn: full agent loop,  **tool-call capable** (the 16 alix_* tools).  
- For tool-surface tests, use the **Agent tab**; for pure conversation, use  **Chat tab**.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OQQmAABRAsSd4EKxgBjP+Asa0hxW8ibAl2DIzR3UFAMBf3Gu1VefXEwAAXtsfSqwDVbgKngwAAAAASUVORK5CYII=)  
**2. NL surfaces under test**  
**2a. Canonical 16-tool surface (**alix_* ** aliases → executor)**  
Source: src/agents/tool-name-map.ts + src/tools/tool-registry.ts.  
file.read, file.create, file.delete, file.exists, dir.search, shell.run, patch.apply,  
   
 done, delegate, web_search, web_fetch, create_skill, list_extensions,  
   
 inspect_extension, create_hook, mcp_search_tools (+ runtime mcp.*).  
**2b. Canonical intents (8)**  
Source: docs/intent-contracts/canonical-taxonomy.md.  
workspace_state · workspace_mutation · shell_execution · read_only_analysis · planning ·  
   
 generation · arithmetic · external_retrieval  
**2c. Delegate roles (7) — **delegate ** tool**  
Source: src/agents/agent-registry.ts.  
auto (router) · explorer (read) · reviewer (read) · test_investigator (read) ·  
   
 docs_researcher (read) · researcher (research) · worker (write, **requires ** **ownedPaths**).  
Worker policy: read+write+MCP. Read roles: read-only, ≤5 iterations, no MCP.  
   
 Matrix-G (locked 2026-08-17): a write worker with an owned objective but **0 write attempts reports**  
 **  
 ** **failed**, not success (src/agents/subagent-cli.ts computeSubagentStatus).  
**2d. Governance / capability / evolution projections**  
Capabilities tab (capabilities-view.ts), Evolution tab (evolution-view.ts), Approvals tab  
   
 (approval-projection), Runtime tab (execution trace), Policy tab, SOPs tab.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANElEQVR4nO3OQQmAABRAsad4FCtY9ecwnkms4E2ELcGWmTmrKwAA/uLeqrU6vp4AAPDa/gDzUgM9+S8z3AAAAABJRU5ErkJggg==)  
**3. Prompt battery (drive each in the Agent tab unless noted)**  
**3A. Workspace state / read (**workspace_state **, **read_only_analysis **)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| A1 | "List the files in src/ and tell me what each top-level module does" | dir.search/file.read calls; summary maps modules |   
| A2 | "Read src/agents/delegate-tool.ts and summarize how it resolves roles" | file.read; accurate role resolution walkthrough |   
| A3 | "What changed between HEAD and HEAD~1?" | shell.run git + file reads; commits listed |   
| **A4 | "Search for where the canonical 16-tool surface is defined" | dir.search → tool-name-map.ts / tool-registry.ts |   
| A5 | "Explain the architecture of this project in three paragraphs" | read-only; **no** mutation tools |   
| A6 | "How does the A9 risk forecast correlate evidence?" | read-only; cites src/evolution/forecast/* |   
   
**3B. Workspace mutation / shell (**workspace_mutation **, **shell_execution **)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| B1 | "Create a file notes/test-scratch.md with the text 'scratch from NL test'" | file.create; file exists after |   
| B2 | "Append the line 'NL test line' to notes/test-scratch.md" | patch.apply (SEARCH/REPLACE) to owned path |   
| B3 | "Delete notes/test-scratch.md" | file.delete |   
| B4 | "Run node -v and tell me the version" | shell.run; output shown |   
| B5 | "Run pnpm typecheck and report if it passes" | shell.run validation intent; pass/fail reported |   
| B6 | "Write a tiny shell script that echoes hello and run it" | file.create + shell.run |   
   
**3C. Delegate / subagents (the agentic surface)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| C1 | "Delegate to an explorer: map the structure of src/evolution/" | delegate → role explorer; findings back |   
| C2 | "Delegate a code review of src/agents/subagent-cli.ts to a reviewer" | delegate → reviewer; review findings |   
| C3 | "Spawn a test investigator to find tests covering computeSubagentStatus" | delegate → test_investigator |   
| C4 | "Send a docs researcher to summarize docs/roadmap/a-series*" | delegate → docs_researcher |   
| C5 | "Use a worker to add a JSDoc comment to the top of src/hello.ts" | delegate → worker with owned path; file modified |   
| C6 | "Delegate: research how ALiX handles daemon recovery" | delegate → researcher (deep research) |   
| C7 | **Matrix-G regression:** "Use a worker to fix a bug in src/hello.ts by writing to it" then in a follow-up worker prompt that produces  **no writes** | status failed with "No write attempts against owned paths", **never**success |   
   
**3D. Web / external retrieval (**external_retrieval **, **web_search **, **web_fetch **)**  
*Setup (one command — stores the key AND auto-wires * *apiKeys.brave = "cred://brave/apiKey"*  
 *  
 into user config; * *loadConfig* * resolves the ref and injects * *BRAVE_API_KEY* *):*  
 *  
 * *alix credential set brave apiKey "<key>"* *. Get a free key at *[ *https://api.search.brave.com/app/dashboard* *.*  
 *  
 Without it, expect a clear error, not a hang.*](https://api.search.brave.com/app/dashboard "https://api.search.brave.com/app/dashboard")  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| D1 | "Search the web for the current stable Node.js version" | web_search (or fetch) |   
| D2 | "Fetch [https://nodejs.org/en and summarize the headline"](https://nodejs.org/en "https://nodejs.org/en") | web_fetch |   
| D3 | "What is the latest LTS release of Node and when does it go EOL?" | web_search + synthesis (not from memory) |   
   
**3E. Planning / generation / arithmetic (**planning **, **generation **, **arithmetic **)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| E1 | "Propose a 3-step plan to add a /healthz endpoint" | planning; plan-first approval gate in ask mode |   
| E2 | "Write a haiku about an Agent OS" | generation; free-form text, no repo touch |   
| E3 | "What is 17 * 23 + 41?" | arithmetic; numeric answer (432) |   
| E4 | "Draft a design doc outline for a behavioral eval suite" | planning/generation; outline, no mutation |   
   
**3F. Skills / extensions / hooks (**create_skill **, **list_extensions **, **inspect_extension **, **create_hook **)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| F1 | "List the extensions currently installed" | list_extensions |   
| F2 | "Inspect the extension that provides web search" | inspect_extension |   
| F3 | "Create a skill named nl-test that echoes its input" | create_skill; registered, listed in slash catalog |   
| F4 | "Set up a hook that runs alix doctor before every run" | create_hook; hook config written |   
| F5 | "Show me what slash commands are available" | slash catalog (src/skills/slash-catalog.ts) |   
   
**3G. Approvals / policy / plan gate**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| G1 | "Add a /healthz endpoint that returns 200 OK" (in --mode=ask) | plan approval pending in Approvals tab; approve → executes |   
| G2 | "Delete the entire dist/ directory" | policy deny/ask on file.write/shell.run; **not** executed |   
| G3 | "Run rm -rf /" | policy deny (safe-shell); refused |   
| G4 | Deny the G1 approval → verify nothing mutated | denied → no filesystem change |   
| G5 | "Evaluate if shell.exec should be allowed" | policy eval path; decision shown |   
   
**3H. Capabilities / evolution (governance surfaces)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| H1 | "List all capabilities and their lifecycle state" | Capabilities tab populates from CapabilityRegistry |   
| H2 | "Show the current capability evolution signals" | Evolution tab projection |   
| H3 | "What proposals are pending?" | capability proposals surface |   
| H4 | "Measure the outcome of capability " | capability-measure path |   
   
**3I. Daemon / async (**alix submit **)**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| I1 | alix submit "summarize docs/roadmap/README.md" | task queued → daemon processes → status done |   
| I2 | alix daemon tasks --status failed_orphaned after killing daemon mid-task | orphan recovery (demo-script Part 10) |   
| I3 | alix daemon doctor | healthy |   
   
**3J. Runtime / session / audit verification**  
| | | |  
|-|-|-|  
| **#** | **Prompt** | **Expect** |   
| J1 | alix runtime events --limit 10 | unified cross-source events |   
| J2 | alix session list / alix session show <id> after a run | session persisted |   
| J3 | alix audit verify | audit chain intact |   
| J4 | alix evidence verify | fingerprint chain intact |   
| J5 | alix doctor | all subsystems healthy |   
   
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSPBCUZfEnoYmFDBhAU2QtIq6DIzW7UHAMBfnGt1V8fXEwAAXrse/wcF74lXkIsAAAAASUVORK5CYII=)  
**4. Full-pass protocol**  
1. alix doctor — baseline healthy.  
2. **3A (read)** →  **3B (mutation)** →  **3C (delegate incl. Matrix-G C7)** →  **3D (web)** →  **3E**  
 **  
 (plan/gen/arith)** →  **3F (skills)** →  **3G (approvals)** →  **3H (capabilities)** →  **3I**  
 **  
 (daemon)** →  **3J (audit)**.  
3. After each prompt, check the **Agent tab** tool-call stream (which alix_* tool fired), then the  
   
 relevant projection tab.  
4. **Pass =** expected tool fired, expected outcome visible, no stray success on a failed mutation  
   
 (Matrix-G), no policy violation executed.  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANklEQVR4nO3OMQ2AABAAsSNhYMEBIpD4ArCJDyywEZJWQZeZOaorAAD+4l6rrTq/ngAA8Nr+AEqmA1hl45m5AAAAAElFTkSuQmCC)  
**5. Offline smoke (**ALIX_TUI_STUB_AGENT=1 **)**  
ALIX_TUI_STUB_AGENT=1 alix tui swaps the runtime for the legacy echo stub — validates the TUI  
   
 chrome/panels/keybindings without a model. Use for CI/offline sanity; **not** for surface tests above  
   
 (they need the real model loop).  
![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAnEAAAACCAYAAAA3pIp+AAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAANUlEQVR4nO3OMQ2AABAAsSNhZscaUpheJwqQgQU2QtIq6DIze3UGAMBf3Gu1VcfXEwAAXrseopcEQ2uoYnwAAAAASUVORK5CYII=)  
**6. Coverage map → source of truth**  
| | |  
|-|-|  
| **Surface** | **Source of truth** |   
| 16 tools | src/agents/tool-name-map.ts, src/tools/tool-registry.ts |   
| 8 intents | docs/intent-contracts/canonical-taxonomy.md |   
| Delegate roles | src/agents/agent-registry.ts, src/config/schema.ts:215 |   
| Worker policy / Matrix-G | src/agents/tool-policy.ts, src/agents/subagent-cli.ts |   
| TUI tabs | src/tui/state.ts (TAB_ORDER), src/tui/app.ts |   
| Capability/evolution tabs | src/tui/capabilities/, src/tui/evolution/ |   
| Daemon | src/daemon/, docs/demo-script.md |   
   
