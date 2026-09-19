/**
 * planner-model.ts — Provider-backed generator for the coordination planner.
 *
 * The planner historically called a raw Ollama endpoint with a hard-coded
 * model, so planning only worked when a local Ollama served that model.
 * This builds a `PlannerGenerate` from the configured model (the `fast`
 * tier, falling back to `default`) through the shared provider abstraction,
 * so planning works with any configured provider.
 *
 * The provider is created lazily and memoized per generator.
 */

import type { AlixConfig } from "../config/schema.js";
import type { PlannerGenerate } from "./graph-planner.js";

export function createPlannerGenerator(config: AlixConfig): PlannerGenerate {
  let providerPromise: Promise<import("../providers/types.js").ModelAdapter> | undefined;

  const getProvider = (): Promise<import("../providers/types.js").ModelAdapter> => {
    if (!providerPromise) {
      providerPromise = (async () => {
        const { resolveModelConfig } = await import("../config/model-resolver.js");
        const { createProvider } = await import("../providers/registry.js");
        const resolved = resolveModelConfig(config, "fast");
        return createProvider({
          provider: resolved.provider,
          name: resolved.name,
          ...(resolved.selection !== undefined ? { selection: resolved.selection } : {}),
        });
      })();
      providerPromise.catch(() => {
        providerPromise = undefined;
      });
    }
    return providerPromise;
  };

  return async (prompt: string): Promise<string> => {
    const provider = await getProvider();
    const response = await provider.complete({
      systemPrompt:
        "You are a task planner. Respond with ONLY a JSON object. No markdown, no prose.",
      messages: [{ role: "user", content: prompt }],
    });
    return response.text ?? "";
  };
}
