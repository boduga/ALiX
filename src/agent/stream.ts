import type { ToolCall } from "../providers/types.js";

/**
 * CI detection for streaming gating.
 *
 * Provider-specific env vars are authoritative and mutually exclusive (only
 * one provider runs at a time, and none are set by ordinary user shells), so
 * they are checked first. The generic `CI` / `CONTINUOUS_INTEGRATION`
 * catch-alls come last — least specific. Non-empty string is truthy, matching
 * the `ci-info` / `@actions/core` convention.
 */
const CI_ENV_KEYS = [
  "GITHUB_ACTIONS", "GITLAB_CI", "TF_BUILD", "JENKINS_URL",
  "TEAMCITY_VERSION", "TRAVIS", "CIRCLECI", "APPVEYOR",
  "BUILDKITE", "DRONE", "BITBUCKET_COMMIT",
  "CI", "CONTINUOUS_INTEGRATION",
] as const;

export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  return CI_ENV_KEYS.some((key) => Boolean(env[key]));
}

/**
 * Auto-disable streaming in CI only, so CI logs stay deterministic.
 * Streaming is the default in any local context (TTY or piped) — a local
 * non-TTY run still streams its tokens to stdout. Callers can opt out via
 * `config.model.streaming` / `ALIX_STREAMING=false`.
 */
export function shouldAutoDisableStreaming(env: NodeJS.ProcessEnv = process.env): boolean {
  return isCI(env);
}

export type StreamHandler = (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;
