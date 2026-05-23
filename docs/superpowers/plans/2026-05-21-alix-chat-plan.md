# `alix chat` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement interactive REPL-style chat with conversation history.

**Architecture:** Long-lived chat session, messages stored in JSONL, uses existing provider.

---

### Task 1: Create Chat Command Handler

**Files:**
- Create: `src/cli/commands/chat.ts`

- [ ] **Step 1: Write the shell**

```typescript
// src/cli/commands/chat.ts
import { readline } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { existsSync, mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { createProvider } from "../../providers/registry.js";
import type { NormalizedMessage } from "../../providers/types.js";

export interface ChatOptions {
  sessionId?: string;
  resume?: boolean;
  list?: boolean;
  delete?: string;
}

export async function runChat(opts: ChatOptions = {}): Promise<void> {
  const sessionDir = join(process.cwd(), ".alix", "sessions");

  // Handle list
  if (opts.list) {
    await listSessions(sessionDir);
    return;
  }

  // Handle delete
  if (opts.delete) {
    await deleteSession(sessionDir, opts.delete);
    return;
  }

  // Start/resume chat
  await runChatLoop(sessionDir, opts.sessionId, opts.resume);
}

async function runChatLoop(sessionDir: string, sessionId?: string, resume = false) {
  const id = sessionId ?? randomUUID();
  const dir = join(sessionDir, id);
  const messagesPath = join(dir, "messages.jsonl");
  const metadataPath = join(dir, "metadata.json");

  await mkdir(dir, { recursive: true });

  // Load existing messages if resuming
  const messages: NormalizedMessage[] = resume
    ? await loadMessages(messagesPath)
    : [];

  console.log(`\nChat session: ${id}`);
  console.log("Type /exit to end, /clear to clear, /help for commands\n");

  const config = await loadConfig(process.cwd());
  const provider = createProvider(config.model);
  const systemPrompt = buildChatSystemPrompt();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question("> ");

  let input = await prompt();

  while (input.trim() !== "/exit" && input.trim() !== "/quit") {
    if (!input.trim()) { input = await prompt(); continue; }

    // Special commands
    if (input === "/clear") {
      messages.length = 0;
      input = await prompt();
      continue;
    }
    if (input === "/help") {
      console.log("Commands: /exit, /quit, /clear, /context, /model");
      input = await prompt();
      continue;
    }

    // Add user message
    messages.push({ role: "user", content: input });
    await appendMessage(messagesPath, { role: "user", content: input });

    // Call model
    const resp = await provider.complete({ systemPrompt, messages });

    // Stream response
    if (resp.text) {
      console.log(resp.text);
      messages.push({ role: "assistant", content: resp.text });
      await appendMessage(messagesPath, { role: "assistant", content: resp.text });
    }

    input = await prompt();
  }

  rl.close();

  // Save metadata
  await writeFile(metadataPath, JSON.stringify({
    sessionId: id,
    messageCount: messages.length,
    lastMessage: new Date().toISOString(),
  }));

  console.log(`\nSession saved. (${messages.length} messages)`);
}

async function loadMessages(path: string): Promise<NormalizedMessage[]> {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch { return []; }
}

async function appendMessage(path: string, msg: NormalizedMessage): Promise<void> {
  await appendFile(path, JSON.stringify(msg) + "\n");
}

async function listSessions(dir: string): Promise<void> {
  // Implementation for listing sessions
}

async function deleteSession(dir: string, id: string): Promise<void> {
  // Implementation for deleting session
}

function buildChatSystemPrompt(): string {
  return `You are ALiX, an AI coding assistant. Be concise and helpful.`;
}
```

- [ ] **Step 2: Wire into cli.ts**

Add to `src/cli.ts`:

```typescript
if (command === "chat") {
  const { runChat } = await import("./cli/commands/chat.js");
  const opts = parseChatArgs(args);
  await runChat(opts);
  process.exit(0);
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -10
git add src/cli/commands/chat.ts src/cli.ts
git commit -m "feat(chat): add interactive chat REPL

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] Chat starts new session with UUID
- [ ] Messages saved to `.alix/sessions/<id>/messages.jsonl`
- [ ] Special commands (/exit, /clear) work
- [ ] Session resumption loads previous messages
- [ ] All tests pass