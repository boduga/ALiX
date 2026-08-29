/**
 * scripted-mock-provider.ts — A deterministic ModelAdapter for the
 * behavioral eval suite.
 *
 * The stock `MockProvider` emits no tool calls, so it cannot drive
 * mutation scenarios (file.create, patch.apply, file.delete). This provider
 * replays a fixed, scripted `ScriptedScenario` of model behavior: emit text
 * and/or tool calls, exactly once each, per `complete()` invocation. It does
 * not pretend to be an LLM — it models behavior so the behavioral suite is
 * deterministic, offline, zero-cost, and CI-safe.
 *
 * Two construction modes:
 *  - explicit scenario (unit tests / direct use): `new ScriptedMockProvider({
 *    steps })` uses its own step cursor.
 *  - registry mode (via `createProvider`): constructed as `new
 *    ScriptedMockProvider({ apiKey, model })` with NO scenario; it reads steps
 *    lazily from the shared `scriptedMockCarrier` on each `complete()`/`stream()`
 *    so the runner can drive per-run scenarios despite provider caching.
 *
 * @module
 */

import { advanceScriptedStep } from "./scripted-mock-carrier.js";
import type {
  ModelAdapter,
  ModelCapabilities,
  NormalizedRequest,
  NormalizedResponse,
  StreamChunk,
  NegotiatedCapabilities,
} from "../../providers/types.js";

/** A single scripted model step, replayed in order across `complete()` calls. */
export type ScriptedModelStep =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      tool: "file.create" | "file.delete" | "patch.apply";
      args: Record<string, unknown>;
    }
  | { kind: "error"; error: string };

export type ScriptedScenario = {
  steps: ScriptedModelStep[];
};

export type ScriptedMockProviderConfig = { apiKey?: string; model?: string } & (
  | { steps: ScriptedModelStep[] }
  | { steps?: never }
);

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  provider: "scripted-mock",
  model: "scripted-mock-model",
  inputTokenLimit: 32_000,
  outputTokenLimit: 4_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsVision: false,
};

/** Model-facing tool names (the wire names the agent loop resolves). */
const TOOL_NAMES: Record<"file.create" | "file.delete" | "patch.apply", string> = {
  "file.create": "alix_file_create",
  "file.delete": "alix_file_delete",
  "patch.apply": "alix_patch_apply",
};

/**
 * A ModelAdapter that replays a scripted scenario deterministically.
 */
export class ScriptedMockProvider implements ModelAdapter {
  id = "scripted-mock";
  capabilities: ModelCapabilities = { ...DEFAULT_CAPABILITIES };
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  private scenario: ScriptedScenario | null;
  private cursor = 0;

  constructor(config: ScriptedMockProviderConfig = {}) {
    this.scenario = "steps" in config && config.steps ? { steps: config.steps } : null;
  }

  /** Reset the replay cursor (for reuse across runs in explicit mode). */
  reset(): void {
    this.cursor = 0;
  }

  async complete(_request: NormalizedRequest): Promise<NormalizedResponse> {
    const step = this.scenario
      ? this.nextInScenario(this.scenario)
      : advanceScriptedStep();
    return this.renderStep(step);
  }

  async negotiate(_request: NormalizedRequest): Promise<NegotiatedCapabilities> {
    return {
      contextBudget: this.capabilities.inputTokenLimit,
      outputBudget: this.capabilities.outputTokenLimit,
      editFormat: this.editFormatPreference,
      toolsEnabled: true,
      structuredOutputEnabled: true,
      visionEnabled: false,
    };
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    const response = await this.complete(request);
    if (response.text) yield { type: "text_delta", text: response.text };
    for (const toolCall of response.toolCalls) yield { type: "tool_call", toolCall };
    yield { type: "done" };
  }

  private nextInScenario(scenario: ScriptedScenario): ScriptedModelStep | undefined {
    const step = scenario.steps[this.cursor];
    this.cursor += 1;
    return step;
  }

  private renderStep(step: ScriptedModelStep | undefined): NormalizedResponse {
    if (!step) {
      return { text: "Done.", toolCalls: [] };
    }
    switch (step.kind) {
      case "text":
        return { text: step.text, toolCalls: [] };
      case "tool":
        return {
          text: "",
          toolCalls: [
            {
              id: `scripted-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
              name: TOOL_NAMES[step.tool],
              args: step.args,
            },
          ],
        };
      case "error":
        throw new Error(step.error);
    }
  }
}
