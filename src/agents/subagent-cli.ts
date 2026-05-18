/**
 * Subagent entry point. Parses CLI args, builds prompt, calls model, exits.
 * Invoked by SubagentManager.spawn() as a child process via `alix run --subagent`.
 */
import { parseArgs } from "util";
import { resolve } from "path";
import { mkdir } from "fs/promises";
import { mergeConfig, DEFAULT_CONFIG } from "../config/loader.js";
import type { AlixConfig } from "../config/schema.js";
import { EventLog } from "../events/event-log.js";
import { createProvider } from "../providers/registry.js";

type SubagentRole = "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";

const ROLE_INSTRUCTIONS: Record<SubagentRole, string> = {
  explorer:          "You are an explorer subagent. Understand code regions and report your findings concisely. Use file references, summarize structure, identify key symbols.",
  reviewer:           "You are a code reviewer. Analyze code quality, style, and potential issues. Be constructive and specific. Flag risks and suggest improvements.",
  test_investigator:  "You are a test investigator. Map tests to code, diagnose failures, and suggest fixes. Be precise. Use test names and file paths.",
  docs_researcher:    "You are a docs researcher. Find and summarize relevant documentation. Cite file paths and sources. Be thorough.",
  worker:             "You are a worker subagent. Apply changes to owned files only. Wait for confirmation before writing. Always explain what you changed.",
};

export class SubagentCLI {
  static async main(argv: string[]): Promise<void> {
    const args = parseArgs({
      args: argv,
      options: {
        subagent: { type: "string" },
        "task-id": { type: "string" },
        prompt: { type: "string" },
        model: { type: "string" },
        mode: { type: "string" },
        sessionId: { type: "string" },
        "owned-paths": { type: "string" },
      },
      allowPositionals: false,
    });

    const role: SubagentRole = (args.values.subagent ?? "explorer") as SubagentRole;
    const taskId = args.values["task-id"];
    const prompt = args.values.prompt ?? "";
    const mode = (args.values.mode ?? "read_only") as "read_only" | "write";
    const sessionId = args.values.sessionId;
    const ownedPaths = args.values["owned-paths"]?.split(",").filter(Boolean);
    const modelOverride = args.values.model;

    if (!taskId || !sessionId || !prompt) {
      console.error("Missing required args: --task-id, --session-id, --prompt");
      process.exit(1);
    }

    const config = mergeConfig(DEFAULT_CONFIG, {}) as AlixConfig;
    const sessionDir = resolve(process.cwd(), ".alix", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    const eventLog = new EventLog(sessionDir);
    await eventLog.init();

    // Apply model override from SubagentManager
    if (modelOverride) {
      config.model.name = modelOverride;
    }

    // Log subagent start
    await eventLog.append({
      actor: "subagent",
      type: "subagent.started",
      sessionId,
      payload: { subagentId: taskId, role, mode, ownedPaths },
    });

    // Build system prompt with role instructions
    const roleInstructions = ROLE_INSTRUCTIONS[role] ?? "You are a subagent.";
    const systemPrompt = `${roleInstructions}

Task: ${prompt}

Work in the current directory. Be concise and focused.`;

    try {
      const provider = createProvider({ provider: config.model.provider, model: config.model.name });

      const response = await provider.complete({
        systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      // Log completion
      await eventLog.append({
        actor: "subagent",
        type: "subagent.completed",
        sessionId,
        payload: { subagentId: taskId, role, resultLength: response.text.length },
      });

      // Write structured result to stdout
      console.log(JSON.stringify({
        id: taskId,
        role,
        status: "success" as const,
        findings: [],
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