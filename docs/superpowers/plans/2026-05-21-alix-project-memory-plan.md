# Project Memory & Enhanced Session Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent project memory that loads into every chat session, and improve session resume with task context and recent decisions.

**Architecture:** Store project memories in `.alix/memory/project/`. Session metadata stores task summary and key decisions. Both are loaded at session start.

**Tech Stack:** Node.js, existing MemoryStore pattern, JSONL for decisions.

---

### Task 1: Add Project Memory to Chat System Prompt

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Read existing chat.ts to understand current structure**

Run: `head -60 src/cli/commands/chat.ts`

- [ ] **Step 2: Add project memory loading to buildChatSystemPrompt**

Modify the `buildChatSystemPrompt` function:

```typescript
function buildChatSystemPrompt(): string {
  const base = `You are ALiX, an AI coding assistant. Be concise and helpful.`;
  const projectMemory = loadProjectMemory();
  if (projectMemory) {
    return `${base}\n\n## Project Memory\n${projectMemory}`;
  }
  return base;
}

function loadProjectMemory(): string {
  const memoryPath = join(process.cwd(), ".alix", "memory", "project.md");
  try {
    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, "utf8");
      // Skip frontmatter
      const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      return match ? match[1].trim() : content.trim();
    }
  } catch { /* ignore */ }
  return "";
}
```

Add to imports:
```typescript
import { readFileSync, existsSync } from "node:fs";
```

- [ ] **Step 3: Add /remember command to chat REPL**

Add to the special commands section (after `/model` handler):

```typescript
if (input.startsWith("/remember ")) {
  const note = input.slice(10).trim();
  await saveProjectMemory(note);
  console.log("Saved to project memory.");
  input = await prompt();
  continue;
}
```

Add helper function:

```typescript
async function saveProjectMemory(note: string): Promise<void> {
  const memoryPath = join(process.cwd(), ".alix", "memory", "project.md");
  const dir = join(process.cwd(), ".alix", "memory");
  await mkdir(dir, { recursive: true });

  const existing = existsSync(memoryPath) ? await readFile(memoryPath, "utf8") : "";
  const lines = existing.split("\n").filter(l => !l.startsWith("- ") || !l.includes(note));
  const newEntry = `- ${note}`;
  const updated = [...lines, newEntry].join("\n");

  // Simple markdown format
  const frontmatter = `---
name: project-context
description: Project context and notes
type: project
---

# Project Context
${updated}
`;
  await writeFile(memoryPath, frontmatter);
}
```

- [ ] **Step 4: Update /help to include /remember**

Change:
```typescript
console.log("Commands: /exit, /quit, /clear, /context, /model");
```
To:
```typescript
console.log("Commands: /exit, /quit, /clear, /context, /model, /remember <note>");
```

- [ ] **Step 5: Build and test**

Run: `npm run build && npm run test:node 2>&1 | tail -5`
Expected: Build succeeds, tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(chat): add /remember command for project memory

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Add Session Task Summary

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Add task summary to session metadata**

When saving session metadata, also store a task summary:

```typescript
// After messages are loaded, check if we have a task summary
const taskSummaryPath = join(dir, "task.txt");
let taskSummary = "";
if (existsSync(taskSummaryPath)) {
  taskSummary = await readFile(taskSummaryPath, "utf8").catch(() => "");
}
```

Add command to set task summary:
```typescript
if (input.startsWith("/task ")) {
  const task = input.slice(5).trim();
  await writeFile(taskSummaryPath, task);
  console.log(`Task set: ${task}`);
  input = await prompt();
  continue;
}
```

- [ ] **Step 2: Show task on resume**

Modify the resume display section:
```typescript
console.log(`\nChat session: ${id}`);
if (taskSummary) {
  console.log(`Task: ${taskSummary}`);
}
if (messages.length > 0) {
  console.log(`(Resuming with ${messages.length} previous messages)\n`);
  for (const msg of messages.slice(-4)) {
    const role = msg.role === "user" ? "You" : "ALiX";
    console.log(`${role}: ${msg.content.slice(0, 100)}${msg.content.length > 100 ? "..." : ""}`);
  }
  console.log();
}
```

- [ ] **Step 3: Update /help**

```typescript
console.log("Commands: /exit, /quit, /clear, /context, /model, /remember <note>, /task <description>");
```

- [ ] **Step 4: Build and commit**

```bash
npm run build && git add src/cli/commands/chat.ts && git commit -m "feat(chat): add /task command and session task summary

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Extract Key Decisions from Conversation

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Add /decision command**

After the task summary section, add:

```typescript
if (input.startsWith("/decision ")) {
  const decision = input.slice(10).trim();
  const decisionsPath = join(dir, "decisions.jsonl");
  const entry = JSON.stringify({
    decision,
    timestamp: new Date().toISOString(),
    context: messages.slice(-2).map(m => m.content.slice(0, 200))
  });
  await appendFile(decisionsPath, entry + "\n");
  console.log("Decision recorded.");
  input = await prompt();
  continue;
}
```

- [ ] **Step 2: Show recent decisions on resume**

```typescript
const decisionsPath = join(dir, "decisions.jsonl");
let recentDecisions: string[] = [];
if (existsSync(decisionsPath)) {
  try {
    const content = await readFile(decisionsPath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    recentDecisions = lines.slice(-3).map(l => {
      try { return JSON.parse(l).decision; } catch { return l; }
    });
  } catch { /* ignore */ }
}

// In resume display:
if (recentDecisions.length > 0) {
  console.log("Recent decisions:");
  for (const d of recentDecisions) {
    console.log(`  - ${d.slice(0, 80)}${d.length > 80 ? "..." : ""}`);
  }
  console.log();
}
```

- [ ] **Step 3: Update /help**

```typescript
console.log("Commands: /exit, /quit, /clear, /context, /model, /remember <note>, /task <desc>, /decision <note>");
```

- [ ] **Step 4: Build and commit**

```bash
npm run build && git add src/cli/commands/chat.ts && git commit -m "feat(chat): add /decision command to track key decisions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] `/remember <note>` saves note to project memory
- [ ] Project memory loads into system prompt
- [ ] `/task <description>` sets session task
- [ ] `/decision <note>` records key decisions
- [ ] Session resume shows task summary, recent messages, and decisions
- [ ] `/help` lists all commands
- [ ] All tests pass