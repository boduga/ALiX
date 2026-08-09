import { anthropicSpec } from "./anthropic-spec.js";
import type { ProviderSpec } from "../spec-types.js";
export const minimaxTokenPlanSpec: ProviderSpec = {
  ...anthropicSpec,
  baseUrl: "https://api.minimax.io/anthropic/v1/messages",
};