/**
 * claim-verification-tool.ts — `verify.claim`: bounded claim verification over
 * inline evidence excerpts (spec 2026-09-22-claim-verification-shadow-tool-design.md).
 *
 * Grants no execution authority: `authority` is always "none" (JEV-8, J1).
 * Evidence is data, never instructions. The model sees only
 * { verdict, engine, decisionId?, authority, warning? } — never `agree`, the
 * baseline's competing verdict, latency, or the experiment tally (§8.3).
 *
 * No I/O of its own: callers pass excerpts already in context (JEV-2).
 */
import type { ToolResult } from "./types.js";
import { loadConfig } from "../config/loader.js";
import { getSavedApiKey } from "../cli/helpers/api-keys.js";
import {
  DEFAULT_DECISION_CONFIG,
  EngineNotRegisteredError,
  JEV_KEY_PROVIDER_ID,
  JournalWriteError,
  MAX_CLAIM_CHARS,
  MAX_EVIDENCE_ITEMS,
  MAX_EXCERPT_CHARS,
  ProjectionRejectedError,
  classifyClaimLocally,
  createClaimVerificationProjector,
  createDecisionJournalStore,
  createDefaultRegistry,
  createExperimentProjectionStore,
  createProfileRegistry,
  loadProfileRegistry,
  registerJevEngine,
  resolveDecisionPaths,
  resolveLocalClaimThreshold,
  selectClaimVerification,
  type ClaimVerificationExperimentProjection,
  type ClaimVerificationInput,
  type ClaimVerificationProjection,
  type DecisionConfig,
  type DecisionJournalStore,
  type EngineRegistry,
  type ProfileRegistry,
  type RemoteSealedProjection,
} from "../decision/index.js";

export const CLAIM_VERIFY_TOOL = "verify.claim";

export type ClaimVerifyToolDeps = {
  cwd?: string;
  config?: DecisionConfig;
  registry?: EngineRegistry;
  journal?: DecisionJournalStore;
  experimentStoreDir?: string;
  /** Overrides credential-store lookup (tests). */
  apiKey?: string | null;
  /** Boundary seam for tests; default seals via projectClaimVerification. */
  project?: (input: ClaimVerificationInput) => RemoteSealedProjection<ClaimVerificationProjection>;
  /** Store seam for tests; default appends to the protected store. */
  saveExperiment?: (record: ClaimVerificationExperimentProjection) => Promise<void>;
};

function error(message: string): ToolResult {
  return { kind: "error", message, retryable: false };
}

/** Explicit bounds (§8.2): reject naming the limit, never silently clip. */
type ValidateResult =
  | { ok: true; input: ClaimVerificationInput }
  | { ok: false; result: ToolResult };

function validate(args: Record<string, unknown>): ValidateResult {
  const claim = args.claim;
  if (typeof claim !== "string" || claim.trim().length === 0) {
    return { ok: false, result: error("verify.claim requires a non-empty string claim") };
  }
  if (claim.length > MAX_CLAIM_CHARS) {
    return { ok: false, result: error(`claim exceeds ${MAX_CLAIM_CHARS} characters — shorten it`) };
  }
  const evidence = args.evidence;
  if (evidence === undefined) return { ok: true, input: { claim, evidence: [] } };
  if (!Array.isArray(evidence)) {
    return { ok: false, result: error("evidence must be an array of { source?, excerpt }") };
  }
  if (evidence.length > MAX_EVIDENCE_ITEMS) {
    return {
      ok: false,
      result: error(`evidence exceeds ${MAX_EVIDENCE_ITEMS} items — send the ${MAX_EVIDENCE_ITEMS} most relevant`),
    };
  }
  const excerpted: ClaimVerificationInput["evidence"] = [];
  for (const item of evidence) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, result: error("each evidence item must be { source?, excerpt }") };
    }
    const record = item as Record<string, unknown>;
    const excerpt = record.excerpt;
    if (typeof excerpt !== "string" || excerpt.trim().length === 0) {
      return { ok: false, result: error("each evidence item requires a non-empty excerpt string") };
    }
    if (excerpt.length > MAX_EXCERPT_CHARS) {
      return { ok: false, result: error(`evidence excerpt exceeds ${MAX_EXCERPT_CHARS} characters`) };
    }
    excerpted.push({
      ...(typeof record.source === "string" ? { source: record.source } : {}),
      excerpt,
    });
  }
  return { ok: true, input: { claim, evidence: excerpted } };
}

async function loadDecisionConfig(cwd: string): Promise<DecisionConfig> {
  const config = await loadConfig(cwd, { requireModel: false, suppressWarnings: true });
  return config.decision ?? DEFAULT_DECISION_CONFIG;
}

/** Wrap the journal so a failed append degrades into a warning (§14: never
 *  crash, never silent) WITHOUT losing the verdict: runClaimVerificationShadow
 *  appends before it returns, so catching afterwards would discard the result.
 *  `warnings` is the handler's live array — read it after the call. */
function withCapturedJournal(
  journal: DecisionJournalStore,
  warnings: string[],
): DecisionJournalStore {
  return {
    ...journal,
    append(record: Parameters<DecisionJournalStore["append"]>[0]) {
      try {
        journal.append(record);
      } catch (cause) {
        // JournalWriteError already carries the "Decision journal write failed:" prefix.
        warnings.push(
          cause instanceof JournalWriteError
            ? cause.message
            : `decision journal write failed: ${(cause as Error).message}`,
        );
      }
    },
  };
}

export async function handleClaimVerify(
  args: Record<string, unknown>,
  deps: ClaimVerifyToolDeps = {},
): Promise<ToolResult> {
  const validated = validate(args);
  if (!validated.ok) return validated.result;
  const input = validated.input;

  const cwd = deps.cwd ?? process.cwd();
  const config = deps.config ?? (await loadDecisionConfig(cwd));
  const mode = config.claimVerification?.mode ?? "baseline";
  const paths = resolveDecisionPaths(cwd);
  const journal = deps.journal ?? createDecisionJournalStore(paths.dir);
  const warnings: string[] = [];

  // Active local support-overlap threshold. An unreadable/invalid registry
  // degrades to the default (local availability), never a foreign threshold.
  let profiles: ProfileRegistry;
  try {
    profiles = loadProfileRegistry(paths.profiles);
  } catch {
    profiles = createProfileRegistry();
  }
  const claimThreshold = resolveLocalClaimThreshold(config, profiles);

  let registry = deps.registry;
  if (registry === undefined) {
    registry = createDefaultRegistry({ claimThreshold });
    if (config.remote?.jev?.enabled === true && config.claimVerification?.engine === "jev") {
      const key = deps.apiKey === undefined ? await getSavedApiKey(JEV_KEY_PROVIDER_ID) : deps.apiKey;
      // Register even without a key: the executor then fails "api key missing"
      // inside executeWithFallback, which degrades to local (§13).
      registerJevEngine(registry, { enabled: true, ...(key ? { apiKey: key } : {}) });
    }
  }

  const journalStore = withCapturedJournal(journal, warnings);

  if (mode === "baseline") {
    const selection = await selectClaimVerification(input, {
      config,
      registry,
      journal,
      mode,
      claimThreshold,
    });
    return {
      kind: "success",
      output: JSON.stringify({
        verdict: selection.verdict,
        engine: selection.engineId ?? "local",
        authority: "none",
      }),
    };
  }

  let selection: Awaited<ReturnType<typeof selectClaimVerification>>;
  try {
    selection = await selectClaimVerification(input, {
      config,
      registry,
      journal: journalStore,
      mode,
      claimThreshold,
      ...(deps.project !== undefined ? { project: deps.project } : {}),
    });
  } catch (cause) {
    if (cause instanceof ProjectionRejectedError || cause instanceof EngineNotRegisteredError) {
      // §12 / §13: fail closed for egress, remain useful locally. No
      // evaluation ⇒ no journaled records (sealing precedes engine resolution).
      const plain = createClaimVerificationProjector().project(input);
      const { verdict } = classifyClaimLocally(plain, { supportOverlapThreshold: claimThreshold });
      warnings.push(
        cause instanceof ProjectionRejectedError
          ? `remote verification skipped: ${cause.reason}`
          : `remote engine unavailable: ${cause.message}`,
      );
      return {
        kind: "success",
        output: JSON.stringify({ verdict, engine: "local", authority: "none", warning: warnings.join("; ") }),
      };
    }
    throw cause;
  }

  // Journal-write failures already landed in `warnings` via withCapturedJournal.

  const decisionId = selection.shadow?.records.find(
    (record) => record.engineId === selection.engineId && record.outcome.kind === "choice",
  )?.decisionId;

  const projection = selection.shadow?.projection;
  if (projection !== undefined) {
    const save =
      deps.saveExperiment ??
      (async (record: ClaimVerificationExperimentProjection) => {
        const store = createExperimentProjectionStore(deps.experimentStoreDir);
        if (!(await store.has(record.projectionHash))) await store.append(record);
      });
    try {
      await save({
        projectionHash: selection.shadow!.projectionHash,
        decision: "claim-verification",
        claim: projection.claim,
        evidence: projection.evidence.map((excerpt) => ({ excerpt })),
        createdAt: new Date().toISOString(),
      });
    } catch (cause) {
      warnings.push(`experiment projection write failed: ${(cause as Error).message}`);
    }
  }

  const payload: Record<string, unknown> = {
    verdict: selection.verdict,
    engine: selection.engineId ?? "local",
    ...(decisionId !== undefined ? { decisionId } : {}),
    authority: "none",
    ...(warnings.length > 0 ? { warning: warnings.join("; ") } : {}),
  };
  return { kind: "success", output: JSON.stringify(payload) };
}
