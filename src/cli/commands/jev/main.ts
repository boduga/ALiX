/**
 * main.ts — `alix jev` dispatcher.
 *
 * Operator surface for the decision subsystem (J4/J5). Everything here is
 * read-only except `profile promote` / `profile rollback`, and promotion
 * requires an explicit `--approve` because it changes decision behavior.
 *
 * Usage:
 *   alix jev status
 *   alix jev label --decision-id <id> --decision <d> --label correct|incorrect|unknown [--error-type fp|fn|other] [--note text]
 *   alix jev dataset [--decision <d>] [--engine <e>] [--out <file>] [--json]
 *   alix jev reliability --decision <d> --engine <e> [--bins N] [--json]
 *   alix jev profile list [--json]
 *   alix jev profile derive --decision <d> --engine <e> --target-accuracy <0..1> --id <new-id> --dataset-id <id>
 *   alix jev profile promote <id> --approve [--approved-by <who>]
 *   alix jev profile rollback --decision <d> --engine <e> [--risk low|medium|high]
 *   alix jev fixture build --decision <d>
 *   alix jev fixture list
 *   alix jev replay --engine local|jev [--compare <engine>] [--gate] [--decision <d>]
 */

import { parseKeyValueArgs } from "../../helpers/parse-args.js";
import { DEFAULT_DECISION_CONFIG } from "../../../decision/index.js";
import {
  JevOperatorError,
  buildStatus,
  deriveProfile,
  exportDataset,
  labelDecision,
  listProfiles,
  loadAlixConfig,
  parseDecisionType,
  promoteProfileById,
  reliabilityReport,
  resolveJevPaths,
  rollbackProfiles,
  shippedProfiles,
  type JevPaths,
} from "./ops.js";
import { buildFixtures, loadFixtures, runReplay } from "./replay-ops.js";
import { renderDataset, renderProfiles, renderReliability, renderReplay, renderStatus } from "./render.js";
import type { LabelErrorType, OutcomeLabel, RiskContext } from "../../../decision/index.js";

const LABEL_VALUES: readonly OutcomeLabel[] = ["correct", "incorrect", "unknown"];
const ERROR_TYPES: readonly LabelErrorType[] = ["false_positive", "false_negative", "other"];
const RISK_VALUES: readonly RiskContext[] = ["low", "medium", "high"];

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function requireString(value: string | boolean | undefined, flag: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new JevOperatorError(`--${flag} is required`);
  }
  return value;
}

function optionalDecision(value: string | boolean | undefined): ReturnType<typeof parseDecisionType> | undefined {
  return typeof value === "string" && value.length > 0 ? parseDecisionType(value) : undefined;
}

/** Dispatch only — throws JevOperatorError on usage errors (testable). */
export async function dispatchJevCommand(args: string[]): Promise<void> {
  const paths = resolveJevPaths(process.cwd());
  const subcommand = args[0] ?? "status";
  const rest = args.slice(1);
  const json = rest.includes("--json");

  switch (subcommand) {
    case "status": {
      const status = await buildStatus(paths);
      out(json ? JSON.stringify(status, null, 2) : renderStatus(status));
      return;
    }

    case "label": {
      const flags = parseKeyValueArgs(
        rest,
        ["decision-id", "decision", "label", "error-type", "note"],
        ["json"],
      );
      const decisionId = requireString(flags["decision-id"], "decision-id");
      const decision = parseDecisionType(requireString(flags.decision, "decision"));
      const rawLabel = requireString(flags.label, "label");
      if (!(LABEL_VALUES as readonly string[]).includes(rawLabel)) {
        throw new JevOperatorError(`--label must be one of ${LABEL_VALUES.join(", ")}`);
      }
      const rawErrorType = typeof flags["error-type"] === "string" ? flags["error-type"] : undefined;
      if (rawErrorType !== undefined && !(ERROR_TYPES as readonly string[]).includes(rawErrorType)) {
        throw new JevOperatorError(`--error-type must be one of ${ERROR_TYPES.join(", ")}`);
      }
      const result = await labelDecision(paths, {
        decisionId,
        decision,
        label: rawLabel as OutcomeLabel,
        ...(rawErrorType !== undefined ? { errorType: rawErrorType as LabelErrorType } : {}),
        ...(typeof flags.note === "string" ? { note: flags.note } : {}),
      });
      out(
        json
          ? JSON.stringify(result, null, 2)
          : `Labeled ${result.decisionId}${result.knownDecisionId ? "" : " (warning: not found in the journal)"}`,
      );
      return;
    }

    case "dataset": {
      const flags = parseKeyValueArgs(rest, ["decision", "engine", "out"], ["json"]);
      const dataset = await exportDataset(paths, {
        ...(optionalDecision(flags.decision) !== undefined ? { decision: optionalDecision(flags.decision)! } : {}),
        ...(typeof flags.engine === "string" ? { engineId: flags.engine } : {}),
        ...(typeof flags.out === "string" ? { outPath: flags.out } : {}),
      });
      out(json ? JSON.stringify(dataset, null, 2) : renderDataset(dataset));
      return;
    }

    case "reliability": {
      const flags = parseKeyValueArgs(rest, ["decision", "engine", "bins"], ["json"]);
      const bins = typeof flags.bins === "string" ? Number.parseInt(flags.bins, 10) : undefined;
      const report = await reliabilityReport(paths, {
        decision: parseDecisionType(requireString(flags.decision, "decision")),
        engineId: requireString(flags.engine, "engine"),
        ...(bins !== undefined && Number.isInteger(bins) ? { bins } : {}),
      });
      out(json ? JSON.stringify(report, null, 2) : renderReliability(report));
      return;
    }

    case "profile":
      await runProfile(paths, rest, json);
      return;

    case "fixture":
      await runFixture(paths, rest, json);
      return;

    case "replay": {
      const flags = parseKeyValueArgs(rest, ["engine", "compare", "decision", "timeout-ms"], ["gate", "json"]);
      const alixConfig = await loadAlixConfig();
      const decision = optionalDecision(flags.decision);
      const report = await runReplay(alixConfig.decision ?? DEFAULT_DECISION_CONFIG, paths, {
        engineId: typeof flags.engine === "string" ? flags.engine : "local",
        ...(typeof flags.compare === "string" ? { compareEngineId: flags.compare } : {}),
        ...(flags.gate === true ? { gate: true } : {}),
        ...(decision !== undefined ? { decision } : {}),
        ...(typeof flags["timeout-ms"] === "string" ? { timeoutMs: Number.parseInt(flags["timeout-ms"], 10) } : {}),
      });
      out(json ? JSON.stringify(report, null, 2) : renderReplay(report));
      return;
    }

    default:
      throw new JevOperatorError(
        `unknown subcommand: ${subcommand} (expected status, label, dataset, reliability, profile, fixture, replay)`,
      );
  }
}

async function runProfile(paths: JevPaths, rest: string[], json: boolean): Promise<void> {
  const action = rest[0] ?? "list";
  const args = rest.slice(1);

  switch (action) {
    case "list": {
      const profiles = listProfiles(paths);
      const shipped = shippedProfiles("context-relevance");
      out(json ? JSON.stringify({ profiles, shipped }, null, 2) : renderProfiles(profiles, shipped));
      return;
    }

    case "derive": {
      const flags = parseKeyValueArgs(
        args,
        ["decision", "engine", "target-accuracy", "id", "dataset-id", "risk"],
        [],
      );
      const target = Number.parseFloat(requireString(flags["target-accuracy"], "target-accuracy"));
      if (!Number.isFinite(target) || target <= 0 || target > 1) {
        throw new JevOperatorError("--target-accuracy must be a number in (0, 1]");
      }
      const rawRisk = typeof flags.risk === "string" ? flags.risk : undefined;
      if (rawRisk !== undefined && !(RISK_VALUES as readonly string[]).includes(rawRisk)) {
        throw new JevOperatorError(`--risk must be one of ${RISK_VALUES.join(", ")}`);
      }
      const derived = await deriveProfile(paths, {
        decision: parseDecisionType(requireString(flags.decision, "decision")),
        engineId: requireString(flags.engine, "engine"),
        targetAccuracy: target,
        id: requireString(flags.id, "id"),
        datasetId: requireString(flags["dataset-id"], "dataset-id"),
        ...(rawRisk !== undefined ? { risk: rawRisk as RiskContext } : {}),
      });
      out(
        json
          ? JSON.stringify(derived, null, 2)
          : `Derived ${derived.id} (shadow) threshold=${derived.threshold.toFixed(2)}\n${renderProfiles([derived])}`,
      );
      return;
    }

    case "promote": {
      const flags = parseKeyValueArgs(args, ["approved-by"], ["approve", "json"]);
      const id = args.find((arg) => !arg.startsWith("--"));
      if (id === undefined) throw new JevOperatorError("profile promote requires a profile id");
      const profiles = promoteProfileById(paths, id, {
        approved: flags.approve === true,
        ...(typeof flags["approved-by"] === "string" ? { approvedBy: flags["approved-by"] } : {}),
      });
      out(json ? JSON.stringify(profiles, null, 2) : `Promoted ${id}\n${renderProfiles(profiles)}`);
      return;
    }

    case "rollback": {
      const flags = parseKeyValueArgs(args, ["decision", "engine", "risk"], ["json"]);
      const rawRisk = typeof flags.risk === "string" ? flags.risk : undefined;
      if (rawRisk !== undefined && !(RISK_VALUES as readonly string[]).includes(rawRisk)) {
        throw new JevOperatorError(`--risk must be one of ${RISK_VALUES.join(", ")}`);
      }
      const profiles = rollbackProfiles(paths, {
        decision: parseDecisionType(requireString(flags.decision, "decision")),
        engineId: requireString(flags.engine, "engine"),
        ...(rawRisk !== undefined ? { risk: rawRisk as RiskContext } : {}),
      });
      out(json ? JSON.stringify(profiles, null, 2) : `Rolled back\n${renderProfiles(profiles)}`);
      return;
    }

    default:
      throw new JevOperatorError(`unknown profile action: ${action} (expected list, derive, promote, rollback)`);
  }
}

async function runFixture(paths: JevPaths, rest: string[], json: boolean): Promise<void> {
  const action = rest[0] ?? "list";
  const args = rest.slice(1);

  switch (action) {
    case "list": {
      const fixtures = loadFixtures(paths);
      out(
        json
          ? JSON.stringify(fixtures, null, 2)
          : fixtures.length === 0
            ? "No fixtures."
            : fixtures.map((fixture) => `${fixture.id}  ${fixture.decision}`).join("\n"),
      );
      return;
    }

    case "build": {
      const flags = parseKeyValueArgs(args, ["decision"], ["json"]);
      const decision = parseDecisionType(requireString(flags.decision, "decision"));
      const fixtures = buildFixtures(await loadAlixConfig(), paths, decision);
      out(
        json
          ? JSON.stringify(fixtures, null, 2)
          : `Built ${fixtures.length} fixture(s) for ${decision} in ${paths.fixtures}`,
      );
      return;
    }

    default:
      throw new JevOperatorError(`unknown fixture action: ${action} (expected list, build)`);
  }
}

/**
 * CLI entry point. Operator errors print a single line and exit 1; anything
 * else is a bug and propagates.
 */
export async function handleJevCommand(args: string[]): Promise<void> {
  try {
    await dispatchJevCommand(args);
  } catch (error) {
    if (error instanceof JevOperatorError) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}
