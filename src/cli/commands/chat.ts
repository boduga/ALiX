import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { createProvider } from "../../providers/registry.js";
import type { NormalizedMessage, NormalizedResponse, ToolCall } from "../../providers/types.js";
import { webSearchTool } from "../../tools/web-search.js";
import { webFetchTool } from "../../tools/web-fetch.js";

export interface ChatOptions {
  sessionId?: string;
  resume?: boolean;
  list?: boolean;
  delete?: string;
}

// Shared chat tools — lazily constructed once
const CHAT_TOOLS = [webSearchTool(), webFetchTool()].map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema as any,
}));

async function executeChatTool(name: string, args: Record<string, unknown>): Promise<string> {
  for (const t of [webSearchTool(), webFetchTool()]) {
    if (t.name === name) {
      const result = await t.execute(args as any);
      if (result.ok && result.data) {
        if (name === "web_search") {
          const data = result.data as any;
          return data.results.map((r: any) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join("\n\n");
        }
        if (name === "web_fetch") {
          const data = result.data as any;
          return data.content;
        }
      }
      return `Error: ${result.error ?? "unknown"}`;
    }
  }
  return `Error: Unknown tool "${name}"`;
}

export async function runChat(opts: ChatOptions = {}): Promise<void> {
  const sessionDir = join(process.cwd(), ".alix", "sessions");

  if (opts.list) { await listSessions(sessionDir); return; }
  if (opts.delete) { await deleteSession(sessionDir, opts.delete); return; }

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

  const messages: NormalizedMessage[] = resume ? await loadMessages(messagesPath) : [];

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
  if (taskSummary) console.log(`Task: ${taskSummary}`);
  if (messages.length > 0) {
    console.log(`(Resuming with ${messages.length} previous messages)\n`);
    for (const msg of messages.slice(-4)) {
      const role = msg.role === "user" ? "You" : "ALiX";
      console.log(`${role}: ${typeof msg.content === "string" ? msg.content.slice(0, 100) : "[content]"}`);
    }
    console.log();
  }
  if (recentDecisions.length > 0) {
    console.log("Recent decisions:");
    for (const d of recentDecisions) console.log(`  - ${d.slice(0, 80)}`);
    console.log();
  }
  console.log("Type /exit or /quit to end, /clear to clear, /help for commands\n");

  const config = await loadConfig(process.cwd());
  const apiKey = config.apiKeys?.[config.model.provider] ?? process.env[`${config.model.provider.toUpperCase()}_API_KEY`] ?? "";
  const provider = await createProvider(config.model, apiKey);
  const systemPrompt = buildChatSystemPrompt();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.question("> ");

  let input = await prompt();

  while (input.trim() !== "/exit" && input.trim() !== "/quit") {
    if (!input.trim()) { input = await prompt(); continue; }

    if (input === "/clear") { messages.length = 0; input = await prompt(); continue; }
    if (input === "/help") { console.log("Commands: /exit, /quit, /clear, /context, /model, /remember <note>, /task <desc>, /decision <note>"); input = await prompt(); continue; }
    if (input === "/context") { console.log(`Messages: ${messages.length}`); input = await prompt(); continue; }
    if (input === "/model") { console.log(`Model: ${config.model.provider}/${config.model.name}`); input = await prompt(); continue; }
    if (input.startsWith("/remember ")) {
      const note = input.slice(10).trim();
      await saveProjectMemory(note);
      console.log("Saved to project memory.");
      input = await prompt(); continue;
    }
    if (input.startsWith("/task ")) {
      const task = input.slice(5).trim();
      await writeFile(taskSummaryPath, task);
      console.log(`Task set: ${task}`);
      input = await prompt(); continue;
    }
    if (input.startsWith("/decision ")) {
      const decision = input.slice(10).trim();
      const entry = JSON.stringify({ decision, timestamp: new Date().toISOString(), context: messages.slice(-2).map(m => typeof m.content === "string" ? m.content.slice(0, 200) : "") });
      await appendFile(decisionsPath, entry + "\n");
      console.log("Decision recorded.");
      input = await prompt(); continue;
    }

    // Add user message
    messages.push({ role: "user", content: input.trim() });
    await appendMessage(messagesPath, { role: "user", content: input.trim() });

    // Model interaction loop (supports multi-turn tool calling)
    let turnCount = 0;
    const MAX_TOOL_TURNS = 5;

    while (turnCount < MAX_TOOL_TURNS) {
      turnCount++;

      if (turnCount > 1) {
        process.stdout.write("\n");
      }

      let response: NormalizedResponse;

      if (provider.stream) {
        process.stdout.write("\n");
        let text = "";
        const toolCalls: ToolCall[] = [];
        const stream = provider.stream({ systemPrompt, messages, tools: CHAT_TOOLS });
        for await (const chunk of stream) {
          if (chunk.type === "text_delta") {
            process.stdout.write(chunk.text);
            text += chunk.text;
          } else if (chunk.type === "tool_call") {
            toolCalls.push(chunk.toolCall);
          } else if (chunk.type === "done") break;
          else if (chunk.type === "error") {
            console.error(`\nError: ${chunk.error}`);
            break;
          }
        }
        process.stdout.write("\n");
        response = { text, toolCalls, usage: undefined };
      } else {
        response = await provider.complete({ systemPrompt, messages, tools: CHAT_TOOLS });
        if (response.text) {
          console.log(response.text);
        }
      }

      // If no tool calls, save the response and continue to next user input
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (response.text) {
          messages.push({ role: "assistant", content: response.text });
          await appendMessage(messagesPath, { role: "assistant", content: response.text });
        }
        break;
      }

      // Execute tool calls
      for (const tc of response.toolCalls) {
        if (!tc || !tc.name || tc.name === "undefined") continue; // skip malformed
        console.log(`  [Calling ${tc.name}...]`);
        const result = await executeChatTool(tc.name, tc.args);
        console.log(`  [Done]\n`);
        messages.push({ role: "assistant", content: JSON.stringify({ type: "tool", name: tc.name, arguments: tc.args }) });
        messages.push({ role: "user", content: JSON.stringify({ type: "tool_result", name: tc.name, result }) });
      }
    }

    input = await prompt();
  }

  rl.close();
  await writeFile(metadataPath, JSON.stringify({ sessionId: id, messageCount: messages.length, lastMessage: new Date().toISOString() }));
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
  for (const e of entries) { if (e.toLowerCase().startsWith(needle)) return e; }
  const firstSeg = id.split("-")[0].toLowerCase();
  for (const e of entries) { if (e.toLowerCase().startsWith(firstSeg)) return e; }
  return id;
}

async function appendMessage(path: string, msg: NormalizedMessage): Promise<void> {
  await appendFile(path, JSON.stringify(msg) + "\n");
}

async function listSessions(dir: string): Promise<void> {
  if (!existsSync(dir)) { console.log("No sessions found."); return; }
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
  if (!existsSync(sessionDir)) { console.error("Session not found."); return; }
  const { rm } = await import("node:fs/promises");
  await rm(sessionDir, { recursive: true });
  console.log(`Deleted session ${id.slice(0, 8)}`);
}

function buildChatSystemPrompt(): string {
  const base = `You are ALiX, an AI coding assistant. Be concise and helpful.

You have access to these tools:
- web_search(query, count): Search the web for current information
- web_fetch(url, maxLength): Fetch a URL and get its text content

For questions about current events or facts beyond your training data, use web_search to find up-to-date information. You can then use web_fetch to read full articles. Answer based on the search results.`;
  const projectMemory = loadProjectMemory();
  if (projectMemory) return `${base}\n\n## Project Memory\n${projectMemory}`;
  return base;
}

function loadProjectMemory(): string {
  const memoryPath = join(process.cwd(), ".alix", "memory", "project.md");
  try {
    if (existsSync(memoryPath)) {
      const content = readFileSync(memoryPath, "utf8");
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
  const newEntry = `- ${note}\n`;
  const existing = existsSync(memoryPath) ? await readFile(memoryPath, "utf8") : frontmatter;
  const updated = existing.endsWith("\n") ? existing + newEntry : existing + "\n" + newEntry;
  await writeFile(memoryPath, updated);
}
