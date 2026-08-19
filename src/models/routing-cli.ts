// src/models/routing-cli.ts
//
// Describes the configured/logical routing chain for `alix models routing`.
// Describes config — never resolves a request-specific concrete free model.

import { buildFallbackChain } from "../providers/routing-adapter.js";
import { resolveModelConfig } from "../config/model-resolver.js";
import type { AlixConfig } from "../config/schema.js";

export type RoutingChainEntry = {
  provider: string;
  model: string;
  role: "primary" | "fallback";
};

export function describeRoutingChain(config: AlixConfig): RoutingChainEntry[] {
  const model = resolveModelConfig(config);
  const fallbackModels = buildFallbackChain(model);
  const chain: RoutingChainEntry[] = [
    { provider: model.provider, model: model.name, role: "primary" },
  ];
  for (const fb of fallbackModels) {
    chain.push({ provider: fb.provider, model: fb.name, role: "fallback" });
  }
  return chain;
}