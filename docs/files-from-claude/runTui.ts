/**
 * cli/tui.ts
 * Entry point — replaces the original runTui implementation.
 *
 * All terminal management (raw mode, scroll regions, cursor) is handled by
 * Ink.  This file only wires the Tui wrapper to runTask and the event log.
 */

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
  const contextInfo = await resolveContextLimit(
    config.model.provider,
    config.model.name,
    config.apiKeys,
  );

  const tui = new Tui({ sessionId, eventLog: tuiLog, maxTokens: contextInfo.maxTokens });

  // Wire up the task handler before init() so the ref is set when Ink mounts
  tui.onTask = async (task: string) => {
    try {
      const result = await runTask(
        cwd,
        task,
        {
          streaming: true,
          sessionMode: "bypass",
          sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
        },
        (chunk) => {
          if (chunk.type === "text" && typeof chunk.text === "string") {
            // Split on newlines — each logical line is a separate Static item
            for (const line of chunk.text.split("\n")) {
              tui.appendOutput(line, true);
            }
          }

          // Update token bar if the chunk carries usage metadata
          if (chunk.type === "usage" && typeof chunk.inputTokens === "number") {
            tui.updateTokenUsage(chunk.inputTokens + (chunk.outputTokens ?? 0));
          }
        },
      );

      if (result.summary) {
        tui.appendOutput(result.summary, false);
      }

      if (result.usage) {
        const total =
          (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
        tui.updateTokenUsage(total);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ERR_USE_AFTER_CLOSE") return;
      tui.appendOutput(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    }
  };

  tui.onExit = () => {
    tui.destroy();
    process.exit(0);
  };

  await tui.init();

  // Welcome message — printed once into the Static output area
  tui.appendOutput("ALiX  ·  Interactive Session", false);
  tui.appendOutput(`session: ${sessionId}`, false);
  tui.appendOutput(`context: ${contextInfo.maxTokens?.toLocaleString() ?? "unknown"} tokens`, false);
  tui.appendOutput('Type "exit" or press Ctrl+C to quit.', false);
  tui.appendOutput("", false);

  // Keep the Node process alive until Ink exits (the onExit callback calls
  // process.exit, so this promise never rejects in normal operation).
  await new Promise<void>(() => {});
}
