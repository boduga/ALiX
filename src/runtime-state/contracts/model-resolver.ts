// src/runtime-state/contracts/model-resolver.ts
//
// R1 boundary freeze — ModelResolver.
// Single reader boundary for the canonical `models.*` configuration.
// Reuses ModelTier/ModelConfig from src/config. No flat `model`
// reads, no legacy aliases, no parallel resolvers through this port.

import type { ModelConfig, ModelTier } from "../../operations/config/schema.js";

export type { ModelConfig, ModelTier };

export interface ModelResolver {
  resolve(tier?: ModelTier): ModelConfig | undefined;
  require(tier?: ModelTier): ModelConfig;
}
