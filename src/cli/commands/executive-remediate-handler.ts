/**
 * P10.9.2b — Remediation Wizard CLI handler.
 *
 * CLI entry point for `alix executive remediate <proposalId>`.
 * Supports interactive and non-interactive (flag-based) modes, dry-run,
 * JSON output, and payload file validation.
 *
 * Side-effect boundary: creates child proposals in ProposalStore on save.
 * --dry-run skips the save step.
 *
 * @module
 */

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { nextProposalId } from "../../adaptation/recommendation-to-proposal.js";
import {
  createDefaultRegistry,
  validateRemediationParent,
  validateSpecification,
  validatePayload,
} from "../../executive/executive-remediate.js";
import type { AdaptationProposal } from "../../adaptation/adaptation-types.js";
import type {
  RemediationSpec,
  RemediationProvider,
} from "../../executive/executive-remediate.js";

/**
 * Handle `alix executive remediate <proposalId> [flags]`.
 *
 * Two modes:
 * - **Flag mode** (`--action`, `--target`, `--reason` present):
 *   parse all flags, validate, build draft, optionally save.
 * - **Interactive mode** (no flags): use provider.promptSpecification().
 *   In JSON mode, interactive mode is skipped with an error.
 *
 * @param args - CLI arguments (proposalId followed by optional flags)
 */
export async function handleRemediateCommand(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId || proposalId.startsWith("--")) {
    console.error(
      "Usage: alix executive remediate <proposalId> [--action ...]",
    );
    process.exit(1);
  }

  const useJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const isFlagMode =
    args.includes("--action") ||
    args.includes("--target") ||
    args.includes("--reason");

  // Load proposal
  const cwd = process.cwd();
  const proposalStore = new ProposalStore(
    join(cwd, ".alix", "adaptation", "proposals"),
  );
  let parent: AdaptationProposal | null = null;
  try {
    parent = await proposalStore.load(proposalId);
  } catch {
    // null — handled by validateRemediationParent
  }

  // Validate parent proposal
  const validation = validateRemediationParent(parent ?? undefined);
  if (!validation.valid) {
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: false,
          error: validation.issue.code,
          message: validation.issue.message,
        }),
      );
      return;
    }
    console.error(`${validation.issue.code}: ${validation.issue.message}`);
    process.exit(1);
  }

  // Find provider
  const reg = createDefaultRegistry();
  let provider: RemediationProvider;
  try {
    provider = reg.find(parent!);
  } catch (e: any) {
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: false,
          error: "NO_PROVIDER",
          message: e.message,
        }),
      );
      return;
    }
    console.error(e.message);
    process.exit(1);
  }

  // Collect specification
  let spec: RemediationSpec;
  if (isFlagMode) {
    const parsed = parseFlagSpec(args, useJson, provider);
    if (!parsed) {
      // Error already printed by parseFlagSpec.
      if (!useJson) process.exit(1);
      return;
    }
    spec = parsed;
  } else {
    // Interactive mode
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: false,
          error: "INTERACTIVE_REQUIRED",
          message:
            "Cannot use --json without --action, --target, and --reason flags",
        }),
      );
      return;
    }

    if (!provider.promptSpecification) {
      console.error("Provider does not support interactive specification.");
      process.exit(1);
    }
    const result = await provider.promptSpecification(parent!);
    if (!result) {
      console.log("Cancelled.");
      return;
    }
    spec = result;
  }

  // Build draft
  const draft = provider.buildDraft(parent!, spec, {
    actor: process.env.USER ?? "operator",
    mode: isFlagMode ? "noninteractive" : "interactive",
  });

  // Assign identity
  const child: AdaptationProposal = {
    ...draft,
    id: nextProposalId(),
    createdAt: new Date().toISOString(),
    status: "pending",
    evidenceFingerprints: [],
  } as AdaptationProposal;

  // Dry-run: print preview and exit without saving
  if (dryRun) {
    const targetRecord = child.target as Record<string, string>;
    const targetValue =
      targetRecord.id ??
      targetRecord.recommendationId ??
      targetRecord.title ??
      targetRecord.capability ??
      targetRecord.sourceProposalId ??
      "";
    console.log("Child proposal");
    console.log("───────────────────────────────────────");
    console.log(`  Action:        ${child.action}`);
    console.log(`  Target:        ${child.target.kind}:${targetValue}`);
    console.log(`  Status:        ${child.status}`);
    console.log(`  Readiness:     needs_approval`);
    console.log("");
    console.log("Nothing written.");
    return;
  }

  // Save child proposal
  await proposalStore.save(child);

  // Print result
  if (useJson) {
    console.log(
      JSON.stringify({
        ok: true,
        parentProposalId: proposalId,
        childProposalId: child.id,
        childAction: child.action,
        childReadiness: "needs_approval",
      }),
    );
  } else {
    console.log(`✓ Created child proposal ${child.id}`);
    console.log(`  alix adaptation show ${child.id}`);
    console.log(`  alix adaptation approve ${child.id}`);
    console.log(`  alix adaptation apply ${child.id}`);
  }
}

// ---------------------------------------------------------------------------
// Flag parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate specification from CLI flags.
 *
 * Parses --action, --target, --reason, and optional --payload.
 * Validates spec against the provider and checks payload reserved keys.
 *
 * On error: prints the error (JSON or console.error) and returns null.
 * On success: returns the RemediationSpec.
 */
function parseFlagSpec(
  args: string[],
  useJson: boolean,
  provider: RemediationProvider,
): RemediationSpec | null {
  const actionIdx = args.indexOf("--action");
  const targetIdx = args.indexOf("--target");
  const reasonIdx = args.indexOf("--reason");

  const actionName =
    actionIdx >= 0 && actionIdx + 1 < args.length
      ? args[actionIdx + 1]
      : undefined;
  const targetId =
    targetIdx >= 0 && targetIdx + 1 < args.length
      ? args[targetIdx + 1]
      : undefined;
  const reason =
    reasonIdx >= 0 && reasonIdx + 1 < args.length
      ? args[reasonIdx + 1]
      : undefined;

  if (!actionName) {
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: false,
          error: "MISSING_FLAG",
          message: "--action is required",
        }),
      );
    } else {
      console.error("--action is required");
    }
    return null;
  }

  let additionalPayload: Record<string, unknown> | undefined;
  const payloadIdx = args.indexOf("--payload");
  if (payloadIdx >= 0 && payloadIdx + 1 < args.length) {
    const payloadPath = args[payloadIdx + 1];
    if (!existsSync(payloadPath)) {
      if (useJson) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "PAYLOAD_NOT_FOUND",
            message: `Payload file not found: ${payloadPath}`,
          }),
        );
        return null;
      }
      console.error(`Payload file not found: ${payloadPath}`);
      return null;
    }
    try {
      additionalPayload = JSON.parse(readFileSync(payloadPath, "utf-8"));
    } catch (e: any) {
      if (useJson) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "PAYLOAD_PARSE_ERROR",
            message: `Failed to parse payload: ${e.message}`,
          }),
        );
        return null;
      }
      console.error(`Failed to parse payload: ${e.message}`);
      return null;
    }
  }

  const spec: RemediationSpec = {
    actionName,
    targetId: targetId ?? "",
    reason: reason ?? "",
    additionalPayload,
  };

  // Validate spec against provider
  const specErr = validateSpecification(spec, provider);
  if (!specErr.valid) {
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: false,
          error: specErr.issue.code,
          message: specErr.issue.message,
          field: specErr.issue.field,
        }),
      );
      return null;
    }
    console.error(`${specErr.issue.code}: ${specErr.issue.message}`);
    return null;
  }

  // Validate payload reserved keys
  if (additionalPayload) {
    const payloadErr = validatePayload(additionalPayload);
    if (!payloadErr.valid) {
      if (useJson) {
        console.log(
          JSON.stringify({
            ok: false,
            error: payloadErr.issue.code,
            message: payloadErr.issue.message,
            field: payloadErr.issue.field,
          }),
        );
        return null;
      }
      console.error(`${payloadErr.issue.code}: ${payloadErr.issue.message}`);
      return null;
    }
  }

  return spec;
}
