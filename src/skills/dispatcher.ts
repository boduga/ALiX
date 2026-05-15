import type { SkillFactoryConfig } from "../config/schema.js";
import { runSkillFactory } from "./factory.js";

export type DispatchParams = {
  sessionId: string;
  sessionDir: string;
  summary: string;
  filesCreated: string[];
  filesChanged: string[];
  config: SkillFactoryConfig;
};

/**
 * Fire-and-forget skill factory dispatcher.
 * Returns immediately after queuing the job. Does not wait for Ollama.
 */
export async function skillFactoryProcess(params: DispatchParams): Promise<{ queued: boolean; sessionId: string }> {
  // Non-blocking: spawn the factory without awaiting it
  void runSkillFactory(params).catch((err) => {
    console.error("[skill-factory] Failed:", err);
  });
  return { queued: true, sessionId: params.sessionId };
}

// Public API
export const skillFactory = { process: skillFactoryProcess };