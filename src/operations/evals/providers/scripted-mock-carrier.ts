/**
 * scripted-mock-carrier.ts — Module-level scenario carrier bridging the
 * provider registry (which constructs providers as `new ProviderClass({
 * apiKey, model })` with NO scenario) and the behavioral eval runner.
 *
 * `createProvider` caches instances forever, so a scenario cannot be fixed in
 * the provider constructor. Instead the runner sets the current scenario on
 * this carrier before each `runTask`, and the registered `ScriptedMockProvider`
 * reads steps lazily on each `complete()`/`stream()` call. Runs are sequential,
 * so a single global step cursor is safe.
 *
 * @module
 */

import type { ScriptedModelStep, ScriptedScenario } from "./scripted-mock-provider.js";

export type ScriptedCarrier = {
  current: ScriptedScenario | null;
  calls: number;
};

/**
 * Subprocess transport for the scripted scenario. A delegate driver spawns an
 * `alix run --subagent` subprocess which builds its own ScriptedMockProvider
 * (separate process, separate module state). The runner serialises the scenario
 * into this env var; the carrier hydrates from it on first access so the
 * subagent can drive real filesystem mutations deterministically.
 */
const SCENARIO_ENV_KEY = "ALIX_EVAL_SCENARIO";

export const scriptedMockCarrier: ScriptedCarrier = {
  current: null,
  calls: 0,
};

let hydratedFromEnv = false;

function hydrateFromEnv(): void {
  if (hydratedFromEnv) return;
  hydratedFromEnv = true;
  if (scriptedMockCarrier.current) return;
  const raw = process.env[SCENARIO_ENV_KEY];
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as ScriptedScenario).steps)
    ) {
      scriptedMockCarrier.current = parsed as ScriptedScenario;
    }
  } catch {
    // ignore malformed env scenario
  }
}

/** Set the scenario for the next eval run and reset the step cursor. */
export function setScriptedScenario(scenario: ScriptedScenario): void {
  scriptedMockCarrier.current = scenario;
  scriptedMockCarrier.calls = 0;
  hydratedFromEnv = true;
}

/** Clear the active scenario (no scripted provider will emit tool calls). */
export function clearScriptedScenario(): void {
  scriptedMockCarrier.current = null;
  scriptedMockCarrier.calls = 0;
}

/**
 * Consume the next unconsumed step, if any. Returns `undefined` when no
 * scenario is active or all steps are exhausted.
 */
export function advanceScriptedStep(): ScriptedModelStep | undefined {
  hydrateFromEnv();
  const scenario = scriptedMockCarrier.current;
  if (!scenario) return undefined;
  const step = scenario.steps[scriptedMockCarrier.calls];
  if (!step) return undefined;
  scriptedMockCarrier.calls += 1;
  return step;
}
