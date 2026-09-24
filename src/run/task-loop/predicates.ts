/**
 * Task loop module — extracted from run.ts
 *
 * Contains the main iteration loop that:
 * - Sends requests to the model provider
 * - Handles tool calls
 * - Runs verification checks
 * - Manages the repair loop
 */

import "node:os";
import "node:path";
import "node:crypto";
import type { ToolCall } from "../../providers/types.js";
import type { EventLog } from "../../events/event-log.js";
import "../../task-classifier.js";
import "../../run.js";
import "../../skills/dispatcher.js";
import "../../verifier/index.js";
import "../../verifier/enhanced-verifier.js";
import "../helpers.js";
import "../context-pressure.js";
import "../../agent/system-prompt.js";
import "../../session/index.js";
import "../progress-ledger.js";
import "../../observability/metrics-store.js";
import "../../observability/metric-registry.js";
import "../../observability/state-telemetry.js";
import "../../config/model-resolver.js";
import "../../runtime/tool-correlation.js";
import "../../runtime/cancellation-token.js";
import { TOOL_NAME_MAP } from "../../agents/tool-name-map.js";

export function emitAgent(
  log: EventLog,
  session: { sessionId: string },
  type: string,
  payload: object,
) {
  return log.append({ ...session, sessionId: `${session.sessionId}-agent`, actor: "agent", type, payload });
}

/**
 * §2 shed-tool contract: tell the model that the previously-shaded tool
 * is now admitted (additive-only re-scope). Mirrors buildScopeDenialMessage's
 * tone — short, factual, no instruction leakage.
 */

export function buildShedToolRetryMessage(toolCall: ToolCall): string {
  return `The tool "${toolCall.name}" was previously outside the active scope but has now been re-admitted for this call. Retry your invocation of "${toolCall.name}".`;
}

// Maps keywords that commonly appear in a model's self-reported summary to
// the tool-name prefix that would have to have been invoked for the claim
// to be real. This is intentionally conservative (few, high-confidence
// keyword -> tool mappings) — false positives here just cost a re-prompt,
// but false negatives let a hallucinated "I did X" claim slip through
// uncontested, which is the failure mode we're closing.

export const CLAIM_TOOL_MAP: Array<{ keywords: RegExp; toolPrefix: string; label: string }> = [
  { keywords: /\bschedul(e|ed|ing)\b|\brecurring\b|\bcron\b/i, toolPrefix: "schedule.", label: "scheduling a job" },
  { keywords: /\bsent?\b.*\bnotification\b|\bnotifi(ed|cation)\b/i, toolPrefix: "notification.", label: "sending a notification" },
  { keywords: /\bsent?\b.*\bfile\b/i, toolPrefix: "user.send_file", label: "sending a file to the user" },
  { keywords: /\badded\b.*\bregistrat|\bregister(ed|ing)\b/i, toolPrefix: "file.edit", label: "editing/registering files" },
  { keywords: /\bverified\b.*\bcompil|\bcompil(ed|ation)\b.*\bpass/i, toolPrefix: "shell.run", label: "verifying compilation" },
  { keywords: /\bset\s?up\b.*\bmonitor|\bmonitor(ing)?\b/i, toolPrefix: "monitor", label: "setting up monitoring" },
];

/** Tool-name override map derived from CLAIM_TOOL_MAP for claim-detection re-prompts. */
export const CLAIM_TOOL_NAMES: Record<string, string> = {
  ...Object.fromEntries(
    CLAIM_TOOL_MAP.map(item => [item.label, `alix_${item.toolPrefix.replace('.', '_')}`]),
  ),
  "a successful coordination run with worker outcomes": "alix_coordination_run",
};

export const NARRATING_THRESHOLD = 80;
export const SHORT_SYNTHESIS_THRESHOLD = 200;

export function isCompletionTool(toolName: string): boolean {
  return (TOOL_NAME_MAP[toolName] ?? toolName) === "done";
}

export function resolveToolExecutionName(
  toolName: string,
  selectedTools: ReadonlyArray<{ name: string; execName: string }>,
): string {
  return selectedTools.find((tool) => tool.name === toolName)?.execName
    ?? TOOL_NAME_MAP[toolName]
    ?? toolName;
}

/**
 * Extract a strict single-file mutation target from imperative operator text.
 * This intentionally recognizes only high-confidence create/delete forms;
 * broad coding tasks keep their normal multi-file scope behavior.
 */

export function explicitMutationTargets(task: string): string[] {
  const namedFile = task.match(
    /\b(?:create|delete|remove)(?:\s+and\s+commit)?\s+(?:a\s+)?file\s+named\s*:?\s*(?:`([^`]+)`|"([^"]+)"|([^\n]+?))(?=\s+containing\b|\s*$)/im,
  );
  const directCreate = task.match(
    /\bcreate\s+(?:`((?:\/|\.\.?\/)[^`]+)`|"((?:\/|\.\.?\/)[^"]+)"|'((?:\/|\.\.?\/)[^']+)'|((?:\/|\.\.?\/)[^\s"'`]+))\s+containing\b/i,
  );
  const target = namedFile?.slice(1).find((value) => value !== undefined)
    ?? directCreate?.slice(1).find((value) => value !== undefined);
  if (!target) return [];
  return [target.trim().replace(/[.,:]$/, '')];
}

export function hasExecutedActionTool(usedTools: ReadonlySet<string>): boolean {
  return [...usedTools].some((name) => !isCompletionTool(name));
}

/**
 * Compares a model's free-text completion summary against the tools it
 * actually invoked this session. Returns a human-readable list of claims
 * that have no corresponding tool call — i.e. things the model says it did
 * but the event log shows it never actually did.
 */

export function findUnsubstantiatedClaims(text: string, usedTools: Set<string>): string[] {
  const unsubstantiated: string[] = [];
  for (const { keywords, toolPrefix, label } of CLAIM_TOOL_MAP) {
    if (keywords.test(text)) {
      const wasCalled = [...usedTools].some((t) => t.startsWith(toolPrefix));
      if (!wasCalled) {
        unsubstantiated.push(label);
      }
    }
  }
  return unsubstantiated;
}

export type SuccessfulToolEvidence = {
  name: string;
  args: Record<string, unknown>;
  ordinal: number;
};

export const MUTATION_TOOL_NAMES = new Set(["file.create", "file.write", "file.delete", "patch.apply"]);
export const VERIFICATION_COMMAND_RE = /(?:^|\s)(?:pnpm|npm|yarn|bun)\s+(?:test|run\s+(?:test|build|lint|check|typecheck)|build|lint)|\b(?:pytest|vitest|jest|mocha|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|tsc|eslint|git\s+diff\s+--check)\b/i;
export const VERIFICATION_EVIDENCE_GAP = "a successful verification command after the mutation";
export const COORDINATION_EVIDENCE_GAP = "a successful coordination run with worker outcomes";
/** Exec name of the coordination tool (provider-facing `alix_coordination_run`). */
export const COORDINATION_RUN_TOOL_NAME = "coordination.run";

/**
 * Bare continuation cues — a turn whose entire message is one of these
 * carries no objective of its own ("continue", "proceed", ...). Anchored
 * so contentful turns ("continue the report", "finalize the migration")
 * never match. "done"/"finish" are deliberately excluded: they are stop
 * signals, not continuations.
 */

export const CONTINUATION_RE = /^(?:continue|next(?:\s+step)?|proceed|go\s+on|keep\s+going|carry\s+on|finalize)\.?$/i;

/** True when the turn text is a bare continuation cue with no objective. */

export function isContinuationMessage(text: string): boolean {
  return CONTINUATION_RE.test(text.trim());
}

export function objectiveEvidenceRequirements(task: string, taskType = "unknown"): { mutation: boolean; verification: boolean; coordination: boolean } {
  const readOnlyInstruction = /\b(?:do not|don't|without)\s+(?:modify|edit|change|write|create|delete|remove)\b/i.test(task);
  const mutationTaskType = /^(?:bugfix|feature|refactor|docs)$/.test(taskType);
  const explicitMutationVerb = /\b(?:fix|implement|refactor|update|change|apply|create|edit|modify|delete|remove|build|scaffold|generate)\b/i.test(task);
  const mutation = !readOnlyInstruction && (
    (mutationTaskType && explicitMutationVerb) ||
    /\bmake\b.{0,60}\b(?:improvement|change|edit|fix)\b/i.test(task) ||
    /\b(?:create|edit|modify|update|delete|remove|apply|implement|fix|change|build|scaffold|generate)\b.{0,100}\b(?:file|code|repository|repo|readme|source|implementation|config|tests?)\b/i.test(task) ||
    /\b(?:file|code|repository|repo|readme|source|implementation|config|tests?)\b.{0,100}\b(?:create|edit|modify|update|delete|remove|apply|implement|fix|change|build|scaffold|generate)\b/i.test(task)
  );
  const verification = mutation && /\b(?:run|perform)\b.{0,60}\b(?:verification|tests?|checks?|build|lint|typecheck)\b|\bverify\b.{0,80}\b(?:change|edit|implementation|file|code)\b/i.test(task);
  const coordinationSubject = String.raw`(?:coordination|coordinated\s+(?:agents?|workers?)|multi[- ](?:agent|worker)|parallel\s+(?:agents?|workers?)|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]workers?)`;
  const coordinationAction = String.raw`(?:run|launch|spawn|start|use|delegate|coordinate|create|request)`;
  const coordination = new RegExp(
    String.raw`\b${coordinationAction}\b.{0,100}\b${coordinationSubject}\b|\b${coordinationSubject}\b.{0,100}\b${coordinationAction}\b`,
    "i",
  ).test(task);
  return { mutation, verification, coordination };
}

export function objectiveEvidenceGaps(
  task: string,
  taskType: string,
  evidence: ReadonlyArray<SuccessfulToolEvidence>,
  opts?: { coordinationRunFailed?: boolean },
): string[] {
  const required = objectiveEvidenceRequirements(task, taskType);
  const mutationOrdinal = evidence
    .filter((item) => MUTATION_TOOL_NAMES.has(item.name))
    .reduce((latest, item) => Math.max(latest, item.ordinal), -1);
  const verifiedAfterMutation = evidence.some((item) =>
    item.ordinal > mutationOrdinal &&
    item.name === "shell.run" &&
    typeof item.args.command === "string" &&
    VERIFICATION_COMMAND_RE.test(item.args.command)
  );
  const gaps: string[] = [];
  if (required.mutation && mutationOrdinal < 0) gaps.push("a successful workspace mutation");
  if (required.verification && (mutationOrdinal < 0 || !verifiedAfterMutation)) gaps.push(VERIFICATION_EVIDENCE_GAP);
  // A failed last-attempt coordination.run blocks completion regardless of
  // whether the objective text matches the coordination regex: the model
  // volunteered coordination, it failed, so the success evidence is missing
  // until a later attempt clears the flag (durability contract).
  if (
    opts?.coordinationRunFailed ||
    (required.coordination && !evidence.some((item) => item.name === COORDINATION_RUN_TOOL_NAME))
  ) {
    gaps.push(COORDINATION_EVIDENCE_GAP);
  }
  return gaps;
}

/**
 * Builds the bounded re-prompt for an untrustworthy prose completion claim
 * (Path A of the task loop). Escalates with each attempt: evidence-gap
 * instruction first, then client-error-echo correction, then hard tool
 * demands; the soft-claim nudge only applies when nothing else is wrong.
 */
export function buildUnconfirmedDonePrompt(input: {
  unsubstantiated: string[];
  evidenceGaps: string[];
  errorEchoDone: boolean;
  attempt: number;
}): string {
  const { unsubstantiated, evidenceGaps, errorEchoDone, attempt } = input;
  const missingToolLines = [...unsubstantiated, ...evidenceGaps]
    .map((c) => `  - ${CLAIM_TOOL_NAMES[c] ?? c}`)
    .join("\n");

  if (evidenceGaps.length > 0) {
    return (
      `The current task is not complete because the event log lacks: ${evidenceGaps.join(" and ")}. ` +
      `Perform those actions now. Do not call done or describe the task as complete until the tools succeed.`
    );
  }
  if (errorEchoDone && unsubstantiated.length === 0) {
    return (
      `Your last tool call returned an HTTP/client error, and you declared the task done without writing or verifying the deliverable. ` +
      `A tool error is not a completed outcome. Retry with corrected parameters/headers, complete the actual work, ` +
      `and confirm the deliverable exists before saying done.`
    );
  }
  if (attempt >= 2) {
    return (
      `You keep saying you are done without having actually called the required tools. ` +
      `Call these tools now:\n${missingToolLines}\n\n` +
      `Do NOT call done until every one of these tools has returned a result.`
    );
  }
  if (attempt >= 1) {
    return (
      `Your summary claims you completed the following, but no matching tool call was made:\n${missingToolLines}\n\n` +
      `Call these tools now using their \`alix_\` names, or call \`done\` only if you genuinely cannot proceed.`
    );
  }
  return (
    `Your summary claims you did the following, but no matching tool call was made: ${unsubstantiated.join(", ")}. ` +
    `Do not describe an action as complete unless you actually invoked the corresponding tool. ` +
    `Either call the remaining tools now, or call the \`done\` tool explicitly once everything is genuinely finished.`
  );
}

export function missingEvidenceSummary(gaps: string[], text: string): string {
  const detail = gaps.join(" and ");
  const lastResponse = text.trim();
  return `Task could not be verified as complete: missing ${detail}.` +
    (lastResponse ? ` Last model response: ${lastResponse}` : "");
}

/**
 * End-of-iteration synthesis re-prompt: nudges a model that ran tools but
 * produced only a short opening line. Detects the file.*-only rut and
 * suggests broader tool categories; otherwise restates the completion rule.
 */
export function buildSynthesisReprompt(usedTools: ReadonlySet<string>): string {
  const usedList = [...usedTools];
  const stuckOn = usedList.filter((t) => t.startsWith("file."));
  if (stuckOn.length === usedList.length && usedList.length > 0 && usedList.length < 5) {
    return (
      "You have only used file search tools so far (" + usedList.join(", ") + "). " +
      "The user's request may require other tools. Available tool categories include: " +
      "shell.run, notification.send, user.send_file, monitor, findings.report, ask_user. " +
      "Try using a different tool to make progress. If you truly have nothing left to do, " +
      "write a final summary and signal that the task is done."
    );
  }
  return (
    "Review the original objective against the tool results. If required work is still missing, call the appropriate tool now. " +
    "Only when the objective is genuinely complete, write a concise final summary and signal that the task is done."
  );
}

/**
 * A "done" claim that merely echoes a failed tool result (HTTP 4xx/5xx or a
 * command error) is not a completed outcome. `lastToolResultShowsClientError`
 * scans backwards for the most recent `<tool_result>` block and reports
 * whether it looks like a client/server failure. Combined with a check that
 * nothing was written (and the reply claims no artifact), the done-claim trust
 * gate rejects it so the model is pushed to retry/verify instead of ending on
 * an error echo.
 */

export const ARTIFACT_WRITE_RE =
  /\b(?:wrote|writes?|created|saved?|generated|produced|output to|written to)\b|\.md\b/i;

export function toolResultFailureBody(content: string): string | undefined {
  const resultBody = content.replace(/^<tool_result[^>]*>\s*/i, "").trimStart();
  return /^(?:Error|Access denied):\s*/i.test(resultBody) || /^HTTP\/[12]\s+[45]\d\d\b/i.test(resultBody)
    ? resultBody
    : undefined;
}

export function lastToolResultShowsClientError(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const content = typeof m.content === "string" ? m.content : "";
    if (!content.includes("<tool_result")) continue;
    return toolResultFailureBody(content) !== undefined;
  }
  return false;
}

/** Return a concise, user-facing description of the latest failed tool result. */

export function latestToolFailure(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user" || typeof message.content !== "string") continue;
    if (!message.content.includes("<tool_result")) continue;
    const resultBody = toolResultFailureBody(message.content);
    if (!resultBody) continue;
    const plain = resultBody
      .replace(/<\/tool_result>\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(?:Error|Access denied):\s*/i, "");
    if (plain) return plain.slice(0, 500);
  }
  return undefined;
}

/** Preserve durable mutation evidence when a later retry fails. */

export function durableCompletionSummary(
  text: string,
  changedFiles: ReadonlySet<string>,
  latestFailure?: string,
): string {
  const summary = text.trim();
  if (changedFiles.size === 0 || !latestFailure || !/^(?:Error|Access denied):\s*/i.test(summary)) {
    return summary;
  }
  const files = [...changedFiles].sort().join(", ");
  return `Changed ${files}. A later tool attempt failed: ${latestFailure}`;
}

/** Whether a reply or the session claims a written deliverable exists. */

export function claimsArtifactWritten(
  text: string,
  changedFiles: ReadonlySet<string> | number,
): boolean {
  const changed = typeof changedFiles === "number" ? changedFiles : changedFiles.size;
  return changed > 0 || ARTIFACT_WRITE_RE.test(text);
}

export function extractErrors(output: string): string[] {
  const errors: string[] = [];
  const patterns = [
/TypeError:\s*(.+)/gi,
/Error:\s*(.+)/gi,
/SyntaxError:\s*(.+)/gi,
/ReferenceError:\s*(.+)/gi,
/AssertionError:\s*(.+)/gi,
/(?:FAIL|FAILURE|ERROR):\s*(.+)/gi,
/Failed:\s*(.+)/gi,
  ];

  for (const pattern of patterns) {
let match;
while ((match = pattern.exec(output)) !== null) {
  errors.push(match[1]?.trim() ?? match[0]);
}
  }

  return [...new Set(errors)];
}
