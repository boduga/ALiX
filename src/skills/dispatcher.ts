import type { SkillFactoryConfig } from "../config/schema.js";
import { runSkillFactory } from "./factory.js";

export const DEFAULT_FACTORY_CONFIG: SkillFactoryConfig = {
  enabled: false,
  provider: "ollama",
  model: "llama3",
  maxStore: 50,
  maxCandidates: 200,
  autoPromote: true,
};

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
  if (!params.config.enabled) return { queued: false, sessionId: params.sessionId };
  // Non-blocking: spawn the factory without awaiting it
  void runSkillFactory(params).catch((err) => {
    console.error("[skill-factory] Failed:", err);
  });
  return { queued: true, sessionId: params.sessionId };
}

// Public API
export const skillFactory = { process: skillFactoryProcess };