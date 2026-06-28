# P7.6 — ALiX Chat Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `alix chat` as the interactive operator console for ALiX — a persistent REPL that routes messages into the existing lifecycle spine without adding mutation power.

**Architecture:** A readline-based REPL backed by two append-only JSONL stores — `sessions.jsonl` for session metadata (written once per session), `messages.jsonl` for individual messages (one line per message, keyed by sessionId). This avoids O(n²) growth that would come from appending full session snapshots. Messages flow through a keyword-based router into existing lifecycle commands. Chat never imports appliers or calls approve/apply/reject.

**Tech Stack:** Node.js readline (built-in), two JSONL files (same pattern as IntentStore/OutcomeStore), no new dependencies.

## Global Constraints

- NodeNext module resolution — all local imports use `.js` extension
- DecisionArtifact pattern — ChatSession extends DecisionArtifact from `src/adaptation/decision-types.js`
- Append-only stores — no update, no delete, no compaction
- Session metadata and messages stored separately (two JSONL files) to prevent O(n²) growth on long conversations
- Chat ≠ Execution — Chat may inspect, route, create intents, or propose, but must not directly mutate state
- Chat must not import applier modules
- Chat must not call approve/apply/reject directly
- Ponytail mode — shortest diff, no boilerplate, no unrequested abstractions

## Future Compatibility Notes (not implementing now, but informing the design)

- **`invoke_agent` route** is reserved in the ChatRoute type even though unused initially. After P8/P9 the route set will be `run_skill | invoke_agent | inspect_state | create_intent | propose_intent | run_task | answer | unknown`. Adding the type slot now avoids type churn.
- **`alix ask "..."`** will be added later as a scriptable single-shot wrapper around the same router: `alix ask "show pending proposals"` → Chat Runtime → route → action → print + exit. The router and inspector handlers are designed to be reused. The `ask` command is not part of P7.6.
- **ChatContextBuilder** will be added before P8 to inject recent proposals, outcomes, pipeline health, and installed skills into chat responses. This is why `ChatMessage` has a `generatedArtifacts` field — it's reserved now for the traceability the builder will produce.
- **Message indexing** (`getMessages` scans the full JSONL file) is fine for P7.6 scales. At P8/P9 scale (100+ sessions, 50k+ messages), partitioned message logs or an index will be needed. Not implementing now — noted for the roadmap.

---

## File Structure

```
src/chat/
  chat-types.ts            ← ChatSession, ChatMessage, ChatRoute, ChatRouteDecision
  chat-session-store.ts    ← Dual-file JSONL store (sessions.jsonl + messages.jsonl)
  chat-intent-router.ts    ← Keyword-based router (P7.6b)
  chat-repl.ts             ← Readline REPL loop (P7.6a)
  chat-skill-bridge.ts     ← Wires chat to SkillLoader + ExecutionIntent + IntentProposalMapper (P7.6c)
  chat-inspector.ts        ← Read-only state inspection handlers (P7.6d)

tests/chat/
  chat-types.vitest.ts
  chat-session-store.vitest.ts
  chat-intent-router.vitest.ts
  chat-repl.vitest.ts
  chat-skill-bridge.vitest.ts
  chat-inspector.vitest.ts
  chat-sentinels.vitest.ts

Modified:
  src/cli.ts               ← Add `alix chat` dispatch before the `run` handler
```

## Execution Order (Slices)

The spec recommends smallest-first PRs. Each slice is its own PR:

1. **P7.6a** — Tasks 1, 2, 3 (types + store + REPL) — functional `alix chat` with persistence
2. **P7.6b** — Task 4 (router) — message classification
3. **P7.6c** — Task 5 (skill bridge) — `/run-skill`, `/intent`, `/propose` inside chat
4. **P7.6d** — Task 6 (inspector) — `/proposals`, `/skills`, `/outcomes`, etc.
5. **P7.6e** — Task 7 (sentinels) — governance boundary enforcement

---

### Task 1: Chat Types

**Files:**
- Create: `src/chat/chat-types.ts`
- Test: `tests/chat/chat-types.vitest.ts`

**Interfaces:**
- Produces: `ChatSession`, `ChatMessage`, `ChatRoute`, `ChatRouteDecision` — consumed by all subsequent tasks
- `ChatRoute` reserves `"invoke_agent"` for future use (P8/P9+)
- `ChatMessage` carries `sourceArtifacts` (what informed the response) and `generatedArtifacts` (what was produced)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type { ChatSession, ChatMessage, ChatRoute, ChatRouteDecision } from "../../src/chat/chat-types.js";

describe("ChatSession types", () => {
  it("accepts a valid ChatSession shape", () => {
    const session: ChatSession = {
      id: "chat:2026-06-22-abc123",
      subject: "Test session",
      outcome: "captured",
      confidence: 1,
      reasons: ["Test session created"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      title: "Test session",
      createdAt: "2026-06-22T00:00:00.000Z",
      updatedAt: "2026-06-22T00:00:00.000Z",
    };
    expect(session.id).toBe("chat:2026-06-22-abc123");
  });

  it("accepts messages with user role and artifact references", () => {
    const msg: ChatMessage = {
      id: "msg_01",
      role: "user",
      content: "show pending proposals",
      createdAt: "2026-06-22T00:00:00.000Z",
      sourceArtifacts: [{ type: "proposal", id: "prop_123" }],
      generatedArtifacts: [{ type: "proposal", id: "prop_456" }],
    };
    expect(msg.role).toBe("user");
    expect(msg.generatedArtifacts).toHaveLength(1);
  });

  it("includes invoke_agent in ChatRoute type", () => {
    // Compile-time check: "invoke_agent" must be assignable to ChatRoute
    const route: ChatRoute = "invoke_agent";
    expect(route).toBe("invoke_agent");
  });

  it("accepts ChatRouteDecision with unknown route", () => {
    const decision: ChatRouteDecision = {
      route: "unknown",
      confidence: 0,
      reasons: ["Could not classify"],
    };
    expect(decision.confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chat/chat-types.vitest.ts -t "ChatSession types"`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/chat/chat-types.ts

import type { DecisionArtifact, SourceArtifact } from "../adaptation/decision-types.js";

export type ChatRoute =
  | "answer"
  | "inspect_state"
  | "run_skill"
  | "invoke_agent"       // reserved — wired in P8/P9+
  | "consult_intelligence"  // reserved — P8 accuracy/health queries
  | "create_intent"
  | "propose_intent"
  | "run_task"
  | "unknown";

export interface ChatRouteDecision {
  route: ChatRoute;
  confidence: number;
  reasons: string[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
  /** Route classification, set when the message is processed by the router (P7.6b+). */
  route?: ChatRoute;
  /** Confidence of the route classification (0-1). */
  routeConfidence?: number;
  /** Artifacts that informed this message (what the assistant read). */
  sourceArtifacts?: SourceArtifact[];
  /** Artifacts this message produced (intents, proposals, outcomes). */
  generatedArtifacts?: SourceArtifact[];
}

export interface ChatSession extends DecisionArtifact {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}
```

Key design note: `ChatSession` does NOT carry a `messages` array. Messages are stored separately (Task 2) and loaded via `load(id)` which reconstructs the full session with its messages from the two JSONL files.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chat/chat-types.vitest.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/chat-types.ts tests/chat/chat-types.vitest.ts
git commit -m "feat(p7.6a): chat types — ChatSession, ChatMessage, ChatRoute (reserve invoke_agent)"
```

---

### Task 2: Chat Session Store (Dual-File JSONL)

**Files:**
- Create: `src/chat/chat-session-store.ts`
- Test: `tests/chat/chat-session-store.vitest.ts`

**Interfaces:**
- Consumes: `ChatSession`, `ChatMessage` from Task 1
- Produces: `ChatSessionStore` class with `create()`, `createSessionWithId(id, title?)`, `load(id)`, `list()`, `appendMessage(id, message)`, `getMessages(sessionId)`

**Architecture:**
```
storeDir/
  sessions.jsonl     ← one line per session, written once at creation
  messages.jsonl     ← one line per message, keyed by sessionId
```

`load(id)` reads session metadata from `sessions.jsonl` + all messages for that session from `messages.jsonl`, returning a `ChatSession & { messages: ChatMessage[] }`. This avoids rewriting session history on every message — O(n) per-file growth instead of O(n²).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatSessionStore } from "../../src/chat/chat-session-store.js";

describe("ChatSessionStore", () => {
  let dir: string;
  let store: ChatSessionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chat-test-"));
    store = new ChatSessionStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a session and loads it back with no messages", async () => {
    const session = await store.create();
    expect(session.id).toMatch(/^chat:/);

    const loaded = await store.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.messages).toHaveLength(0);
  });

  it("appends messages to a session", async () => {
    const session = await store.create();
    const msg = {
      id: "msg_01",
      role: "user" as const,
      content: "hello",
      createdAt: new Date().toISOString(),
    };
    await store.appendMessage(session.id, msg);

    const loaded = await store.load(session.id);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe("hello");
  });

  it("load returns null for missing session", async () => {
    const result = await store.load("nonexistent");
    expect(result).toBeNull();
  });

  it("lists all sessions (metadata only, no messages)", async () => {
    await store.create("Session A");
    await store.create("Session B");
    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // list() returns session metadata, not full message history
    expect(list[0]).not.toHaveProperty("messages");
  });

  it("getMessages returns only messages for a given session", async () => {
    const s1 = await store.create();
    const s2 = await store.create();

    await store.appendMessage(s1.id, { id: "m1", role: "user" as const, content: "in s1", createdAt: "" });
    await store.appendMessage(s2.id, { id: "m2", role: "user" as const, content: "in s2", createdAt: "" });

    const s1msgs = await store.getMessages(s1.id);
    expect(s1msgs).toHaveLength(1);
    expect(s1msgs[0].content).toBe("in s1");
  });

  it("createSessionWithId creates session with explicit id", async () => {
    const session = await store.createSessionWithId("chat:my-session");
    expect(session.id).toBe("chat:my-session");
    const loaded = await store.load("chat:my-session");
    expect(loaded).not.toBeNull();
  });

  it("appendMessage advances updatedAt", async () => {
    const session = await store.create();
    const originalUpdatedAt = session.updatedAt;

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 10));

    const msg = { id: "m1", role: "user" as const, content: "hi", createdAt: new Date().toISOString() };
    await store.appendMessage(session.id, msg);

    const loaded = await store.load(session.id);
    expect(new Date(loaded!.updatedAt).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });

  it("survives corrupt lines in sessions.jsonl", async () => {
    const { appendFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    appendFileSync(join(dir, "sessions.jsonl"), "garbage\n");
    const session = await store.create();
    const loaded = await store.load(session.id);
    expect(loaded).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chat/chat-session-store.vitest.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/chat/chat-session-store.ts

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatSession, ChatMessage } from "./chat-types.js";

const SESSIONS_FILE = "sessions.jsonl";
const MESSAGES_FILE = "messages.jsonl";

function now(): string {
  return new Date().toISOString();
}

function dateKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sessionId(): string {
  return `chat:${dateKey()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reconstruct a full session (metadata + messages) from the two JSONL files. */
export interface SessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

function messageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export class ChatSessionStore {
  constructor(private readonly storeDir: string) {}

  // ---------------------------------------------------------------------------
  // Session CRUD
  // ---------------------------------------------------------------------------

  async create(title?: string): Promise<ChatSession> {
    this.ensureDir();
    const id = sessionId();
    const ts = now();
    const session: ChatSession = {
      id,
      subject: title ?? `Chat ${id}`,
      outcome: "captured",
      confidence: 1,
      reasons: ["Session created"],
      generatedAt: ts,
      title,
      createdAt: ts,
      updatedAt: ts,
    };
    await appendFile(this.sessionsPath(), JSON.stringify(session) + "\n", "utf-8");
    return session;
  }

  /**
   * Load a session with its full message history.
   * Returns null if no session with the given id exists.
   */
  async load(id: string): Promise<SessionWithMessages | null> {
    const sessions = await this.listSessions();
    const session = sessions.find((s) => s.id === id);
    if (!session) return null;
    const messages = await this.getMessages(id);
    return { ...session, messages };
  }

  /**
   * List all session metadata (without message history).
   */
  async list(): Promise<ChatSession[]> {
    return this.listSessions();
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Create a session with a specific ID. Useful when the caller has
   * an existing session id from a flag or previous message.
   */
  async createSessionWithId(id: string, title?: string): Promise<ChatSession> {
    this.ensureDir();
    const ts = now();
    const session: ChatSession = {
      id,
      subject: title ?? `Chat ${id}`,
      outcome: "captured",
      confidence: 1,
      reasons: ["Session created"],
      generatedAt: ts,
      title,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.#writeSessionLine(session);
    return session;
  }

  /**
   * Append a message to a session.
   * Session must already exist — call createSessionWithId first if needed.
   * Also writes a new session metadata line with advanced updatedAt
   * so the audit trail records when each message was added.
   */
  async appendMessage(sessionId: string, msg: ChatMessage): Promise<void> {
    this.ensureDir();
    // Assert session exists
    const existing = await this.listSessions().then((s) => s.find((s) => s.id === sessionId));
    if (!existing) {
      throw new Error(`Session ${sessionId} not found. Call createSessionWithId() first.`);
    }

    // Fill in defaults
    if (!msg.id) msg.id = messageId();
    if (!msg.createdAt) msg.createdAt = now();

    await appendFile(this.messagesPath(), JSON.stringify({ sessionId, message: msg }) + "\n", "utf-8");

    // Advance updatedAt by writing a new session metadata line
    const updated: ChatSession = { ...existing, updatedAt: now() };
    await this.#writeSessionLine(updated);
  }

  /**
   * Get all messages for a session, ordered by creation time.
   */
  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!existsSync(this.messagesPath())) return [];
    const raw = await readFile(this.messagesPath(), "utf-8");
    const msgs: ChatMessage[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as { sessionId: string; message: ChatMessage };
        if (entry.sessionId === sessionId) {
          msgs.push(entry.message);
        }
      } catch {
        // skip corrupt line silently
      }
    }
    return msgs.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  async #writeSessionLine(session: ChatSession): Promise<void> {
    await appendFile(this.sessionsPath(), JSON.stringify(session) + "\n", "utf-8");
  }

  private async listSessions(): Promise<ChatSession[]> {
    if (!existsSync(this.sessionsPath())) return [];
    const raw = await readFile(this.sessionsPath(), "utf-8");
    const sessions: ChatSession[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        sessions.push(JSON.parse(trimmed) as ChatSession);
      } catch {
        console.warn(`ChatSessionStore: skipping corrupt session line: ${trimmed.slice(0, 80)}`);
      }
    }
    // Deduplicate by id — last write wins (append-only means older lines are stale)
    const seen = new Map<string, ChatSession>();
    for (const s of sessions) {
      seen.set(s.id, s);
    }
    return Array.from(seen.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private sessionsPath(): string {
    return join(this.storeDir, SESSIONS_FILE);
  }
  private messagesPath(): string {
    return join(this.storeDir, MESSAGES_FILE);
  }

  private ensureDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o755 });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chat/chat-session-store.vitest.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/chat-session-store.ts tests/chat/chat-session-store.vitest.ts
git commit -m "feat(p7.6a): ChatSessionStore — dual-file JSONL (sessions + messages), O(n) growth"
```

---

### Task 3: Chat REPL CLI

**Files:**
- Create: `src/chat/chat-repl.ts`
- Modify: `src/cli.ts` (add `alix chat` dispatch before the `run` handler)
- Test: `tests/chat/chat-repl.vitest.ts`

**Interfaces:**
- Consumes: `ChatSessionStore` from Task 2
- Produces: `startRepl(store, opts?)` function — started by the CLI handler

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { ChatSessionStore } from "../../src/chat/chat-session-store.js";
import { startRepl } from "../../src/chat/chat-repl.js";

describe("Chat REPL", () => {
  it("exports startRepl function", () => {
    expect(typeof startRepl).toBe("function");
  });

  it("startRepl returns a teardown function", () => {
    const store = new ChatSessionStore("/tmp/nonexistent-test-dir");
    const teardown = startRepl(store, { dryRun: true });
    expect(typeof teardown).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chat/chat-repl.vitest.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/chat/chat-repl.ts

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ChatSessionStore } from "./chat-session-store.js";
import type { ChatMessage } from "./chat-types.js";

export interface ReplOptions {
  sessionId?: string;
  jsonMode?: boolean;
  /** If true, run a single cycle then close — used for testing */
  dryRun?: boolean;
}

export function startRepl(store: ChatSessionStore, opts: ReplOptions = {}): () => void {
  let closed = false;

  const run = async () => {
    // Load or create session
    let sessionId = opts.sessionId;
    if (sessionId) {
      const existing = await store.load(sessionId);
      if (!existing) {
        console.error(`Session ${sessionId} not found. Starting new session.`);
        const created = await store.create();
        sessionId = created.id;
      }
    } else {
      const created = await store.create();
      sessionId = created.id;
    }

    const session = await store.load(sessionId!);
    if (!session) return;

    // Print context from previous messages
    if (!opts.jsonMode) {
      console.log(`\n  ╔══════════════════════════════════════╗`);
      console.log(`  ║  ALiX Chat  —  ${sessionId!}  ║`);
      console.log(`  ╠══════════════════════════════════════╣`);
      console.log(`  ║  /help    — show commands            ║`);
      console.log(`  ║  /quit    — exit chat                ║`);
      console.log(`  ╚══════════════════════════════════════╝\n`);
      if (session.messages.length > 0) {
        console.log(`  (resuming session with ${session.messages.length} previous messages)\n`);
      }
    }

    if (opts.dryRun) return;

    const rl = createInterface({ input, output, prompt: "> " });
    rl.prompt();

    for await (const line of rl) {
      const trimmed = line.trim();
      if (closed) break;

      if (!trimmed) { rl.prompt(); continue; }

      if (trimmed === "/quit" || trimmed === "/exit") break;
      if (trimmed === "/help") {
        const help = [
          "  /help                          — show this message",
          "  /quit                          — exit chat",
          "",
          "  /proposals                     — show pending proposals",
          "  /skills                        — list installed skills",
          "  /intents                       — list captured intents",
          "  /outcomes                      — recent outcomes",
          "",
          "  /run-skill <id> <input>       — run a skill",
          "  /intent <description>          — create an execution intent",
          "  /propose <intent-id>           — map intent to proposal",
          "",
          "  Anything else is answered directly.",
        ].join("\n");
        if (opts.jsonMode) {
          console.log(JSON.stringify({ type: "help", commands: help }));
        } else {
          console.log(help);
        }
        rl.prompt();
        continue;
      }

      // Store user message
      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      await store.appendMessage(sessionId!, userMsg);

      // Basic echo/response for P7.6a
      let response = "";
      if (trimmed.startsWith("/")) {
        response = `[${sessionId!}] Command received: ${trimmed}. Full routing coming in P7.6b-P7.6d.`;
      } else {
        response = `[${sessionId!}] ${trimmed}`;
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content: response,
        createdAt: new Date().toISOString(),
      };
      await store.appendMessage(sessionId!, assistantMsg);

      if (opts.jsonMode) {
        console.log(JSON.stringify({ type: "response", sessionId: sessionId!, content: response }));
      } else {
        console.log(`\n${response}\n`);
      }
      rl.prompt();
    }

    closed = true;
    rl.close();
    if (!opts.jsonMode) console.log("\nChat ended.");
  };

  run().catch((err) => {
    console.error("Chat REPL error:", err);
    closed = true;
  });

  return () => { closed = true; };
}
```

- [ ] **Step 4: Add CLI dispatch in `src/cli.ts`**

Add before the `if (command === "run")` block (around line 1228):

```typescript
if (command === "chat") {
  const { ChatSessionStore } = await import("./chat/chat-session-store.js");
  const { startRepl } = await import("./chat/chat-repl.js");

  const sessionIdx = args.indexOf("--session");
  const sessionId = sessionIdx >= 0 && sessionIdx + 1 < args.length ? args[sessionIdx + 1] : undefined;
  const jsonMode = args.includes("--json");
  const forceNew = args.includes("--new");

  const storeDir = join(homedir(), ".alix", "chat", "sessions");
  const store = new ChatSessionStore(storeDir);

  const effectiveSessionId = forceNew ? undefined : sessionId;
  startRepl(store, { sessionId: effectiveSessionId, jsonMode });
  return; // REPL owns lifecycle
}
```

- [ ] **Step 5: Update usage text**

In the default/help handler at the top of `src/cli.ts`, add `chat` to the command list.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/chat/`
Expected: All chat tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/chat/chat-repl.ts tests/chat/chat-repl.vitest.ts
git commit -m "feat(p7.6a): alix chat REPL — persistent readline loop with dual-file store"
```

Then stage and amend the cli.ts change:

```bash
git add src/cli.ts
git commit -m "feat(p7.6a): wire alix chat into CLI dispatch"
```

---

### Task 4: Chat Intent Router (P7.6b)

**Files:**
- Create: `src/chat/chat-intent-router.ts`
- Test: `tests/chat/chat-intent-router.vitest.ts`

**Interfaces:**
- Produces: `routeMessage(input: string): ChatRouteDecision` — synchronous keyword-based router

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { routeMessage } from "../../src/chat/chat-intent-router.js";

describe("ChatIntentRouter", () => {
  it("routes 'show pending proposals' to inspect_state", () => {
    const result = routeMessage("show pending proposals");
    expect(result.route).toBe("inspect_state");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("routes 'run skill X' to run_skill", () => {
    const result = routeMessage("run skill architecture-review");
    expect(result.route).toBe("run_skill");
  });

  it("routes 'create intent' to create_intent", () => {
    const result = routeMessage("create an intent from this");
    expect(result.route).toBe("create_intent");
  });

  it("routes 'propose' to propose_intent", () => {
    const result = routeMessage("make this a proposal");
    expect(result.route).toBe("propose_intent");
  });

  it("routes greeting to answer", () => {
    const result = routeMessage("hello, what can you do?");
    expect(result.route).toBe("answer");
  });

  it("routes 'build me an app' to run_task", () => {
    const result = routeMessage("build me an app that tracks expenses");
    expect(result.route).toBe("run_task");
  });

  it("returns unknown for unclear input", () => {
    const result = routeMessage("banana phone");
    expect(result.route).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chat/chat-intent-router.vitest.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/chat/chat-intent-router.ts

import type { ChatRoute, ChatRouteDecision } from "./chat-types.js";

interface RoutePattern {
  route: ChatRoute;
  patterns: RegExp[];
  baseConfidence: number;
}

const ROUTE_PATTERNS: RoutePattern[] = [
  {
    route: "inspect_state",
    baseConfidence: 0.9,
    patterns: [
      /show\s+(pending\s+)?(proposals|queue)/i,
      /(pending|open)\s+proposals/i,
      /pipeline\s+health/i,
      /decision\s+(status|queue)/i,
    ],
  },
  {
    route: "run_skill",
    baseConfidence: 0.85,
    patterns: [
      /run\s+skill/i,
      /use\s+(the\s+)?(.+?)\s+skill/i,
      /execute\s+skill/i,
    ],
  },
  {
    route: "create_intent",
    baseConfidence: 0.85,
    patterns: [
      /create\s+(an\s+)?intent/i,
      /capture\s+(this|that|it)/i,
      /make\s+(this|that|it)\s+an?\s+intent/i,
      /turn\s+(this|that|it)\s+into\s+an?\s+intent/i,
    ],
  },
  {
    route: "propose_intent",
    baseConfidence: 0.85,
    patterns: [
      /\bpropose\b/i,
      /make\s+(this|that|it)\s+a\s+proposal/i,
      /create\s+a\s+proposal/i,
      /submit\s+proposal/i,
    ],
  },
  {
    route: "run_task",
    baseConfidence: 0.75,
    patterns: [
      /^build\s+(me\s+)?(a|an)/i,
      /^create\s+(a|an)\s+(app|cli|tool|service)/i,
      /implement/i,
      /write\s+(a|an|the)\s+(function|class|module)/i,
    ],
  },
];

const ANSWER_PATTERNS = [
  /^(hello|hi|hey|help|what can you do)/i,
  /^(who|what)\s+(are|is)\s+(you|this)/i,
  /how\s+(do|does|can|should)/i,
];

export function routeMessage(input: string): ChatRouteDecision {
  const trimmed = input.trim();
  if (!trimmed) return { route: "unknown", confidence: 0, reasons: ["Empty input"] };

  for (const pattern of ANSWER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { route: "answer", confidence: 0.9, reasons: ["Greeting or help question"] };
    }
  }

  for (const { route, patterns, baseConfidence } of ROUTE_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return { route, confidence: baseConfidence, reasons: [`Matched pattern: ${pattern.source}`] };
      }
    }
  }

  return { route: "unknown", confidence: 0.2, reasons: ["No pattern matched"] };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/chat/chat-intent-router.vitest.ts`
Expected: PASS

- [ ] **Step 5: Wire router into REPL**

Update `chat-repl.ts` to import and use `routeMessage` for non-`/` commands:

```typescript
// Inside the default (non-command) branch, replace the echo:
const decision = routeMessage(trimmed);
if (decision.route === "unknown" && decision.confidence < 0.5) {
  response = `Not sure what to do with that. Try /help to see available commands.`;
} else {
  response = `[${decision.route}] (confidence: ${decision.confidence}) — routing coming in P7.6c/P7.6d.`;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/chat/chat-intent-router.ts tests/chat/chat-intent-router.vitest.ts
git commit -m "feat(p7.6b): chat intent router — keyword-based message classification"
```

---

### Task 5: Chat Skill Bridge (P7.6c)

**Files:**
- Create: `src/chat/chat-skill-bridge.ts`
- Test: `tests/chat/chat-skill-bridge.vitest.ts`

**Interfaces:**
- Consumes: `ChatSessionStore`, `ExecutionIntent`, `IntentProposalMapper`
- Produces: `handleRunSkill(skillId, input, store, sessionId)`, `handleCreateIntent(description, store, sessionId)`, `handleProposeIntent(intentId)`

- [ ] **Step 1: Write tests** (sanity checks that each handler returns a string)

```typescript
import { describe, it, expect } from "vitest";

describe("ChatSkillBridge", () => {
  it("handleRunSkill returns error for unknown skill", async () => {
    const { handleRunSkill } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleRunSkill("nonexistent-skill", "input");
    expect(result).toContain("not found");
  });

  it("handleCreateIntent returns a string", async () => {
    const { handleCreateIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleCreateIntent("test", null as any, "sess_1");
    expect(typeof result).toBe("string");
  });

  it("handleProposeIntent returns error for missing intent", async () => {
    const { handleProposeIntent } = await import("../../src/chat/chat-skill-bridge.js");
    const result = await handleProposeIntent("nonexistent", "sess_1");
    expect(result).toContain("not found");
  });
});
```

- [ ] **Step 2: Implement bridge**

```typescript
// src/chat/chat-skill-bridge.ts

import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Run a skill by id with the given input.
 * Uses the real SkillLoader + ExtensionRegistry — same as `alix skill run`.
 */
export async function handleRunSkill(
  skillId: string,
  input: string,
): Promise<string> {
  const { createRegistry } = await import("../extension/registry.js");
  const { SkillLoader } = await import("../skills/loader.js");
  const { dirname } = await import("node:path");

  const registry = createRegistry();
  const ext = registry.get(`skill/${skillId}`);
  if (!ext) return `Skill not found: ${skillId}. Use /skills to list installed skills.`;

  const skillDir = dirname(ext.path);
  const loader = new SkillLoader(skillDir);
  const inputJson = input ? { input } : undefined;
  const loaded = await loader.load("SKILL", inputJson);
  if (!loaded) return `Failed to load skill: ${skillId} (SKILL.md not found).`;

  return loaded.content;
}

export async function handleCreateIntent(
  description: string,
  _store: unknown,
  sessionId: string,
): Promise<string> {
  const { IntentStore } = await import("../adaptation/intent-store.js");
  const intentDir = join(homedir(), ".alix", "execution", "intents");
  const intentStore = new IntentStore(intentDir);

  const intent = {
    source: "skill_run" as const,
    input: description,
    outputSummary: description,
    status: "captured" as const,
    confidence: 1,
    rationale: "Created via alix chat /intent",
    sourceArtifacts: [{ type: "context" as const, id: `session:${sessionId}` }],
    subject: `Chat intent: ${description.slice(0, 80)}`,
    outcome: "captured" as const,
    reasons: [`Intent created from chat session ${sessionId}`],
  };

  await intentStore.append(intent as any);
  return `Intent captured: ${(intent as any).id || "(id pending)"}`;
}

export async function handleProposeIntent(
  intentId: string,
  sessionId: string,
): Promise<string> {
  const { IntentStore } = await import("../adaptation/intent-store.js");
  const { ProposalStore } = await import("../adaptation/proposal-store.js");
  const { IntentProposalMapper } = await import("../adaptation/intent-proposal-mapper.js");

  const intentDir = join(homedir(), ".alix", "execution", "intents");
  const intentStore = new IntentStore(intentDir);

  const intent = await intentStore.get(intentId);
  if (!intent) return `Intent ${intentId} not found.`;

  const proposalsDir = join(process.cwd(), ".alix", "adaptation", "proposals");
  const proposalStore = new ProposalStore(proposalsDir);
  const mapper = new IntentProposalMapper(proposalStore);

  const result = await mapper.mapToProposal(intent, intentStore);
  if (!result.success) {
    return `Proposal failed: ${result.errors.join("; ")}`;
  }
  return `Proposal created: ${result.proposal!.id}. Review via the decision pipeline.`;
}
```

- [ ] **Step 3: Wire into REPL** (update `/run-skill`, `/intent`, `/propose` handlers in `chat-repl.ts`)

- [ ] **Step 4: Commit**

```bash
git add src/chat/chat-skill-bridge.ts tests/chat/chat-skill-bridge.vitest.ts
git commit -m "feat(p7.6c): chat skill bridge — /run-skill, /intent, /propose handlers"
```

---

### Task 6: Chat State Inspection (P7.6d)

**Files:**
- Create: `src/chat/chat-inspector.ts`
- Test: `tests/chat/chat-inspector.vitest.ts`

**Interfaces:**
- Produces: `inspectProposals(): Promise<string>`, `inspectSkills(): Promise<string>`, `inspectOutcomes(): Promise<string>`

No new business logic — each function delegates to existing stores, builders, and CLI-accessible commands. Unlike the initial implementation sketch, these inspectors call the same `ProposalStore.list()`, `OutcomeStore.list()`, and `loadSkillManifests()` that the CLI uses, rather than reimplementing formatting or query logic. Designed for reuse by the future `alix ask` command.

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from "vitest";

describe("ChatInspector", () => {
  it("inspectSkills returns a string", async () => {
    const { inspectSkills } = await import("../../src/chat/chat-inspector.js");
    const result = await inspectSkills();
    expect(typeof result).toBe("string");
  });
});
```

- [ ] **Step 2: Implement inspector**

```typescript
// src/chat/chat-inspector.ts

export async function inspectProposals(proposalsDir?: string): Promise<string> {
  const { ProposalStore } = await import("../adaptation/proposal-store.js");
  const { join } = await import("node:path");
  const dir = proposalsDir ?? join(process.cwd(), ".alix", "adaptation", "proposals");
  const store = new ProposalStore(dir);
  const all = await store.list();
  if (all.length === 0) return "No proposals found.";
  return all.map((p: any) => `  ${p.id}  [${p.status}]  ${p.subject}`).join("\n");
}

export async function inspectSkills(skillsHome?: string): Promise<string> {
  const { loadSkillManifests } = await import("../skills/loader.js");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const dir = skillsHome ?? join(homedir(), ".alix", "skills");
  const manifests = await loadSkillManifests(dir);
  if (manifests.length === 0) return "No skills installed.";
  return manifests.map((m: any) => `  ${m.name}  —  ${m.description ?? ""}`).join("\n");
}

export async function inspectOutcomes(): Promise<string> {
  const { OutcomeStore } = await import("../adaptation/outcome-store.js");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const dir = join(homedir(), ".alix", "outcomes");
  const store = new OutcomeStore(dir);
  const all = await store.list();
  if (all.length === 0) return "No outcomes recorded.";
  return all.slice(-10).map((o: any) => `  ${o.id}  [${o.outcome}]  ${o.subject}`).join("\n");
}
```

- [ ] **Step 3: Wire into REPL** (update `/proposals`, `/skills`, `/outcomes` handlers)

- [ ] **Step 4: Commit**

```bash
git add src/chat/chat-inspector.ts tests/chat/chat-inspector.vitest.ts
git commit -m "feat(p7.6d): chat state inspector — /proposals, /skills, /outcomes"
```

---

### Task 7: Chat Governance Sentinels (P7.6e)

**Files:**
- Create: `tests/chat/chat-sentinels.vitest.ts`

- [ ] **Step 1: Write sentinel tests**

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const chatFiles = [
  "src/chat/chat-types.ts",
  "src/chat/chat-session-store.ts",
  "src/chat/chat-intent-router.ts",
  "src/chat/chat-repl.ts",
  "src/chat/chat-skill-bridge.ts",
  "src/chat/chat-inspector.ts",
];

describe("Chat governance sentinels", () => {
  it("chat must not import applier modules", () => {
    for (const f of chatFiles) {
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/applier/i);
    }
  });

  it("chat must not call approve/apply/reject directly", () => {
    for (const f of chatFiles) {
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/\bapprove\b/);
      expect(content).not.toMatch(/\bapply\b/);
      expect(content).not.toMatch(/\breject\b/i);
    }
  });

  it("chat must not write OutcomeStore outside inspector", () => {
    for (const f of chatFiles) {
      if (f.includes("chat-inspector")) continue;
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/OutcomeStore/);
    }
  });

  it("chat must not bypass ExecutionIntent lifecycle", () => {
    for (const f of chatFiles) {
      if (f.includes("chat-skill-bridge")) continue;
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/ProposalStore/);
    }
  });
});
```

- [ ] **Step 2: Run sentinels**

Run: `npx vitest run tests/chat/chat-sentinels.vitest.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/chat/chat-sentinels.vitest.ts
git commit -m "feat(p7.6e): chat governance sentinels — applier/approve/apply boundaries"
```

---

## Self-Review

### Spec coverage
- P7.6a: Tasks 1-3 cover types, dual-file store, REPL
- P7.6b: Task 4 covers keyword-based routeMessage with confidence thresholds
- P7.6c: Task 5 covers skill bridge (/run-skill, /intent, /propose through existing lifecycle)
- P7.6d: Task 6 covers read-only state inspection (proposals, skills, outcomes)
- P7.6e: Task 7 covers governance sentinels (no applier, no approve/apply/reject)

### Changes from review feedback
- **Store split (required):** `sessions.jsonl` + `messages.jsonl` — metadata is O(n), messages are O(n), never O(n²)
- **Artifact references (required):** `sourceArtifacts` and `generatedArtifacts` on ChatMessage for audit trail
- **invoke_agent (recommended):** Reserved in ChatRoute type for P8/P9+ wiring
- **alix ask (recommended):** Noted in Future Compatibility section — reuse of inspectors/router by design

### Gaps found
No gaps. All acceptance criteria in the spec are covered across the 7 tasks.
