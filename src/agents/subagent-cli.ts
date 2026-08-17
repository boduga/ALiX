/**
 * Subagent entry point. Parses CLI args, builds prompt, calls model with tools, exits.
 * Invoked by SubagentManager.spawn() as a child process via `alix run --subagent`.
 */
import { parseArgs } from "util";
import { resolve } from "path";
import { mkdir } from "fs/promises";
import type { AlixConfig, SubagentFinding, SubagentResult, SubagentRole, SubagentStyle } from "../config/schema.js";
import { resolveModelConfig } from "../config/model-resolver.js";

/**
 * §10.3: resolve the effective model for a subagent invocation with
 * precedence — explicit provider/model override > models.<tier> >
 * models.default. Never mutates `config.model`/`config.subagents` (they are
 * loader-derived compatibility projections); the loader re-derives them from
 * the canonical `models` object on every load.
 */
export function resolveEffectiveModel(
  config: AlixConfig,
  roleStyle: SubagentStyle | undefined,
  overrides: { provider?: string; name?: string },
): { provider: string; name: string } {
  const base = resolveModelConfig(config, roleStyle);
  return {
    provider: overrides.provider ?? base.provider,
    name: overrides.name ?? base.name,
  };
}
import { EventLog } from "../events/event-log.js";
import { createProvider } from "../providers/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ToolDef, ToolCall, NormalizedMessage } from "../providers/types.js";
import { buildToolsForProvider } from "../run.js";
import { McpManager } from "../mcp/manager.js";
import { ToolSelector } from "../mcp/tool-selector.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
import { ReliabilityMatrix } from "../config/reliability-matrix.js";
import { getToolPolicy, filterTools } from "./tool-policy.js";
import { TOOL_NAME_MAP } from "./tool-name-map.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import { ContextCompiler } from "../repomap/context-compiler.js";
import { ROLE_INSTRUCTIONS } from "./agent-registry.js";

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

/**
 * Rewrite single-block, path-less search_replace patch to canonical
 * `<<<<<<< SEARCH path=<owned>` form, inferring target worker's sole
 * owned path. No-op for already-scoped patches, multi-owned-path workers,
 * read-only mode, non-search_replace formats, anything without
 * `old\n---\nnew` block shape.
 */
export function inferSingleOwnedPatchPath(
  args: Record<string, unknown>,
  opts: { mode: "read_only" | "write"; ownedPaths?: string[] },
): void {
  if (opts.mode !== "write") return;
  if (!opts.ownedPaths || opts.ownedPaths.length !== 1) return;
  if (args.format !== "search_replace") return;
  const patchText = typeof args.patchText === "string" ? args.patchText : "";
  if (!patchText) return;
  // Already scoped — leave alone.
  if (/<<<<<<< SEARCH path=/.test(patchText) || /^[+-]{3} (?:[ab]\/)?/m.test(patchText)) return;
  // Dialect: exactly two parts around a line that is `---`, optionally
  // `---replace`, optionally `---replace---` (deepseek plain-dialect variant).
  const parts = patchText.split(/^---(?:replace)?-*\s*$/m).map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) return; // ambiguous — fail closed
  args.patchText = `<<<<<<< SEARCH path=${opts.ownedPaths[0]}\n${parts[0]}\n=======\n${parts[1]}\n>>>>>>> REPLACE`;
}

export type SubagentOutputFormat = "json" | "text";

export function formatSubagentResult(result: SubagentResult, format: SubagentOutputFormat): string {
  if (format === "json") return JSON.stringify(result);
  if (result.status !== "success") return result.error ?? "Subagent failed.";
  const content = result.findings.map((finding) => finding.content.trim()).filter(Boolean).join("\n\n");
  return content || "(no findings)";
}

/** Executor-side names of mutation tools the worker may call. (file.write is a policy key, not a tool.) */
const WRITE_EXEC_NAMES = new Set(["file.create", "file.delete", "patch.apply"]);

export function computeSubagentStatus(fatalWriteFailures: string[]): "success" | "failed" {
  return fatalWriteFailures.length > 0 ? "failed" : "success";
}

export function subagentToolError(result: { kind: string; message?: string; reason?: string }): string {
  if (result.kind === "denied") return result.reason ?? "Tool call denied";
  return result.message ?? "Tool call failed";
}

function buildResult(
  taskId: string, role: SubagentRole, mode: "read_only" | "write",
  text: string, toolOutputs: string[], fatalWriteFailures: string[],
): SubagentResult {
  const status = computeSubagentStatus(fatalWriteFailures);
  return {
    id: taskId, role, status,
    findings: buildSubagentFindings(text || "Task completed.", toolOutputs),
    events: [],
    error: status === "failed"
      ? (fatalWriteFailures.length
          ? `Non-retryable write failures: ${fatalWriteFailures.join(", ")}`
          : "Subagent failed")
      : undefined,
  };
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
        output: { type: "string" },
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
    const outputFormat = args.values.output === "text" ? "text" : "json";

    if (!taskId || !sessionId || !prompt) {
      console.error("Missing required args: --task-id, --session-id, --prompt");
      process.exit(1);
    }

    // Load config from current working directory (user's project, not ALiX source tree)
    const projectRoot = process.cwd();
    const loadConfig = (await import("../config/loader.js")).loadConfig;
    const config = await loadConfig(projectRoot) as AlixConfig;

    // §10.3: resolve the effective model with precedence —
    //   explicit provider/model override > models.<tier> > models.default.
    // `config.model` and `config.subagents` are loader-derived compatibility
    // projections and are never mutated here.
    const roleConfig = config.subagents?.roles.find(r => r.role === role);
    const roleStyle = roleConfig?.style ?? "fast";
    const { provider: effectiveProvider, name: effectiveName } = resolveEffectiveModel(
      config,
      roleStyle,
      { provider: providerOverride, name: modelOverride },
    );

    const sessionDir = resolve(process.cwd(), ".alix", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    const eventLog = new EventLog(sessionDir);
    await eventLog.init();

    // Warm up context compiler for this subagent
    const contextCompiler = new ContextCompiler({ root: projectRoot });
    await contextCompiler.warm();

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

      // Resolve tool selector options from config
      const toolConfig = config.toolConfig;
      let maxTools = 3;
      let tokenBudget = 1500;
      let preferKeywordScoring = false;

      if (toolConfig) {
        maxTools = toolConfig.maxTools;
        tokenBudget = toolConfig.tokenBudget;
        // Match model against reliability patterns
        const modelName = effectiveName;
        for (const reliability of toolConfig.reliabilityDefaults) {
          const regex = new RegExp(reliability.modelPattern, "i");
          if (regex.test(modelName)) {
            maxTools = reliability.defaultMaxTools;
            preferKeywordScoring = reliability.preferKeywordScoring;
            break;
          }
        }
      }

      // Load reliability matrix for model-aware tool ranking
      let reliabilityMatrix: ReliabilityMatrix | undefined;
      try {
        reliabilityMatrix = ReliabilityMatrix.load();
      } catch {
        // Non-fatal: continue without reliability weighting
      }

      const toolSelector = new ToolSelector(mcpToolIndex, {
        maxTools,
        tokenBudget,
        preferKeywordScoring,
        model: effectiveName,
        provider: effectiveProvider,
        reliabilityMatrix,
      });
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

    const provider = await createProvider({ provider: effectiveProvider, model: effectiveName });
    const providerTools = buildToolsForProvider(provider);
    const toolPolicy = getToolPolicy(role);
    const allowedTools = filterTools([...providerTools, ...selectedTools], toolPolicy);

    const executor = new ToolExecutor(
      config,
      eventLog,
      projectRoot,
      mcpManager ?? undefined,
      buildEditFormatPolicy({ provider: effectiveProvider, preferred: provider.editFormatPreference }),
      undefined, // extraHandlers
      undefined, // checkpointManager
      undefined, // approvalStore
      undefined, // workspacePathResolver
      undefined, // ownershipRegistry
      mode === "write" ? ownedPaths : undefined,
    );

    // Build system prompt with role instructions and context
    const roleInstructions = ROLE_INSTRUCTIONS[role] ?? "You are a subagent.";

    // Compile context bundle for this task
    const contextBundle = await contextCompiler.compileContext(
      prompt,
      "unknown" // subagents don't classify task type
    );

    // Build context section from primary files
    const contextSection = contextBundle.primaryFiles.length > 0
      ? `\n## Relevant Files\n${contextBundle.primaryFiles.map(f => `- ${f.path}`).join("\n")}`
      : "";

    const systemPrompt = `${roleInstructions}

Task: ${prompt}${contextSection}

## Critical Rules
- alix_file_read reads the CONTENT of a SINGLE FILE. It does NOT list directories.
- To list files in a directory, you MUST use alix_shell_run with: ls <path>
- NEVER call alix_file_read with a directory path (it will fail with "EISDIR")
- Do NOT invent file names or paths. Report only what the tools return.
- Call ONE tool at a time. Wait for the result before calling the next.
- When the tools return output, copy it EXACTLY into a code block. Do NOT interpret it.
- Stop after copying the tool output.
- Report the EXACT output from each tool call. Do NOT summarize or rephrase.
- NEVER emit aider '*** Begin Patch' format. Use only 'search_replace', 'structured_patch', or 'unified_diff'.
- When calling alix_patch_apply with format 'search_replace', ALWAYS start the patch with a '<<<<<<< SEARCH path=<file>' line naming the target file.

Available tools:
${allowedTools.map(t => `- ${t.name}: ${t.description ?? "(no description)"}`).join("\n")}`;

    try {
      const messages: NormalizedMessage[] = [{ role: "user", content: prompt }];
      const fatalWriteFailures: string[] = [];
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

          // Path-less single-block search_replace patches from models that
          // omit the `<<<<<<< SEARCH path=` marker are rewritten to target the
          // worker's sole owned path so owned-path auto-approval and the patch
          // engine both accept them. Self-guards on tool/format/mode/ambiguity.
          inferSingleOwnedPatchPath(toolCall.args as Record<string, unknown>, { mode, ownedPaths });

          const execResult = await executor.execute({ toolCallId: toolCall.id, name: execName, args: toolCall.args });

          const resultContent =
            execResult.kind === "success"
              ? (execResult.output ?? (execResult as { content?: string }).content ?? "")
              : `Error: ${subagentToolError(execResult)}`;

          if (execResult.kind !== "success" && WRITE_EXEC_NAMES.has(execName)) {
            if (!fatalWriteFailures.includes(execName)) fatalWriteFailures.push(execName);
          }
          if (execResult.kind === "success" && resultContent.trim()) {
            toolOutputs.push(resultContent);
          }

          messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });

          // If done tool was called, stop
          if (execName === "done") {
            await mcpManager?.closeAll().catch(() => {});
            const result = buildResult(taskId, role, mode, text, toolOutputs, fatalWriteFailures);
            console.log(formatSubagentResult(result, outputFormat));
            process.exit(result.status === "success" ? 0 : 1);
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

      const result = buildResult(taskId, role, mode, text, toolOutputs, fatalWriteFailures);
      console.log(formatSubagentResult(result, outputFormat));
      process.exit(result.status === "success" ? 0 : 1);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      await eventLog.append({
        actor: "subagent",
        type: "subagent.failed",
        sessionId,
        payload: { subagentId: taskId, role, error: errorMsg },
      });

      await mcpManager?.closeAll().catch(() => {});

      const result: SubagentResult = {
        id: taskId,
        role,
        status: "failed" as const,
        findings: [],
        events: [],
        error: errorMsg,
      };
      console.error(formatSubagentResult(result, outputFormat));
      process.exit(1);
    }
  }
}

// Allow direct invocation: node dist/src/agents/subagent-cli.js --subagent explorer --task-id x --prompt y --session-id z
if (import.meta.url === `file://${process.argv[1]}`) {
  SubagentCLI.main(process.argv.slice(2));
}
