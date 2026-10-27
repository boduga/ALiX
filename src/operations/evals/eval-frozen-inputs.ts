/**
 * eval-frozen-inputs.ts — compute the §3 frozen-input pins a Gate B run must
 * record BEFORE its first invocation.
 *
 * WHY THIS EXISTS
 *
 * The collection proposal (`docs/audits/2026-10-23-gate-b-collection-proposal.md`
 * §3) requires seven pins per run, and says a run admitted with a missing pin is
 * not Gate B evidence. Recording them after the fact is worthless: the point is
 * to know what was actually frozen when the first token was spent.
 *
 * NULLS ARE FIRST-CLASS, AGAIN
 *
 * Some pins cannot be derived from this repository. The provider does not report
 * an immutable revision for every model, and the pricing catalog is a built-in
 * table rather than a fetched rate snapshot. Those come back `null` with a
 * `blocking` reason instead of a plausible-looking substitute. `admissible` is
 * then false, and the caller must not invoke a provider. A fabricated pin would
 * convert "we do not know" into "we checked", which is the exact failure the
 * audit exists to prevent.
 *
 * This module only reads and hashes. It does not invoke a provider, write
 * config, or mutate the workspace.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { join } from "node:path";
import { ALIX_CANONICAL_BUILTIN_TOOLS } from "../../agents/tool-manifest.js";
import { defaultPricingCatalog, isNonBillableProvider } from "../observability/cost-attribution.js";
import { buildEvalConfig } from "./evals-runner.js";

/**
 * Files that constitute the eval corpus and its oracles. A change to any of
 * these changes what a case measures, so a run must record which version it saw.
 */
export const CORPUS_FILES = [
  "src/operations/evals/cases/index.ts",
  "src/operations/evals/cases/behavioral.ts",
  "src/operations/evals/cases/strata-2-4.ts",
  "src/operations/evals/cases/strata-5-10.ts",
  "src/operations/evals/cases/stratum-9-local.ts",
  "src/operations/evals/evaluators/objective-evaluator.ts",
  "src/operations/evals/evaluators/status-evaluator.ts",
  "src/operations/evals/eval-guards.ts",
  "src/operations/evals/eval-admissibility.ts",
] as const;

export type PricingPin = {
  /** Where the rate came from. A built-in table is not a fetched snapshot. */
  source: string;
  effectiveFrom: string | null;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  currency: string | null;
  /** ISO timestamp of when this pin was computed. */
  observedAt: string;
  note?: string;
  /**
   * `operator-snapshot` when the rate came from an explicit fetched snapshot,
   * `built-in-catalog` when it fell back to the repository table.
   */
  /**
   * `non-billable` means the provider costs nothing by definition (local CPU),
   * so a missing rate is a measured zero rather than an unknown. This is the same
   * distinction cost-attribution already draws; treating "no rate" as unknown for
   * a local model would block a stratum that legitimately costs nothing.
   */
  provenance: "operator-snapshot" | "built-in-catalog" | "non-billable";
};

/**
 * An operator-supplied rate snapshot (§3 asks for "source and timestamp", not
 * only the catalog default). Shape is validated on use; a snapshot naming a
 * different provider/model than the run is a blocking mismatch, never a silent
 * substitution.
 */
export type RateSnapshotInput = {
  provider: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
  source: string;
  observedAt: string;
  effectiveFrom?: string;
};

/**
 * How the immutable model revision was established.
 *
 * `provider-reported` is a fingerprint the provider returned. `model-id-snapshot`
 * means the model name itself is a dated snapshot id (e.g. `-2024-08-06` or
 * `-0731`), which is the provider's immutable identifier. A plain alias
 * (`gpt-4o`) yields no revision at all — §3 says an alias is insufficient.
 */
export type RevisionSource = "provider-reported" | "model-id-snapshot";

const DATED_SNAPSHOT = /-\d{4}$|-\d{4}-\d{2}(-\d{2})?$/;

/**
 * Resolve the immutable revision from the model id alone.
 *
 * Deliberately narrow: only a trailing date-shaped suffix counts. Treating every
 * model name as its own revision would make the pin meaningless.
 */
export function revisionFromModelId(model: string): { revision: string; source: RevisionSource } | null {
  return DATED_SNAPSHOT.test(model) ? { revision: model, source: "model-id-snapshot" } : null;
}

export type EnvironmentHardware = {
  /** Logical CPU count. Recorded for stratum 9, where hardware is the axis. */
  cpuCount: number | null;
  cpuModel: string | null;
  totalMemoryBytes: number | null;
};

export type FrozenInputs = {
  model: {
    provider: string;
    name: string;
    /**
     * Immutable revision: a provider-reported fingerprint, or a dated snapshot
     * model id. `null` when the name is a plain alias — §3 says an alias alone
     * is insufficient, so that stays blocking.
     */
    revision: string | null;
    /** How `revision` was established. `null` when it could not be. */
    revisionSource: RevisionSource | null;
  };
  /** SHA-256 of the resolved config the case will actually run under. */
  configHash: string;
  /** SHA-256 of the sorted canonical built-in tool manifest. */
  offeredToolsHash: string;
  offeredTools: string[];
  /** SHA-256 over every corpus file hash, in listed order. */
  corpusHash: string;
  corpusFiles: Array<{ path: string; sha256: string | null }>;
  environment: { node: string; platform: string; arch: string } & EnvironmentHardware;
  pricing: PricingPin;
  /** Reasons a pin is unknown. Non-empty means the run must not be admitted. */
  blocking: string[];
  /** True only when every §3 pin is known. */
  admissible: boolean;
};

/** Hardware facts. A stratum-9 observation is about the hardware, so record it. */
function captureHardware(): EnvironmentHardware {
  try {
    const list = cpus();
    return {
      cpuCount: list.length > 0 ? list.length : null,
      cpuModel: list[0]?.model ?? null,
      totalMemoryBytes: totalmem(),
    };
  } catch {
    return { cpuCount: null, cpuModel: null, totalMemoryBytes: null };
  }
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Stable JSON so key order in the config object cannot change the hash. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Resolve the pricing pin: an operator snapshot wins over the built-in table,
 * because §3 asks for a rate with its own source and timestamp. A snapshot for a
 * different provider/model is a blocking mismatch — using it would price this run
 * with another model's rate.
 */
function resolvePricingPin(
  provider: string,
  model: string,
  now: Date,
  snapshot?: RateSnapshotInput,
): { pricing: PricingPin; blocking: string[] } {
  if (snapshot) {
    if (snapshot.provider !== provider || snapshot.model !== model) {
      return {
        pricing: unknownPricingPin(
          provider,
          model,
          now,
          `Rate snapshot is for ${snapshot.provider}/${snapshot.model}, not ${provider}/${model}.`,
        ),
        blocking: [`rate snapshot does not match ${provider}/${model}`],
      };
    }
    return {
      pricing: {
        source: snapshot.source,
        effectiveFrom: snapshot.effectiveFrom ?? null,
        inputPerMillion: snapshot.inputPerMillion,
        outputPerMillion: snapshot.outputPerMillion,
        currency: snapshot.currency,
        observedAt: snapshot.observedAt,
        provenance: "operator-snapshot",
        note: "Operator-supplied rate snapshot; retained with the run.",
      },
      blocking: [],
    };
  }

  // A local provider has no rate by design. Zero is measured here, not assumed.
  if (isNonBillableProvider(provider)) {
    return {
      pricing: {
        source: `non-billable provider (${provider})`,
        effectiveFrom: null,
        inputPerMillion: 0,
        outputPerMillion: 0,
        currency: "USD",
        observedAt: now.toISOString(),
        provenance: "non-billable",
        note: "Local/non-billable provider: zero cost is measured, not unknown.",
      },
      blocking: [],
    };
  }

  const entry = defaultPricingCatalog().lookup(provider, model, now.toISOString());
  if (!entry) {
    return {
      pricing: unknownPricingPin(
        provider,
        model,
        now,
        `No built-in rate for ${provider}/${model}. Cost stays unknown; the ceiling cannot be enforced from this pin.`,
      ),
      blocking: [`no pricing pin for ${provider}/${model}: ceiling cannot be enforced`],
    };
  }
  return {
    pricing: {
      source: "defaultPricingCatalog() built-in table",
      effectiveFrom: entry.effectiveFrom,
      inputPerMillion: entry.inputPerMillion,
      outputPerMillion: entry.outputPerMillion,
      currency: entry.currency,
      observedAt: now.toISOString(),
      provenance: "built-in-catalog",
      note: "Built-in table, not a fetched provider rate snapshot. Supply --rate-snapshot for §3 provenance.",
    },
    blocking: [],
  };
}

function unknownPricingPin(provider: string, model: string, now: Date, note: string): PricingPin {
  return {
    source: `no rate for ${provider}/${model}`,
    effectiveFrom: null,
    inputPerMillion: null,
    outputPerMillion: null,
    currency: null,
    observedAt: now.toISOString(),
    provenance: "built-in-catalog",
    note,
  };
}

/**
 * Compute the pins for a run about to use `provider`/`model`.
 *
 * `root` is the repository root the corpus hashes are read from. A missing
 * corpus file is a blocking pin: a run cannot claim a corpus version it could
 * not read.
 */
export function captureFrozenInputs(
  root: string,
  provider: string,
  model: string,
  options: {
    timeoutMs?: number;
    now?: Date;
    /** Explicit fetched rate snapshot, preferred over the built-in table. */
    rateSnapshot?: RateSnapshotInput;
    /** Fingerprint a probe observed the provider return for this model. */
    providerRevision?: string;
  } = {},
): FrozenInputs {
  const now = options.now ?? new Date();
  const blocking: string[] = [];

  const config = buildEvalConfig(provider, model, options.timeoutMs);
  const configHash = sha256(stableJson(config));

  const offeredTools = [...ALIX_CANONICAL_BUILTIN_TOOLS].sort();
  const offeredToolsHash = sha256(JSON.stringify(offeredTools));

  const corpusFiles = CORPUS_FILES.map(path => {
    const absolute = join(root, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      blocking.push(`corpus file is missing and cannot be pinned: ${path}`);
      return { path, sha256: null };
    }
    return { path, sha256: sha256(readFileSync(absolute)) };
  });
  const corpusHash = sha256(corpusFiles.map(f => `${f.path}:${f.sha256 ?? "missing"}`).join("\n"));

  const { pricing, blocking: pricingBlocking } = resolvePricingPin(
    provider,
    model,
    now,
    options.rateSnapshot,
  );
  blocking.push(...pricingBlocking);

  // Prefer a provider-reported fingerprint when the caller has one (a probe can
  // supply it). Otherwise a dated snapshot model id IS the immutable identity;
  // a plain alias is not, and stays blocking.
  const fromId = revisionFromModelId(model);
  const revision = options.providerRevision ?? fromId?.revision ?? null;
  const revisionSource: RevisionSource | null = options.providerRevision
    ? "provider-reported"
    : fromId
      ? fromId.source
      : null;
  if (!revision) {
    blocking.push(
      `no immutable model revision for ${provider}/${model}: the name is a plain alias and no provider fingerprint was recorded; §3 requires a revision`,
    );
  }

  return {
    model: { provider, name: model, revision, revisionSource },
    configHash,
    offeredToolsHash,
    offeredTools,
    corpusHash,
    corpusFiles,
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      ...captureHardware(),
    },
    pricing,
    blocking,
    admissible: blocking.length === 0,
  };
}
