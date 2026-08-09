import { writeFile } from "node:fs/promises";
import type { AlixConfig, PersistedAlixConfig } from "./schema.js";

/**
 * Strip the loader-derived compatibility projections (`model`, `subagents`)
 * from a runtime config and brand the result as the persisted representation.
 *
 * This is the ONLY trusted construction point for `PersistedAlixConfig` (§4.1
 * of the plan). Every writer that persists model state must pass through here
 * so `models` is the single persistent source of truth — `model` and
 * `subagents` are loader-owned projections, never independently written.
 *
 * The cast is intentionally isolated to this function. The type-only
 * `persistedConfigBrand` unique symbol is erased at runtime, so it never
 * serializes; `models`, `apiKeys`, and every other persisted field survive.
 */
export function withoutDerivedModelProjections(
  config: AlixConfig,
): PersistedAlixConfig {
  const {
    model: _model,
    subagents: _subagents,
    ...persisted
  } = config;

  return persisted as PersistedAlixConfig;
}

/**
 * The single shared configuration writer (§4.2). Serializes a branded
 * `PersistedAlixConfig` to `configPath` with deterministic formatting.
 *
 * No other configuration writer should independently serialize configuration —
 * writers must route through here (or through a service that does) so the
 * brand cannot leak and no projection is persisted by hand.
 */
export async function writeConfig(
  config: PersistedAlixConfig,
  configPath: string,
): Promise<void> {
  await writeFile(
    configPath,
    JSON.stringify(config, null, 2) + "\n",
    "utf8",
  );
}
