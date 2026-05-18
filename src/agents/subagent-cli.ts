/**
 * Subagent entry point. Parses CLI args, builds prompt, calls model with tools, exits.
 * Invoked by SubagentManager.spawn() as a child process via `alix run --subagent`.
 */
import { parseArgs } from "util";
import { resolve } from "path";
import { mkdir } from "fs/promises";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { AlixConfig, SubagentFinding, SubagentRole } from "../config/schema.js";
import { EventLog } from "../events/event-log.js";
import { createProvider } from "../providers/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ToolDef, ToolCall, NormalizedMessage } from "../providers/types.js";
import { buildToolsForProvider } from "../run.js";
import { McpManager } from "../mcp/manager.js";
import { ToolSelector } from "../mcp/tool-selector.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
import { getToolPolicy, filterTools } from "./tool-policy.js";
import { TOOL_NAME_MAP } from "./tool-name-map.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";

const ROLE_INSTRUCTIONS: Record<SubagentRole, string> = {
  explorer:          "You are an explorer subagent. Understand code regions and report your findings concisely. Use file references, summarize structure, identify key symbols.",
  reviewer:           "You are a code reviewer. Analyze code quality, style, and potential issues. Be constructive and specific. Flag risks and suggest improvements.",
  test_investigator:  "You are a test investigator. Map tests to code, diagnose failures, and suggest fixes. Be precise. Use test names and file paths.",
  docs_researcher:    "You are a docs researcher. Find and summarize relevant documentation. Cite file paths and sources. Be thorough.",
  worker:             "You are a worker subagent. Apply changes to owned files only. Wait for confirmation before writing. Always explain what you changed.",
};

export function appendSubagentResponseText(existing: string, next: string | undefined): string {
  const trimmed = next?.trim();
  if (!trimmed) return existing;
  return existing ? `${existing}\n\n${trimmed}` : trimmed;
}

function isToolCallText(text: string): boolean {
  return /["']name["']\s*:\s*["'](?:alix_|mcp_|file\.|dir\.|shell\.|patch\.|done|delegate)/.test(text) ||
    /["']parameters["']\s*:/.test(text) ||
    /["']arguments["']\s*:/.test(text);
}

export function buildSubagentFindings(text: string, toolOutputs: string[]): SubagentFinding[] {
  const uniqueToolOutputs = Array.from(new Set(toolOutputs.map((output) => output.trim()).filter(Boolean)));
  const trimmedText = text.trim();
  const content = trimmedText && !(uniqueToolOutputs.length > 0 && isToolCallText(trimmedText))
    ? trimmedText
    : uniqueToolOutputs.join("\n\n");
  return content
    ? [{ type: "summary", content, confidence: "high" }]
    : [];
}

export class SubagentCLI {
  static async main(argv: string[]): Promise<void> {
    const args = parseArgs({
      args: argv,
      options: {
        subagent: { type: "string" },
        "task-id": { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
        provider: { type: "string" },
        mode: { type: "string" },
        "session-id": { type: "string" },
        "owned-paths": { type: "string" },
      },
      allowPositionals: false,
    });

    const role: SubagentRole = (args.values.subagent ?? "explorer") as SubagentRole;
    const taskId = args.values["task-id"];
    const prompt = args.values.prompt ?? "";
    const mode = (args.values.mode ?? "read_only") as "read_only" | "write";
    const sessionId = args.values["session-id"];
    const ownedPaths = args.values["owned-paths"]?.split(",").filter(Boolean);
    const providerOverride = args.values.provider;
    const modelOverride = args.values.model;

    if (!taskId || !sessionId || !prompt) {
      console.error("Missing required args: --task-id, --session-id, --prompt");
      process.exit(1);
    }

    // Load config from project root (homedir XDG, global, project configs)
    const require = createRequire(import.meta.url);
    const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const { loadConfig } = require("../config/loader.js");
    const config = await loadConfig(projectRoot) as AlixConfig;

    // Apply overrides (provider from role config takes priority)
    if (modelOverride) config.model.name = modelOverride;
    if (providerOverride) config.model.provider = providerOverride as any;

    // Use role config to set provider if not overridden
    if (!providerOverride) {
      const roleConfig = config.subagents?.roles.find(r => r.role === role);
      const roleStyle = roleConfig?.style ?? "fast";
      const tier = (config.subagents as any)?.[roleStyle];
      if (tier) {
        config.model.provider = tier.provider as any;
        if (!modelOverride) config.model.name = tier.name;
      }
    }

    const sessionDir = resolve(process.cwd(), ".alix", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    const eventLog = new EventLog(sessionDir);
    await eventLog.init();

    // Log subagent start
    await eventLog.append({
      actor: "subagent",
      type: "subagent.started",
      sessionId,
      payload: { subagentId: taskId, role, mode, ownedPaths },
    });

    // Initialize MCP and tools
    let mcpManager: McpManager | null = null;
    let mcpDiscovery: ToolDiscovery | null = null;
    let selectedTools: ToolDef[] = [];

    try {
      mcpManager = new McpManager(config);
      await mcpManager.initialize();

      const mcpDeferral = mcpManager.getDeferral();
      const mcpToolIndex = mcpDeferral.buildIndex();
      const toolSelector = new ToolSelector(mcpToolIndex, { maxTools: 3, tokenBudget: 1500 });
      selectedTools = toolSelector.select(prompt) as ToolDef[];
      mcpDiscovery = new ToolDiscovery(mcpToolIndex);

      // Register MCP tool name mappings
      for (const entry of selectedTools) {
        TOOL_NAME_MAP[entry.name] = entry.name;
      }
    } catch (err) {
      // MCP init failed — continue without tools (non-fatal)
      console.error(`[SubagentCLI] MCP init failed: ${(err as Error).message}. Continuing without MCP tools.`);
    }

    const provider = createProvider({ provider: config.model.provider, model: config.model.name });
    const providerTools = buildToolsForProvider(provider);
    const roleConfig = config.subagents?.roles.find(r => r.role === role);
    const roleStyle = roleConfig?.style ?? "fast";
    const toolPolicy = getToolPolicy(role);
    const allowedTools = filterTools([...providerTools, ...selectedTools], toolPolicy);

    const executor = new ToolExecutor(
      config,
      eventLog,
      projectRoot,
      mcpManager ?? undefined,
      buildEditFormatPolicy({ provider: config.model.provider, preferred: provider.editFormatPreference })
    );

    // Build system prompt with role instructions
    const roleInstructions = ROLE_INSTRUCTIONS[role] ?? "You are a subagent.";
    const systemPrompt = `${roleInstructions}

Task: ${prompt}

## Critical Rules
- alix_file_read reads the CONTENT of a SINGLE FILE. It does NOT list directories.
- To list files in a directory, you MUST use alix_shell_run with: ls <path>
- NEVER call alix_file_read with a directory path (it will fail with "EISDIR")
- Do NOT invent file names or paths. Report only what the tools return.
- Call ONE tool at a time. Wait for the result before calling the next.
- When the tools return output, copy it EXACTLY into a code block. Do NOT interpret it.
- Stop after copying the tool output.
- Report the EXACT output from each tool call. Do NOT summarize or rephrase.

Available tools:
${allowedTools.map(t => `- ${t.name}: ${t.description ?? "(no description)"}`).join("\n")}`;

    try {
      const messages: NormalizedMessage[] = [{ role: "user", content: prompt }];
      let iterations = 0;
      let text = "";
      const toolOutputs: string[] = [];

      while (iterations < toolPolicy.maxIterations) {
        iterations++;

        const resp = await provider.complete({
          systemPrompt,
          messages,
          tools: allowedTools as ToolDef[],
        });

        text = appendSubagentResponseText(text, resp.text);
        const toolCalls: ToolCall[] = resp.toolCalls ?? [];

        if (toolCalls.length === 0) {
          // No tools called — model is done
          break;
        }

        // Execute each tool call
        for (const toolCall of toolCalls) {
          const execName = TOOL_NAME_MAP[toolCall.name] ?? toolCall.name;

          // Handle mcp_search_tools specially
          if (execName === "mcp_search_tools") {
            const query = (toolCall.args.query as string) ?? "";
            if (mcpDiscovery) {
              const result = await mcpDiscovery.search(query);
              const output = result.kind === "success" ? (result.output ?? "") : result.message;
              messages.push({ role: "user", content: `[Tool Result]\n${output}` });
            } else {
              messages.push({ role: "user", content: `[Tool Result]\nMCP tools not available.` });
            }
            continue;
          }

          const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

          const resultContent =
            execResult.kind === "success"
              ? (execResult.output ?? (execResult as { content?: string }).content ?? "")
              : `Error: ${(execResult as { kind: "error"; message: string }).message}`;
          if (execResult.kind === "success" && resultContent.trim()) {
            toolOutputs.push(resultContent);
          }

          messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });

          // If done tool was called, stop
          if (execName === "done") {
            await mcpManager?.closeAll().catch(() => {});
            console.log(JSON.stringify({
              id: taskId,
              role,
              status: "success" as const,
              findings: buildSubagentFindings(text || "Task completed.", toolOutputs),
              events: [],
            }));
            process.exit(0);
          }
        }
      }

      await mcpManager?.closeAll().catch(() => {});

      // Log completion
      await eventLog.append({
        actor: "subagent",
        type: "subagent.completed",
        sessionId,
        payload: { subagentId: taskId, role, iterations, textLength: text.length },
      });

      console.log(JSON.stringify({
        id: taskId,
        role,
        status: "success" as const,
        findings: buildSubagentFindings(text, toolOutputs),
        events: [],
      }));
      process.exit(0);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      await eventLog.append({
        actor: "subagent",
        type: "subagent.failed",
        sessionId,
        payload: { subagentId: taskId, role, error: errorMsg },
      });

      await mcpManager?.closeAll().catch(() => {});

      console.error(JSON.stringify({
        id: taskId,
        role,
        status: "failed" as const,
        findings: [],
        events: [],
        error: errorMsg,
      }));
      process.exit(1);
    }
  }
}

// Allow direct invocation: node dist/src/agents/subagent-cli.js --subagent explorer --task-id x --prompt y --session-id z
if (import.meta.url === `file://${process.argv[1]}`) {
  SubagentCLI.main(process.argv.slice(2));
}
