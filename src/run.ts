import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config/loader.js";
import { EventLog } from "./events/event-log.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";
import { MockProvider } from "./providers/mock-provider.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import type { NormalizedMessage } from "./providers/types.js";
import { ToolExecutor } from "./tools/executor.js";
import { discoverVerification, runVerification } from "./verifier/verifier.js";

const MAX_ITERATIONS = 10;

export type RunResult = {
  sessionId: string;
  summary: string;
};

export async function runTask(cwd: string, task: string): Promise<RunResult> {
  const sessionId = randomUUID();
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  const log = new EventLog(sessionDir);
  await log.init();
  const session = { sessionId, actor: "system" as const };

  await log.append({ ...session, type: "session.started", payload: { cwd, configHash: "mvp" } });
  await log.append({ ...session, actor: "user", type: "user.message", payload: { text: task, attachments: [] } });

  const repoMap = config.context.repoMap ? await buildRepoMapLite(cwd) : undefined;
  await log.append({
    ...session,
    type: "context.repo_map_lite_created",
    payload: { fileCount: repoMap?.files.length ?? 0, sourceCount: repoMap?.sourceFiles.length ?? 0, testCount: repoMap?.testFiles.length ?? 0 }
  });

  const provider =
    config.model.provider === "anthropic"
      ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
      : new MockProvider();
  const executor = new ToolExecutor(config, log, cwd);

  const messages: NormalizedMessage[] = [{ role: "user", content: task }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await provider.complete({
      systemPrompt: "You are ALiX. You have access to tools. Use them to complete the user's request.",
      messages
    });

    await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text: response.text } });

    if (response.toolCalls.length === 0) {
      // Run verification before final response
      const checks = await discoverVerification(cwd);
      for (const check of checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
        const verResult = await runVerification(cwd, check);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
      }

      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: response.text } });
      return { sessionId, summary: response.text };
    }

    // Handle each tool call
    for (const toolCall of response.toolCalls) {
      const execResult = await executor.execute({ toolCallId: toolCall.id, name: toolCall.name, args: toolCall.args });

      const resultContent =
        execResult.kind === "success"
          ? (execResult.output ?? execResult.content ?? "")
          : `Error: ${(execResult as { kind: "denied"; reason: string }).reason ?? (execResult as { kind: "error"; message: string }).message}`;

      messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\n${resultContent}\n</tool_result>` });
    }
  }

  // Max iterations reached
  await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: "Agent reached maximum iterations" } });
  return { sessionId, summary: "Agent reached maximum iterations" };
}