import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Tui } from "../../tui/index.js";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { runTask } from "../../run.js";

export interface TuiOptions {
  sessionName?: string;
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const cwd = process.cwd();

  const sessionId = opts.sessionName
    ? opts.sessionName.replace(/[^a-zA-Z0-9-_]/g, "-")
    : randomUUID();

  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  const tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  const { resolveContextLimit } = await import("../../config/context-limits.js");
  const contextInfo = await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys);

  const tui = new Tui({ sessionId, maxTokens: contextInfo.maxTokens });

  tui.onTask = async (task: string) => {
    try {
      const result = await runTask(cwd, task, {
        streaming: true,
        sessionMode: "bypass",
        sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
      }, (chunk) => {
        if (chunk.type === "text" && typeof chunk.text === "string") {
          tui.appendOutput(chunk.text, true);
        }
      });

      if (result.summary) {
        tui.appendOutput(result.summary, false);
      }

      // Track token usage from model.usage events
      if (contextInfo.maxTokens) {
        const events = await tuiLog.readAll();
        let totalTokens = 0;
        for (const ev of events) {
          if (ev.type === "model.usage" && typeof (ev.payload as any)?.inputTokens === "number") {
            totalTokens += (ev.payload as any).inputTokens + ((ev.payload as any).outputTokens ?? 0);
          }
        }
        if (totalTokens > 0) tui.updateTokenUsage(totalTokens);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") return;
      tui.appendOutput(`Error: ${err instanceof Error ? err.message : String(err)}`, false);
    }
  };

  tui.onExit = () => {
    tui.destroy();
    process.exit(0);
  };

  await tui.init();

  // Welcome messages
  tui.appendOutput("ALiX · Interactive Session", false);
  tui.appendOutput(`session: ${sessionId.slice(0, 16)}…`, false);
  tui.appendOutput(`context: ${(contextInfo.maxTokens ?? 0).toLocaleString()} tokens`, false);
  tui.appendOutput(`model: ${config.model.provider}/${config.model.name}`, false);
  tui.appendOutput('type "exit" or Ctrl+C to quit', false);
  tui.appendOutput("", false);

  // Keep alive
  await new Promise<void>(() => {});
}
