# `alix chat` Design

**Goal:** Interactive REPL-style chat with conversation history and session resumption.

**Architecture:** Chat runs as a long-lived session, storing messages in `.alix/sessions/<session-id>/messages.jsonl`. Each message has role, content, and timestamp.

---

## Command Interface

```
alix chat                    Start new chat session
alix chat --resume <id>      Resume previous session
alix chat --list              Show recent sessions
alix chat --delete <id>       Delete a session
```

---

## Session Storage

```
.alix/
  sessions/
    <uuid>/
      metadata.json    # session info, created, last accessed
      messages.jsonl   # conversation history
```

**metadata.json:**
```json
{
  "sessionId": "uuid",
  "created": "2026-05-21T10:00:00Z",
  "lastMessage": "2026-05-21T10:30:00Z",
  "messageCount": 42,
  "model": { "provider": "anthropic", "name": "claude-sonnet-4-20250514" }
}
```

---

## Chat Loop

1. Print prompt: `> `
2. Read user input (multiline with `\` at end of line)
3. Save user message to session
4. Call LLM with conversation history
5. Stream response to stdout
6. Save assistant response to session
7. Repeat

**Special commands:**
- `/exit` or `/quit` - end session
- `/clear` - clear conversation history (keep session)
- `/context` - show current context size
- `/model` - show/switch model

---

## REPL Implementation

```typescript
async function runChat(sessionId?: string, resume?: boolean) {
  const id = sessionId ?? randomUUID();
  const sessionDir = join(".alix", "sessions", id);
  await mkdir(sessionDir, { recursive: true });

  const messagesPath = join(sessionDir, "messages.jsonl");
  const metadataPath = join(sessionDir, "metadata.json");

  // Load existing messages if resuming
  const messages: NormalizedMessage[] = resume
    ? await loadMessages(messagesPath)
    : [];

  console.log(`Chat session: ${id}`);
  console.log("Type /exit to end, /clear to clear history\n");

  while (true) {
    const input = await readLine("> ");
    if (!input.trim()) continue;

    // Handle special commands
    if (input === "/exit" || input === "/quit") break;
    if (input === "/clear") { messages.length = 0; continue; }

    // Add user message
    messages.push({ role: "user", content: input });
    await appendMessage(messagesPath, { role: "user", content: input });

    // Call model
    const response = await provider.complete({
      systemPrompt,
      messages,
    });

    // Stream and save response
    console.log(response.text);
    messages.push({ role: "assistant", content: response.text });
    await appendMessage(messagesPath, { role: "assistant", content: response.text });

    // Update metadata
    await writeFile(metadataPath, JSON.stringify({ sessionId: id, messageCount: messages.length }));
  }
}
```

---

## Session List

```bash
$ alix chat --list
Recent sessions:
  a1b2c3d4  42 msgs  2 hours ago  "help me refactor..."
  e5f6g7h8  18 msgs  yesterday     "add authentication"
  i9j0k1l2   7 msgs  3 days ago    "fix the bug"
```

---

## Integration with Existing Code

- Reuses `provider.complete()` from existing provider registry
- Uses `NormalizedMessage` type from providers
- Session storage uses same EventLog pattern (JSONL)
- Can use same system prompt as `alix run`

---

## Exit Behavior

- On `/exit`: print summary, save metadata, exit 0
- On EOF (Ctrl+D): same as `/exit`
- On error: save partial session, exit 1