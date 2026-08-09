import { writeFile } from "node:fs/promises";
import { DEFAULT_CONFIG } from "./defaults.js";
import { isValidModelConfig } from "./schema.js";
import type {
  AlixConfig,
  ModelConfig,
  PersistedAlixConfig,
  PersistedSubagentConfig,
  SubagentRoleConfig,
} from "./schema.js";

/**
 * Key-stable role comparison. Each role object is serialized with its keys
 * sorted, so comparison is order-insensitive AND automatically covers any
 * field added to `SubagentRoleConfig` in the future (a field-wise list would
 * silently treat two differing role objects as equal once the schema grows).
 */
function rolesEqual(a: SubagentRoleConfig[] | undefined, b: SubagentRoleConfig[] | undefined): boolean {
  const arrA = a ?? [];
  const arrB = b ?? [];
  if (arrA.length !== arrB.length) return false;
  const sortKeys = (o: SubagentRoleConfig): string =>
    JSON.stringify(Object.fromEntries(Object.entries(o).sort(([ka], [kb]) => ka.localeCompare(kb))));
  for (let i = 0; i < arrA.length; i++) {
    if (sortKeys(arrA[i]!) !== sortKeys(arrB[i]!)) return false;
  }
  return true;
}

/**
 * Strip the loader-derived compatibility projections (`model`, and the six
 * `subagents.<tier>` keys) from a runtime config and brand the result as the
 * persisted representation.
 *
 * This is the ONLY trusted construction point for `PersistedAlixConfig` (§4.1
 * of the plan). Every writer that persists model state must pass through here
 * so `models` is the single persistent source of truth — `model` and the
 * subagent model-tier projections are loader-owned, never independently
 * written.
 *
 * `subagents.enabled`/`roles` are NOT projections: they are behavior config
 * (§2.8.1/§2.8.4) and must survive writes. Only non-default values are
 * persisted — defaults are implied by the loader, so a config that matches the
 * defaults persists no `subagents` at all.
 *
 * The cast is intentionally isolated to this function. The type-only
 * `persistedConfigBrand` unique symbol is erased at runtime, so it never
 * serializes; `models`, `apiKeys`, and every other persisted field survive.
 */
export function withoutDerivedModelProjections(
  config: AlixConfig,
): PersistedAlixConfig {
  // §5.2 legacy migration, mirrored from the loader: a legacy `model` seeds
  // `models.default` when no canonical default exists, so stripping the
  // projection never destroys the user's only model assignment. (The loader
  // also does this on load; this keeps the boundary self-sufficient for raw
  // partial inputs like ConfigMutationService's.)
  if (config.models?.default === undefined && isValidModelConfig(config.model)) {
    config = {
      ...config,
      models: {
        ...(config.models as Record<string, ModelConfig> | undefined),
        default: { ...config.model },
      },
    };
  }

  const {
    model: _model,
    subagents,
    ...persisted
  } = config;

  const result = persisted as PersistedAlixConfig;

  // Preserve behavior config that differs from the defaults. The six
  // `<tier>` keys are dropped regardless — they re-derive from `models` on
  // the next load.
  if (subagents) {
    const behavior: PersistedSubagentConfig = {};
    const def = DEFAULT_CONFIG.subagents;
    if (subagents.enabled !== undefined && subagents.enabled !== def?.enabled) {
      behavior.enabled = subagents.enabled;
    }
    if (
      subagents.roles !== undefined &&
      !rolesEqual(subagents.roles, def?.roles)
    ) {
      behavior.roles = subagents.roles;
    }
    if (Object.keys(behavior).length > 0) {
      result.subagents = behavior;
    }
  }

  return result;
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
