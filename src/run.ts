import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import { EventLog } from "./events/event-log.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { MockProvider } from "./providers/mock-provider.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";

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

  await log.append({ sessionId, actor: "system", type: "session.started", payload: { cwd, configHash: "mvp" } });
  await log.append({ sessionId, actor: "user", type: "user.message", payload: { text: task, attachments: [] } });

  const repoMap = config.context.repoMap ? await buildRepoMapLite(cwd) : undefined;
  await log.append({
    sessionId,
    actor: "system",
    type: "context.repo_map_lite_created",
    payload: {
      fileCount: repoMap?.files.length ?? 0,
      sourceCount: repoMap?.sourceFiles.length ?? 0,
      testCount: repoMap?.testFiles.length ?? 0
    }
  });

  const provider =
    config.model.provider === "anthropic"
      ? new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })
      : new MockProvider();
  const response = await provider.complete({
    systemPrompt: "You are ALiX. Produce concise plans.",
    messages: [{ role: "user", content: task }]
  });

  await log.append({ sessionId, actor: "agent", type: "agent.plan_proposed", payload: { text: response.text } });
  await log.append({ sessionId, actor: "system", type: "session.ended", payload: { reason: "completed", summary: response.text } });

  return { sessionId, summary: response.text };
}
