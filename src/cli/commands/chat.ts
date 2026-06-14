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
import { WorkspacePathResolver } from "../../runtime/workspace-path.js";
import { readFile as readFileTool, searchDir as searchDirTool } from "../../tools/file-tools.js";

export interface ChatOptions {
  sessionId?: string;
  resume?: boolean;
  list?: boolean;
  delete?: string;
  workspace?: boolean;
  agent?: boolean;
}

export type ParseChatArgsResult =
  | { ok: true; options: ChatOptions }
  | { ok: false; error: string };

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

export function parseChatArgs(args: string[]): ParseChatArgsResult {
  const opts: ChatOptions = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--resume" || arg === "-r") {
      if (opts.list || opts.delete) return { ok: false, error: "--resume cannot be combined with --list or --delete" };
      opts.resume = true;
      i++;
    } else if (arg === "--list" || arg === "-l") {
      if (opts.resume || opts.delete || opts.workspace || opts.agent) return { ok: false, error: "--list cannot be combined with other flags" };
      opts.list = true;
      i++;
    } else if (arg === "--delete" || arg === "-d") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) return { ok: false, error: "--delete requires a session id" };
      if (opts.list || opts.resume) return { ok: false, error: "--delete cannot be combined with --list or --resume" };
      opts.delete = args[i + 1];
      i += 2;
    } else if (arg === "--agent" || arg === "-a") {
      if (opts.list) return { ok: false, error: "--agent cannot be combined with --list" };
      if (opts.workspace) return { ok: false, error: "--agent cannot be combined with --workspace" };
      opts.agent = true;
      i++;
    } else if (arg === "--workspace" || arg === "-w") {
      if (opts.list) return { ok: false, error: "--workspace cannot be combined with --list" };
      if (opts.agent) return { ok: false, error: "--workspace cannot be combined with --agent" };
      opts.workspace = true;
      i++;
    } else if (arg === "--session" || arg === "-s") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) return { ok: false, error: "--session requires a session id" };
      opts.sessionId = args[i + 1];
      i += 2;
    } else if (!arg.startsWith("-")) {
      if (opts.sessionId) return { ok: false, error: `Unexpected argument: ${arg}. Session already set to ${opts.sessionId}` };
      opts.sessionId = arg;
      i++;
    } else {
      return { ok: false, error: `Unknown option: ${arg}. Supported: --workspace, --agent, --resume, --session, --list, --delete` };
    }
  }

  return { ok: true, options: opts };
}

export type ChatMode = "conversation" | "workspace" | "agent";

export type ResolvedChatMode = {
  mode: ChatMode;
  tools: Array<{ name: string; description: string; input_schema: any }>;
  mutations: "disabled" | "policy-gated";
  workspaceAccess: boolean;
};

export function resolveChatMode(opts: ChatOptions): ResolvedChatMode {
  if (opts.agent) {
    return { mode: "agent", tools: [], mutations: "policy-gated", workspaceAccess: true };
  }
  if (opts.workspace) {
    return {
      mode: "workspace",
      tools: [
        ...CHAT_TOOLS,
        { name: "file.read", description: "Read a file's contents", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        { name: "file.exists", description: "Check if a file exists", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        { name: "dir.search", description: "Search for files matching a pattern", input_schema: { type: "object", properties: { pattern: { type: "string" }, extensions: { type: "array", items: { type: "string" } } }, required: ["pattern"] } },
      ],
      mutations: "disabled",
      workspaceAccess: true,
    };
  }
  return { mode: "conversation", tools: CHAT_TOOLS, mutations: "disabled", workspaceAccess: false };
}

/** Check a model-supplied path against the workspace. Returns error string or null. */
function checkModelPath(path: string, cwd: string): string | null {
  const resolver = new WorkspacePathResolver(cwd);
  const result = resolver.check(path);
  if (!result.insideWorkspace) return "Path is outside the workspace";
  if (result.protected) return "Path is protected";
  if (result.sensitive) return "Path is sensitive";
  if (!resolver.isTraversalSafe(path)) return "Path traversal detected";
  return null;
}


async function executeWorkspaceTool(name: string, args: Record<string, unknown>): Promise<string> {
  const cwd = process.cwd();
  const path = String(args.path || "");
  if (path) {
    const blocked = checkModelPath(path, cwd);
    if (blocked) return `Error: ${blocked}`;
  }
  // dir.search pattern is a glob — only block obvious traversal attempts
  const pattern = String(args.pattern || "");
  if (pattern && (pattern.startsWith("..") || pattern.startsWith("/"))) {
    return "Error: Search pattern denied (traversal)";
  }
  switch (name) {
    case "file.read": {
      const result = await readFileTool({ root: process.cwd(), path });
      if (result.kind === "error") return `Error: ${result.message}`;
      return result.content || "";
    }
    case "file.exists": {
      const { existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      return existsSync(resolve(process.cwd(), path)) ? "exists" : "not found";
    }
    case "dir.search": {
      const dirResult = await searchDirTool({ root: process.cwd(), pattern: String(args.pattern || ""), extensions: (args.extensions as string[]) || [] });
      if (dirResult.kind === "error") return `Error: ${dirResult.message}`;
      return JSON.stringify(dirResult.matches || [], null, 2);
    }
    default:
      return `Error: Unknown tool "${name}"`;
  }
}

async function runAgentMode(): Promise<void> {
  const { runTask } = await import("../../run.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const config = await loadConfig(process.cwd());
  console.log(`\nChat session (agent task console)`);
  console.log(`Provider: ${config.model.provider}/${config.model.name}`);
  console.log("Each prompt starts a new governed task.");
  console.log("Subject to policy, approval, and ownership gates.");
  console.log("Type /exit or /quit to end\n");

  let input = await rl.question("> ");
  while (input.trim() !== "/exit" && input.trim() !== "/quit") {
    if (!input.trim()) { input = await rl.question("> "); continue; }
    try {
      const result = await runTask(process.cwd(), input.trim(), {
        planMode: false,
        sessionMode: config.permissions?.sessionMode ?? "ask",
      });
      if (result.summary) console.log(`\n${result.summary}`);
      console.log(`Session: ${result.sessionId}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
    }
    input = await rl.question("> ");
  }
  rl.close();
}

export async function runChat(opts: ChatOptions = {}): Promise<void> {
  const sessionDir = join(process.cwd(), ".alix", "sessions");

  if (opts.list) { await listSessions(sessionDir); return; }
  if (opts.delete) { await deleteSession(sessionDir, opts.delete); return; }
  if (opts.agent) { await runAgentMode(); return; }

  await runChatLoop(sessionDir, opts.sessionId, opts.resume, opts.workspace);
}

async function runChatLoop(sessionDir: string, sessionId?: string, resume = false, workspace = false) {
  const resolved = resolveChatMode({ workspace, agent: false });
  const modeLabel = workspace ? "workspace (read-only)" : "conversational";
  console.log(`Mode: ${modeLabel}`);
  if (!workspace) {
    console.log("For workspace access, use: alix chat --workspace");
  }
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
  const systemPrompt = buildChatSystemPrompt(workspace);

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
        const stream = provider.stream({ systemPrompt, messages, tools: resolved.tools });
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
        response = await provider.complete({ systemPrompt, messages, tools: resolved.tools });
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
        const result = resolved.mode === "workspace"
          ? await executeWorkspaceTool(tc.name, tc.args)
          : await executeChatTool(tc.name, tc.args);
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

const WORKSPACE_SYSTEM_PROMPT = `You are ALiX, an AI coding assistant with read-only access to the current project workspace.

You have access to these tools:
- web_search(query, count): Search the web for current information
- web_fetch(url, maxLength): Fetch a URL and get its text content
- file.read(path): Read a file's contents
- file.exists(path): Check if a file exists
- dir.search(pattern, extensions): Search for files matching a pattern

You can read files, search directories, and search the web. You CANNOT modify any files.
When the user asks you to make changes, explain that you are in read-only mode.`;

const CHAT_SYSTEM_PROMPT = `You are ALiX, an AI coding assistant. Be concise and helpful.

You have access to these tools:
- web_search(query, count): Search the web for current information
- web_fetch(url, maxLength): Fetch a URL and get its text content

For questions about current events or facts beyond your training data, use web_search to find up-to-date information. You can then use web_fetch to read full articles. Answer based on the search results.`;

function buildChatSystemPrompt(workspace = false): string {
  const base = workspace ? WORKSPACE_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
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
