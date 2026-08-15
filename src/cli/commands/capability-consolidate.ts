// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * P5.5/P5.6 — `alix capability consolidate` (locked ruling #544, 2026-08-15).
 *
 * THE AUTHORIZED CALLER for `consolidation_opportunity`. The operator supplies
 * the COMPLETE governed set explicitly on the command line:
 *
 *   alix capability consolidate \
 *     --survivor=<id@version> \
 *     --absorbed=<id@version>,<id@version> \
 *     --definition=<id@version> \
 *     --source-disposition=deprecate|remove
 *
 * Semantics of an invocation (ruling #544, verbatim):
 *
 *   "I explicitly request consolidation of B and C into A."
 *
 * It does NOT mean:
 *
 *   "The system inferred that A should absorb B and C."
 *
 * Hard architectural boundary (rulings #534, #543, #544):
 * - MUST NOT derive `--survivor` or `--absorbed` from the P5.5 pair layer,
 *   the overlap analyzer, the catalog, or any other heuristic source. Only
 *   explicit operator input populates them.
 * - MUST NOT default, complete, expand, reorder, or de-duplicate the
 *   operator's absorbed set. A malformed set is REJECTED, never repaired.
 *   (`--absorbed` is order-preserving; duplicates are rejected by
 *   `validateConsolidateMerge`, not silently collapsed.)
 * - MUST NOT silently default ANY required field. Every one of the four
 *   flags above is required; a missing flag is a usage error (exit 2).
 * - Pair-layer evidence may be DISPLAYED as context (`--show-evidence`),
 *   but it is never read as an input to the identities.
 *
 * This is a THIN ADAPTER (mirrors `capability-measure.ts`): parse, validate
 * shape, resolve the operator-named definition, hand off to
 * `service.proposeConsolidation()`. No consolidation logic, no merge
 * synthesis, no survivorship decision.
 *
 * Exit codes:
 *   0 — proposal submitted
 *   2 — usage error (missing/malformed flag, survivor ∈ absorbed, empty set)
 *   3 — proposal rejected by the consolidation contract
 *   4 — an operator-supplied id/version is not in the catalog
 *   5 — service absent or not implemented
 *
 * @module cli/commands/capability-consolidate
 */

import type {
  CapabilityService,
  OperatorConsolidationInput,
} from "../../capability/capability-service.js";
import type { CapabilityDefinition } from "../../capability/canonical/definition.js";
import type { SourceDisposition } from "../../capability/evolution/consolidation-identity.js";
import { isSourceDisposition } from "../../capability/evolution/consolidation-identity.js";
import { CapabilityNotFoundError } from "../../capability/errors.js";
import { CapabilityServiceNotImplementedError } from "../../capability/errors/service-not-implemented.js";

/**
 * Narrow READ-ONLY definition lookup. Deliberately structural so the CLI
 * never receives the mutable `CapabilityCatalog` (CAP-11 ruling #8 keeps the
 * catalog private to the composition root).
 */
export interface CapabilityDefinitionLookup {
  get(id: string): CapabilityDefinition | undefined;
}

const USAGE = [
  "Usage: alix capability consolidate \\",
  "         --survivor=<id@version> \\",
  "         --absorbed=<id@version>[,<id@version>...] \\",
  "         --definition=<id@version> \\",
  "         --source-disposition=deprecate|remove",
  "",
  "All four flags are REQUIRED — the operator supplies the complete governed",
  "set explicitly (ruling #544). Nothing is inferred or defaulted.",
].join("\n");

/** A parsed `<id@version>` reference. Both halves must be present. */
export interface CapabilityRef {
  readonly id: string;
  readonly version: string;
}

/**
 * The operator's explicit, fully-parsed request. Purely a restatement of the
 * command line — no field is sourced from anywhere but operator input.
 */
export interface ParsedConsolidateArgs {
  readonly survivor: CapabilityRef;
  readonly absorbed: readonly CapabilityRef[];
  readonly definition: CapabilityRef;
  readonly sourceDisposition: SourceDisposition;
  readonly showEvidence: boolean;
}

export type ParseConsolidateResult =
  | { readonly ok: true; readonly args: ParsedConsolidateArgs }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Read `--flag=value` or `--flag value`. Returns undefined when absent. */
function readFlag(args: readonly string[], name: string): string | undefined {
  const prefixed = args.find((a) => a.startsWith(`${name}=`));
  if (prefixed !== undefined) return prefixed.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0) {
    const next = args[idx + 1];
    if (next !== undefined && !next.startsWith("--")) return next;
    // Present but valueless — surface as an empty value so the caller
    // rejects it rather than falling back to a default.
    return "";
  }
  return undefined;
}

/**
 * Result of `parseRef`: either a valid `CapabilityRef` or a human-readable
 * error message keyed to the originating flag. Code-review pass 3 (J3):
 * replaced the previous `errors`-out-parameter + `undefined` return with a
 * tuple-like object so the call sites read as pure expressions instead of
 * side-effecting parsers.
 */
type ParseRefResult =
  | { readonly ref: CapabilityRef; readonly error: undefined }
  | { readonly ref: undefined; readonly error: string };

function parseRef(raw: string, flag: string): ParseRefResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ref: undefined, error: `${flag}: value must not be empty` };
  }
  const at = trimmed.indexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return {
      ref: undefined,
      error: `${flag}: expected <id@version>, received '${trimmed}'`,
    };
  }
  return {
    ref: { id: trimmed.slice(0, at), version: trimmed.slice(at + 1) },
    error: undefined,
  };
}

/**
 * Parse + shape-validate the operator's flags.
 *
 * Rejects (never repairs):
 * - a missing `--survivor`, `--absorbed`, `--definition`, or
 *   `--source-disposition`;
 * - an empty `--absorbed` (ruling #534: the absorbed set is non-empty);
 * - `survivor ∈ absorbed` (`validateConsolidateMerge` invariant, checked
 *   here so the operator gets a usage error rather than a contract error).
 *
 * Pure — no catalog access, no I/O, no evidence consumption.
 */
export function parseConsolidateArgs(args: readonly string[]): ParseConsolidateResult {
  const errors: string[] = [];

  const rawSurvivor = readFlag(args, "--survivor");
  const rawAbsorbed = readFlag(args, "--absorbed");
  const rawDefinition = readFlag(args, "--definition");
  const rawDisposition = readFlag(args, "--source-disposition");

  if (rawSurvivor === undefined) errors.push("--survivor is required (operator-supplied survivor)");
  if (rawAbsorbed === undefined)
    errors.push("--absorbed is required (operator-supplied complete absorbed set)");
  if (rawDefinition === undefined)
    errors.push("--definition is required (operator-supplied target definition)");
  if (rawDisposition === undefined)
    errors.push("--source-disposition is required (deprecate|remove; never defaulted)");

  const survivorResult =
    rawSurvivor !== undefined ? parseRef(rawSurvivor, "--survivor") : undefined;
  if (survivorResult?.error) errors.push(survivorResult.error);
  const survivor = survivorResult?.ref;

  const definitionResult =
    rawDefinition !== undefined ? parseRef(rawDefinition, "--definition") : undefined;
  if (definitionResult?.error) errors.push(definitionResult.error);
  const definition = definitionResult?.ref;

  let absorbed: CapabilityRef[] | undefined;
  if (rawAbsorbed !== undefined) {
    // Order-preserving. Empty segments are an error, not a silent skip.
    const segments = rawAbsorbed.split(",").map((s) => s.trim());
    const nonEmpty = segments.filter((s) => s !== "");
    if (nonEmpty.length === 0) {
      errors.push(
        "--absorbed must name at least one capability (ruling #534 — the absorbed set is caller-supplied and non-empty)",
      );
    } else if (nonEmpty.length !== segments.length) {
      errors.push("--absorbed contains an empty entry");
    } else {
      const parsed = segments.map((s) => parseRef(s, "--absorbed"));
      for (const r of parsed) {
        if (r.error) errors.push(r.error);
      }
      const refs = parsed.flatMap((r) => (r.ref ? [r.ref] : []));
      if (refs.length === parsed.length) absorbed = refs;
    }
  }

  let sourceDisposition: SourceDisposition | undefined;
  if (rawDisposition !== undefined) {
    if (isSourceDisposition(rawDisposition)) {
      sourceDisposition = rawDisposition;
    } else {
      errors.push(
        `--source-disposition: expected 'deprecate' or 'remove', received '${rawDisposition}'`,
      );
    }
  }

  // survivor ∉ absorbed — checked on the operator's own values.
  if (survivor !== undefined && absorbed !== undefined) {
    if (absorbed.some((a) => a.id === survivor.id)) {
      errors.push(
        `--survivor '${survivor.id}' must not also appear in --absorbed (target must not be one of sources)`,
      );
    }
  }

  if (
    errors.length > 0 ||
    survivor === undefined ||
    absorbed === undefined ||
    definition === undefined ||
    sourceDisposition === undefined
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    args: {
      survivor,
      absorbed,
      definition,
      sourceDisposition,
      showEvidence: args.includes("--show-evidence"),
    },
  };
}

/**
 * Build the `OperatorConsolidationInput` from the operator's parsed flags.
 *
 * SENTINEL SURFACE: this is the only place the CLI's values cross into the
 * service, and the mapping is strictly verbatim —
 * `survivor.id` → `survivorCapabilityId`, `absorbed[i].id` →
 * `absorbedCapabilityIds[i]` (same order, same length, same values).
 * `definition` is the operator-named definition resolved from the catalog by
 * exact id AND version; resolution is a LOOKUP of a name the operator gave,
 * never a choice the system makes.
 */
export function buildConsolidationInput(
  parsed: ParsedConsolidateArgs,
  definition: CapabilityDefinition,
): OperatorConsolidationInput {
  return {
    identity: {
      survivorCapabilityId: parsed.survivor.id,
      absorbedCapabilityIds: parsed.absorbed.map((a) => a.id),
      consolidateDefinition: definition,
      sourceDisposition: parsed.sourceDisposition,
    },
    evidenceIds: [`operator-cli:consolidate:${parsed.survivor.id}`],
  };
}

/**
 * Resolve an operator-named `<id@version>` against the catalog. Exact-version
 * match only — the CLI never substitutes a nearby version.
 */
export function resolveRef(
  catalog: CapabilityDefinitionLookup,
  ref: CapabilityRef,
): CapabilityDefinition | undefined {
  const def = catalog.get(ref.id);
  if (def === undefined) return undefined;
  if (def.version !== ref.version) return undefined;
  return def;
}

export interface CapabilityConsolidateCommandOptions {
  readonly service: CapabilityService | undefined;
  /** Catalog used ONLY to resolve the operator-named `--definition`. */
  readonly catalog: CapabilityDefinitionLookup | undefined;
  /**
   * Optional pair-layer evidence, rendered as CONTEXT under
   * `--show-evidence`. Never read as an input to any identity (ruling #544).
   */
  readonly pairEvidence?: readonly string[];
}

export async function capabilityConsolidateCommand(
  args: string[],
  opts: CapabilityConsolidateCommandOptions,
): Promise<number> {
  const parsed = parseConsolidateArgs(args);
  if (!parsed.ok) {
    for (const e of parsed.errors) console.error(`error: ${e}`);
    console.error(USAGE);
    return 2;
  }

  // Context only. Displayed after parsing precisely so it cannot be mistaken
  // for a source of the identities above.
  if (parsed.args.showEvidence) {
    const evidence = opts.pairEvidence ?? [];
    console.error("pair-layer evidence (context only — does not affect the request):");
    if (evidence.length === 0) console.error("  (none)");
    for (const e of evidence) console.error(`  ${e}`);
  }

  const service = opts.service;
  if (!service) {
    console.error("CapabilityService not supplied — CLI dispatcher contract violated.");
    return 5;
  }
  const catalog = opts.catalog;
  if (!catalog) {
    console.error("CapabilityCatalog not supplied — CLI dispatcher contract violated.");
    return 5;
  }

  const definition = resolveRef(catalog, parsed.args.definition);
  if (definition === undefined) {
    console.error(
      `--definition '${parsed.args.definition.id}@${parsed.args.definition.version}' not found in the capability catalog`,
    );
    return 4;
  }

  try {
    const result = await service.proposeConsolidation(
      buildConsolidationInput(parsed.args, definition),
    );
    console.log(
      JSON.stringify(
        {
          proposalId: result.proposalId,
          status: result.status,
          mutation: result.mutation,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    if (err instanceof CapabilityServiceNotImplementedError) {
      console.error(`proposeConsolidation() not implemented: ${err.message}`);
      return 5;
    }
    if (err instanceof CapabilityNotFoundError) {
      console.error(`Unknown capability: ${err.message}`);
      return 4;
    }
    console.error(
      `Consolidation proposal rejected: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 3;
  }
}

/** USAGE text — exported for help/listing. */
export const CAPABILITY_CONSOLIDATE_USAGE = USAGE;
