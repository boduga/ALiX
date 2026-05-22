import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { createProvider } from "../../providers/registry.js";
import type { NormalizedMessage, StreamChunk } from "../../providers/types.js";

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
  const id = sessionId ? await findSession(sessionDir, sessionId) : randomUUID();
  const dir = join(sessionDir, id);
  const messagesPath = join(dir, "messages.jsonl");
  const metadataPath = join(dir, "metadata.json");
  const taskSummaryPath = join(dir, "task.txt");
  const decisionsPath = join(dir, "decisions.jsonl");

  await mkdir(dir, { recursive: true });

  // Load existing messages if resuming
  const messages: NormalizedMessage[] = resume
    ? await loadMessages(messagesPath)
    : [];

  let taskSummary = "";
  if (resume && existsSync(taskSummaryPath)) {
    taskSummary = await readFile(taskSummaryPath, "utf8").catch(() => "");
  }

  let recentDecisions: string[] = [];
  if (resume && existsSync(decisionsPath)) {
    try {
      const content = await readFile(decisionsPath, "utf8");
      const lines = content.split("\n").filter(Boolean);
      recentDecisions = lines.slice(-3).map(l => {
        try { return JSON.parse(l).decision; } catch { return l; }
      });
    } catch { /* ignore */ }
  }

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
  if (recentDecisions.length > 0) {
    console.log("Recent decisions:");
    for (const d of recentDecisions) {
      console.log(`  - ${d.slice(0, 80)}${d.length > 80 ? "..." : ""}`);
    }
    console.log();
  }
  console.log("Type /exit or /quit to end, /clear to clear, /help for commands\n");

  const config = await loadConfig(process.cwd());
  const provider = createProvider(config.model);
  const systemPrompt = buildChatSystemPrompt();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
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
      console.log("Commands: /exit, /quit, /clear, /context, /model, /remember <note>, /task <desc>, /decision <note>");
      input = await prompt();
      continue;
    }
    if (input === "/context") {
      console.log(`Messages: ${messages.length}`);
      input = await prompt();
      continue;
    }
    if (input === "/model") {
      console.log(`Model: ${config.model.provider}/${config.model.name}`);
      input = await prompt();
      continue;
    }
    if (input.startsWith("/remember ")) {
      const note = input.slice(10).trim();
      await saveProjectMemory(note);
      console.log("Saved to project memory.");
      input = await prompt();
      continue;
    }
    if (input.startsWith("/task ")) {
      const task = input.slice(5).trim();
      await writeFile(taskSummaryPath, task);
      console.log(`Task set: ${task}`);
      input = await prompt();
      continue;
    }
    if (input.startsWith("/decision ")) {
      const decision = input.slice(10).trim();
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

    // Add user message
    messages.push({ role: "user", content: input });
    await appendMessage(messagesPath, { role: "user", content: input });

    // Stream response
    process.stdout.write("\n");
    let fullResponse = "";

    if (provider.stream) {
      const stream = provider.stream({ systemPrompt, messages });
      for await (const chunk of stream) {
        if (chunk.type === "text_delta") {
          process.stdout.write(chunk.text);
          fullResponse += chunk.text;
        } else if (chunk.type === "done") {
          break;
        } else if (chunk.type === "error") {
          console.error(`\nError: ${chunk.error}`);
          break;
        }
      }
      process.stdout.write("\n");
    } else {
      const resp = await provider.complete({ systemPrompt, messages });
      if (resp.text) {
        console.log(resp.text);
        fullResponse = resp.text;
      }
    }

    // Save assistant response
    if (fullResponse) {
      messages.push({ role: "assistant", content: fullResponse });
      await appendMessage(messagesPath, { role: "assistant", content: fullResponse });
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

async function findSession(dir: string, id: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir);
  const needle = id.toLowerCase();
  // First try exact prefix match
  for (const e of entries) {
    if (e.toLowerCase().startsWith(needle)) return e;
  }
  // Then try first segment match (UUID first part)
  const firstSeg = id.split("-")[0].toLowerCase();
  for (const e of entries) {
    if (e.toLowerCase().startsWith(firstSeg)) return e;
  }
  return id;
}

async function appendMessage(path: string, msg: NormalizedMessage): Promise<void> {
  await appendFile(path, JSON.stringify(msg) + "\n");
}

async function listSessions(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    console.log("No sessions found.");
    return;
  }
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir);
  for (const id of entries) {
    const metaPath = join(dir, id, "metadata.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(await readFile(metaPath, "utf8"));
        console.log(`${id.slice(0, 8)}  ${meta.messageCount || 0} msgs  ${meta.lastMessage || ""}`);
      } catch { console.log(`${id.slice(0, 8)}`); }
    }
  }
}

async function deleteSession(dir: string, id: string): Promise<void> {
  const sessionDir = join(dir, id);
  if (!existsSync(sessionDir)) {
    console.error("Session not found.");
    return;
  }
  const { rm } = await import("node:fs/promises");
  await rm(sessionDir, { recursive: true });
  console.log(`Deleted session ${id.slice(0, 8)}`);
}

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

async function saveProjectMemory(note: string): Promise<void> {
  const memoryDir = join(process.cwd(), ".alix", "memory");
  const memoryPath = join(memoryDir, "project.md");
  await mkdir(memoryDir, { recursive: true });

  const frontmatter = `---
name: project-context
description: Project context and notes
type: project
---

# Project Context

`;

  // Append as bullet point
  const newEntry = `- ${note}\n`;
  const existing = existsSync(memoryPath) ? await readFile(memoryPath, "utf8") : frontmatter;
  const updated = existing.endsWith("\n") ? existing + newEntry : existing + "\n" + newEntry;
  await writeFile(memoryPath, updated);
}