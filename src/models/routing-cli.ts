// src/models/routing-cli.ts
//
// Describes the configured/logical routing chain for `alix models routing`.
// Describes config — never resolves a request-specific concrete free model.

import { resolveModelConfig } from "../config/model-resolver.js";
import type { AlixConfig } from "../config/schema.js";

export type RoutingChainEntry = {
  provider: string;
  model: string;
  role: "primary" | "fallback";
};

export function describeRoutingChain(config: AlixConfig): RoutingChainEntry[] {
  const model = resolveModelConfig(config);
  const routing = model.routing;
  const chain: RoutingChainEntry[] = [
    { provider: model.provider, model: model.name, role: "primary" },
  ];
  if (routing?.freeFallback && model.provider === "openrouter") {
    chain.push({ provider: "openrouter", model: "openrouter/free", role: "fallback" });
  }
  if (routing?.fallbacks) {
    for (const fb of routing.fallbacks) {
      chain.push({ provider: fb.provider, model: fb.name, role: "fallback" });
    }
  }
  return chain;
}