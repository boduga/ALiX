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
import { ALIX_BUILTIN_EXECUTORS, type AlixBuiltinToolName } from "../../agents/tool-manifest.js";
import {
  builtinCandidateId,
  builtinNameOf,
  type FrozenToolCandidate,
  type LocalToolBinding,
} from "../../decision/tool-selection-candidates.js";

import {
  buildSelectionObservation as buildNeutralSelectionObservation,
  type SelectionObservation as NeutralSelectionObservation,
  type SelectionRanking,
  type SurfaceGap,
} from "../../observability/tool-selection-observation.js";

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

/**
 * A claim entry declares:
 * - `keywords` — a first-person action naming its object ("I scheduled a
 *   nightly job"). Bare vocabulary must not match: coordination prose
 *   ("Scheduling: workers ran in parallel"), denials, and the operator's own
 *   reporting vocabulary ("report the registered artifact") are not claims,
 *   and flagging them traps the turn in a re-prompt loop.
 * - `excusedBy` — executor prefixes that make the claim substantiated.
 * - `tool` — the model-facing name to record the claim against, when a tool
 *   for it exists in this build. Deriving this by string-munging the prefix
 *   produced phantom names (`alix_schedule_`, `alix_file_edit`), so it is
 *   explicit here and pinned by `taxonomy-sentinel.vitest.ts`.
 */
export const CLAIM_TOOL_MAP: Array<{
  keywords: RegExp;
  excusedBy: string[];
  tool?: AlixBuiltinToolName;
  label: string;
}> = [
  {
    // A scheduling *claim* is a first-person action naming a job-like object:
    // "I scheduled a nightly job". Bare scheduling vocabulary must not count —
    // "Scheduling: workers 1-3 ran in parallel" describes the coordination
    // scheduler, and "no scheduling was requested" denies the claim. Flagging
    // either traps the turn: the re-prompt names the tool, the model explains
    // the flag, and the explanation re-arms the detector until the bounded
    // attempts run out and the turn ends completed_unverified.
    //
    // Deliberately first-person only: third-person subjects ("The coordinator
    // scheduled four workers", "the scheduler dispatched tasks") are how
    // coordination prose reads, and matching them re-arms the same trap. The
    // apostrophe accepts both ASCII and typographic forms, and the object list
    // covers non-"job" scheduling targets (a meeting, a review, a report).
    keywords: new RegExp(
      String.raw`\bI(?:['’]ve|['’]ll| have| had| will)?\s+(?:just\s+|already\s+)?` +
      String.raw`(?:schedul\w*|set\s*up|creat\w*|add\w*|propos\w*|enabl\w*|configur\w*)\b` +
      String.raw`[^.!?]{0,80}?\b(?:job|task|schedule|workflow|reminder|check|recurring|cron|nightly|daily|weekly|periodic|meeting|review|report|digest|export|publish|notification)\b`,
      "i",
    ),
    excusedBy: ["schedule.propose"],
    tool: "alix_schedule_propose",
    label: "scheduling a job",
  },
  {
    // No notification tool exists in this build, so the only remedy is to drop
    // the claim — the re-prompt says exactly that (never a phantom tool name).
    keywords: /\bI(?:['’]ve|['’]ll| have| had| will)?\s+(?:just\s+|already\s+)?(?:sent|send|notified|notify|alerted|alert)\b[^.!?]{0,60}\b(?:notification|notifications|alert|alerts|message|email|slack|webhook)\b/i,
    excusedBy: [],
    label: "sending a notification",
  },
  {
    keywords: /\bI(?:['’]ve|['’]ll| have| had| will)?\s+(?:just\s+|already\s+)?(?:sent|send|uploaded|upload|shared|share|attached|attach)\b[^.!?]{0,60}\b(?:file|files|attachment|attachments|artifact|artifacts)\b/i,
    excusedBy: [],
    label: "sending a file to the user",
  },
  {
    // "registered/edited a file" — a first-person action with a file object.
    // The previous bare `\bregister(ed|ing)\b` matched the operator's own
    // reporting requirement ("report … registered artifact").
    keywords: /\bI(?:['’]ve|['’]ll| have| had| will)?\s+(?:just\s+|already\s+)?(?:registered|registering|register|edited|editing|edit|added|adding|add|updated|updating|update|modified|modifying|modify)\b[^.!?]{0,60}\b(?:file|files|card|cards|tool|tools|registry)\b/i,
    excusedBy: ["patch.apply", "file.create"],
    tool: "alix_patch_apply",
    label: "editing/registering files",
  },
  {
    keywords: /\bI(?:['’]ve|['’]ll| have| had| will)?\s+(?:just\s+|already\s+)?(?:verified|verifying|verify|compiled|compiling|compile|ran|run)\b[^.!?]{0,60}\b(?:build|compilation|tests?|typecheck|suite|tsc)\b/i,
    excusedBy: ["shell.run"],
    tool: "alix_shell_run",
    label: "verifying compilation",
  },
  {
    keywords: /\bI(?:['’]ve|['’]ll| have| had| will)?\s+(?:just\s+|already\s+)?(?:set\s*up|configured|configuring|configure|enabled|enabling|enable|added|adding|add)\b[^.!?]{0,60}\bmonitor(?:ing|s)?\b/i,
    excusedBy: [],
    label: "setting up monitoring",
  },
];

/**
 * Model-facing tool name for a claim label, when one exists. Labels without a
 * tool are instructed to drop the claim instead — a phantom name here is a
 * harness-authored hallucination the model can never satisfy.
 */
export const CLAIM_TOOL_NAMES: Record<string, string> = {
  ...Object.fromEntries(
    CLAIM_TOOL_MAP.filter(item => item.tool).map(item => [item.label, item.tool as string]),
  ),
  "a successful coordination run with worker outcomes": "alix_coordination_run",
};

/** Every label the claim map can report (tool-backed or not). */
const CLAIM_TOOL_LABELS: ReadonlySet<string> = new Set<string>([
  ...CLAIM_TOOL_MAP.map(item => item.label),
  "a successful coordination run with worker outcomes",
]);

export const NARRATING_THRESHOLD = 80;
export const SHORT_SYNTHESIS_THRESHOLD = 200;

export function isCompletionTool(toolName: string): boolean {
  return toolName === "alix_done" || toolName === "done";
}

export function resolveToolExecutionName(
  toolName: string,
  selectedTools: ReadonlyArray<{ name: string; execName: string }>,
): string {
  return selectedTools.find((tool) => tool.name === toolName)?.execName
    ?? (Object.hasOwn(ALIX_BUILTIN_EXECUTORS, toolName)
      ? ALIX_BUILTIN_EXECUTORS[toolName as keyof typeof ALIX_BUILTIN_EXECUTORS]
      : toolName);
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
  // `usedTools` holds the names the model called (`alix_shell_run`), while the
  // map is keyed by executor ids (`shell.run`). Resolve both directions —
  // without this, every mapped keyword reads as unsubstantiated no matter what
  // ran, and the re-prompt can never be satisfied.
  const called = new Set<string>();
  for (const name of usedTools) {
    called.add(name);
    const execName = ALIX_BUILTIN_EXECUTORS[name as keyof typeof ALIX_BUILTIN_EXECUTORS];
    if (execName) called.add(execName);
  }
  const unsubstantiated: string[] = [];
  for (const { keywords, excusedBy, label } of CLAIM_TOOL_MAP) {
    if (keywords.test(text)) {
      const wasCalled = excusedBy.length > 0 && [...called].some((t) => excusedBy.some((prefix) => t.startsWith(prefix)));
      if (!wasCalled) {
        unsubstantiated.push(label);
      }
    }
  }
  return unsubstantiated;
}

/** First-person future work means the model has not supplied a final answer. */
export function hasPendingAgentAction(text: string): boolean {
  return /\bI(?:['’]m| am)\s+(?:surfacing|registering|writing|creating|sending|verifying|checking|reporting|summarizing|running|reading|adding|updating|finishing|publishing|committing|pushing|listing|showing|reviewing)\b/i.test(text) ||
    /\bI(?:['’]ll| will)\s+(?:surface|register|write|create|send|verify|check|report|summari[sz]e|run|read|add|update|finish|publish|commit|push|list|show|review)\b/i.test(text);
}

export type SuccessfulToolEvidence = {
  name: string;
  args: Record<string, unknown>;
  ordinal: number;
  /**
   * The call reported a workspace change (`changed` / `changedFiles`). Set by
   * the task loop for every successful call; used to accept a delegated
   * coordination run as mutation evidence, since a coordinator that follows
   * "do not perform the workers' tasks" never mutates anything itself.
   */
  mutated?: boolean;
};

export const MUTATION_TOOL_NAMES = new Set(["file.create", "file.write", "file.delete", "patch.apply"]);

/**
 * Does this call count as mutation evidence for the completion gate?
 *
 * A mutation TOOL is not automatically mutation EVIDENCE. `file.create`
 * reports `changed: false` when the file already exists with identical
 * content (`already_exists_identical`), and a `patch.apply` can resolve with
 * an empty `changedFiles`. Both are successful calls that wrote nothing.
 *
 * The old predicate counted the tool name alone, so an agent could satisfy
 * "a successful workspace mutation" by writing a file whose content it had
 * already written — repeatedly, with no workspace change at all — and then
 * declare the task complete. That is the F6 defect (`changed=false`
 * unobservable) with teeth: the no-op was not merely unrecorded, it was
 * accepted as proof.
 *
 * `mutated` is tri-state because the tools disagree about how they report it:
 * `file.create` and `patch.apply` set it, `file.delete` does not (it has no
 * `changed` field at all). So an ABSENT flag is not a denial — only an
 * explicit `false` is. That keeps `file.delete` working while making a
 * self-reported no-op incapable of satisfying the gate.
 */
function isMutationEvidence(item: SuccessfulToolEvidence): boolean {
  if (item.name === COORDINATION_RUN_TOOL_NAME) return item.mutated === true;
  if (!MUTATION_TOOL_NAMES.has(item.name)) return false;
  return item.mutated !== false;
}
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
  // Model-facing tool names carry the action ("alix_coordination_run",
  // "alix_verify_claim", "alix_file_create"), and `\brun\b`/`\bverify\b`/
  // `\bcreate\b` cannot match across the underscore. Scan a name-normalized
  // view so an objective that names tools exactly still registers its
  // requirements.
  const named = task.replace(/[_.]/g, " ");
  const readOnlyInstruction = /\b(?:do not|don't|without)\s+(?:modify|edit|change|write|create|delete|remove)\b/i.test(named);
  const mutationTaskType = /^(?:bugfix|feature|refactor|docs)$/.test(taskType);
  const explicitMutationVerb = /\b(?:fix|implement|refactor|update|change|apply|create|edit|modify|delete|remove|build|scaffold|generate)\b/i.test(named);
  const mutation = !readOnlyInstruction && (
    (mutationTaskType && explicitMutationVerb) ||
    /\bmake\b.{0,60}\b(?:improvement|change|edit|fix)\b/i.test(named) ||
    /\b(?:create|edit|modify|update|delete|remove|apply|implement|fix|change|build|scaffold|generate)\b.{0,100}\b(?:file|code|repository|repo|readme|source|implementation|config|tests?)\b/i.test(named) ||
    /\b(?:file|code|repository|repo|readme|source|implementation|config|tests?)\b.{0,100}\b(?:create|edit|modify|update|delete|remove|apply|implement|fix|change|build|scaffold|generate)\b/i.test(named)
  );
  // Verification is INDEPENDENT of mutation. It used to be gated on
  // `mutation &&`, which made a verification-only objective undetectable:
  // "run the tests and confirm the suite passes" names no file-write verb, so
  // `mutation` was false, so no verification requirement existed, so the
  // completion gate never demanded verification evidence. The model could
  // declare that task done without running a single test — a direct violation
  // of "Completion requires executed evidence (durable)", which requires
  // verification evidence precisely for objectives that explicitly ask for it.
  //
  // Cohort `t3d-2026-09-28-c` measured this as finding 1: verification
  // requirement detection fired on 0 of 8 verification-shaped scopes while
  // mutation fired 7 of 8 and coordination 7 of 8.
  //
  // The regex is UNCHANGED — only the `mutation &&` precondition is gone, so
  // the detection surface widens to verification-shaped objectives and nothing
  // else.
  //
  // But dropping the precondition admits NEGATED instructions too: "do not run
  // the tests, just read the file" contains `run ... tests` and would demand
  // verification evidence the operator explicitly declined. So a negated
  // verification instruction cancels the requirement, mirroring the
  // `readOnlyInstruction` guard that already gates `mutation`.
  const verificationNegated = /\b(?:do not|don'?t|without|never)\s+(?:run|perform|execute|verify|check|test)\b/i.test(named);
  // A later affirmative OVERRIDES the negation rather than compounding it:
  // "do not run the tests but verify the claim" asks for verification. The two
  // clauses must not be OR-ed — that made the override deepen the decline.
  const verificationAffirmativeOverride = /\b(?:but|however|instead|then)\s+(?:run|perform|verify|check)\b/i.test(named);
  const verificationDeclined = verificationNegated && !verificationAffirmativeOverride;
  const verification = !verificationDeclined
    && /\b(?:run|perform)\b.{0,60}\b(?:verification|tests?|checks?|build|lint|typecheck)\b|\bverify\b.{0,80}\b(?:change|edit|implementation|file|code|claim)\b/i.test(named);
  const coordinationSubject = String.raw`(?:coordination|coordinated\s+(?:agents?|workers?)|multi[- ](?:agent|worker)|parallel\s+(?:agents?|workers?)|(?:two|three|four|five|six|seven|eight|nine|ten|\d+)[- ]workers?)`;
  const coordinationAction = String.raw`(?:run|launch|spawn|start|use|delegate|coordinate|create|request)`;
  const coordination = new RegExp(
    String.raw`\b${coordinationAction}\b.{0,100}\b${coordinationSubject}\b|\b${coordinationSubject}\b.{0,100}\b${coordinationAction}\b`,
    "i",
  ).test(named);
  return { mutation, verification, coordination };
}

export function objectiveEvidenceGaps(
  task: string,
  taskType: string,
  evidence: ReadonlyArray<SuccessfulToolEvidence>,
  opts?: { coordinationUnverified?: boolean },
): string[] {
  const required = objectiveEvidenceRequirements(task, taskType);
  const mutationOrdinal = evidence
    .filter((item) => isMutationEvidence(item))
    .reduce((latest, item) => Math.max(latest, item.ordinal), -1);
  const verifiedAfterMutation = evidence.some((item) =>
    item.ordinal > mutationOrdinal &&
    (
      // A verification tool call is verification evidence in its own right;
      // only shell-based checks have to look like a build/test command.
      item.name === "verify.claim" ||
      (item.name === "shell.run" &&
        typeof item.args.command === "string" &&
        VERIFICATION_COMMAND_RE.test(item.args.command))
    )
  );
  const gaps: string[] = [];
  if (required.mutation && mutationOrdinal < 0) gaps.push("a successful workspace mutation");
  if (required.verification && (mutationOrdinal < 0 || !verifiedAfterMutation)) gaps.push(VERIFICATION_EVIDENCE_GAP);
  // A failed last-attempt coordination.run blocks completion regardless of
  // whether the objective text matches the coordination regex: the model
  // volunteered coordination, it failed, so the success evidence is missing
  // until a later attempt clears the flag (durability contract).
  if (
    opts?.coordinationUnverified ||
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
  toolEchoDone?: boolean;
  attempt: number;
}): string {
  const { unsubstantiated, evidenceGaps, errorEchoDone, toolEchoDone = false, attempt } = input;
  const missingToolLines = [...unsubstantiated, ...evidenceGaps]
    .map((c) => {
      const tool = CLAIM_TOOL_NAMES[c];
      if (tool) return `  - ${tool}`;
      // A label with no tool must ask for the claim to be dropped, never name a
      // tool that does not exist — a phantom instruction cannot be satisfied.
      return CLAIM_TOOL_LABELS.has(c)
        ? `  - ${c} (no matching tool exists in this build — remove that claim)`
        : `  - ${c}`;
    })
    .join("\n");

  if (evidenceGaps.length > 0) {
    return (
      `The current task is not complete because the event log lacks: ${evidenceGaps.join(" and ")}. ` +
      `Perform those actions now. Do not call \`alix_done\` or describe the task as complete until the tools succeed.`
    );
  }
  if (errorEchoDone && unsubstantiated.length === 0) {
    return (
      `Your last tool call returned an HTTP/client error, and you declared the task done without writing or verifying the deliverable. ` +
      `A tool error is not a completed outcome. Retry with corrected parameters/headers, complete the actual work, ` +
      `and confirm the deliverable exists before saying done.`
    );
  }
  if (toolEchoDone && unsubstantiated.length === 0) {
    return (
      `Your reply repeated a tool result instead of answering. Write the actual completion summary: ` +
      `what you did, what you verified, and the outcome, in prose — never the raw tool output. ` +
      `If any requested step is still unfinished, do it now instead of summarising.`
    );
  }
  if (attempt >= 2) {
    return (
      `You keep saying you are done without having completed the work:\n${missingToolLines}\n\n` +
      `Do NOT call \`alix_done\` until each item is either executed or withdrawn.`
    );
  }
  if (attempt >= 1) {
    return (
      `Your summary claims you completed the following, but no matching tool call was made:\n${missingToolLines}\n\n` +
      `Call the listed tools now using their \`alix_\` names, or withdraw a claim that no tool can substantiate.`
    );
  }
  return (
    `Your summary claims you did the following, but no matching tool call was made: ${unsubstantiated.join(", ")}. ` +
    `Do not describe an action as complete unless you actually invoked the corresponding tool. ` +
    `Either call the remaining tools now, or withdraw a claim that no tool in this build can substantiate.`
  );
}

/**
 * Shadow tool-selection observation. Instrumentation only — no gate reads it,
 * and the loop's deterministic checks decide exactly as before. It records what
 * the model had to choose from and what it chose, with the usefulness labels a
 * later comparison needs.
 *
 * Honest limits, deliberate in the shape:
 * - It scores the choice that RAN. A shadow alternative that was never executed
 *   has no outcome here, so shadow data alone cannot rank selectors — comparing
 *   an alternative selector requires replaying recorded state (see
 *   `src/decision/replay/*` and `src/runtime/replay-executor.ts`).
 * - `offered` is the per-turn model-facing surface. The capability-applicable
 *   subset is not tracked separately yet; adding it is what makes a scoping
 *   mistake distinguishable from a ranking mistake.
 */
export type RequirementClass = "mutation" | "verification" | "coordination";

/** A tool that could close a currently detected objective requirement. */
export type RequirementCandidate = { tool: AlixBuiltinToolName; reasons: string[] };

/**
 * Requirement-derived candidates, straight from `objectiveEvidenceRequirements`.
 * Called *candidates*, never "applicable": ALiX has no general-purpose notion of
 * applicability, only "these tools could close a requirement we actually
 * detected". Deliberately not intent-derived — that would add a new semantic
 * authority before there is evidence it is needed.
 */
export function buildRequirementCandidates(required: {
  mutation: boolean;
  verification: boolean;
  coordination: boolean;
}): RequirementCandidate[] {
  const candidates: RequirementCandidate[] = [];
  const add = (tool: AlixBuiltinToolName, reason: `requirement:${RequirementClass}`): void => {
    const existing = candidates.find(candidate => candidate.tool === tool);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    candidates.push({ tool, reasons: [reason] });
  };
  if (required.mutation) {
    add("alix_file_create", "requirement:mutation");
    add("alix_patch_apply", "requirement:mutation");
    add("alix_file_delete", "requirement:mutation");
  }
  if (required.verification) {
    add("alix_verify_claim", "requirement:verification");
    add("alix_shell_run", "requirement:verification");
  }
  if (required.coordination) {
    add("alix_coordination_run", "requirement:coordination");
  }
  return candidates;
}

/**
 * The task loop's own view of an observation. Structurally the canonical
 * `SelectionObservation` with ONE narrowing: the loop always carries a scoper
 * ranking, possibly empty, because the scoper runs on every iteration. The
 * grounded path has no scoper, so the canonical type leaves `ranking` optional.
 *
 * This used to be a full field-by-field re-declaration, which is how
 * `invalidSelection` came to be missing here: a field added to the observation
 * reached the emitter but was dropped by the return type, so the task loop
 * silently never recorded an invalid selection. Narrow the canonical type
 * instead of restating it.
 */
export type SelectionObservation = NeutralSelectionObservation & {
  ranking: SelectionRanking;
};

export function buildSelectionObservation(input: {
  scopeId: string;
  iteration: number;
  invocationId?: string;
  /** Sanitized frozen surface (builtin tools + genuinely offered MCP entries). */
  candidates: readonly FrozenToolCandidate[];
  /** LOCAL ONLY bindings for those candidates. */
  candidateBindings?: readonly LocalToolBinding[];
  chosen: string;
  chosenCandidateId: string;
  executor: string;
  argsSignature: string;
  seenSignatures: Map<string, number>;
  executorSuccess: boolean;
  repaired?: boolean;
  /** Provable no-op: the call succeeded without doing or reporting anything. */
  noOp?: boolean;
  /** The result carried content (any rendered body). */
  hasContent?: boolean;
  requirementCandidates?: RequirementCandidate[];
  scoping?: {
    admitted: Array<{ candidateId: string; reasons: string[] }>;
    fallbackFull: boolean;
    excluded?: Array<{ candidateId: string; reasons: string[] }>;
  };
  ranking?: {
    scoper?: Array<{ candidateId: string; score: number }>;
    mcpSelector?: Array<{ candidateId: string; score: number }>;
  };
  /**
   * Set when the chosen tool could not be resolved against the frozen surface.
   * Declared here as well as on the neutral input: without it the wrapper
   * silently DROPPED the field, so the loop could never record an invalid
   * selection even though `main.ts` passed one.
   */
  invalidSelection?: { toolName: string; reason: string };
  /** Requirement tools the surface could not offer, and why. */
  surfaceGaps?: readonly SurfaceGap[];
}): SelectionObservation {
  // Candidate semantics stay in this layer: requirement tools are builtin tool
  // names, the frozen surface is keyed by candidate id, and the scoper is
  // requirement-blind — so the id conversion and the reason merge happen here,
  // once, and the neutral assembly receives plain candidate ids.
  const requirementCandidates = (input.requirementCandidates ?? []).map(candidate => ({
    candidateId: builtinCandidateId(candidate.tool),
    reasons: [...candidate.reasons],
  }));
  const admitted = (input.scoping?.admitted ?? []).map((entry) => {
    const requirement = requirementCandidates.find(candidate => candidate.candidateId === entry.candidateId);
    if (!requirement) return entry;
    return {
      candidateId: entry.candidateId,
      reasons: [...new Set([...entry.reasons, ...requirement.reasons])],
    };
  });
  const observation = buildNeutralSelectionObservation({
    scopeId: input.scopeId,
    iteration: input.iteration,
    ...(input.invocationId ? { invocationId: input.invocationId } : {}),
    candidates: input.candidates,
    ...(input.candidateBindings ? { candidateBindings: input.candidateBindings } : {}),
    chosen: input.chosen,
    chosenCandidateId: input.chosenCandidateId,
    executor: input.executor,
    argsSignature: input.argsSignature,
    seenSignatures: input.seenSignatures,
    executorSuccess: input.executorSuccess,
    ...(input.repaired !== undefined ? { repaired: input.repaired } : {}),
    ...(input.noOp !== undefined ? { noOp: input.noOp } : {}),
    ...(input.hasContent !== undefined ? { hasContent: input.hasContent } : {}),
    requirementCandidates,
    scoping: {
      admitted,
      fallbackFull: input.scoping?.fallbackFull ?? false,
      ...(input.scoping?.excluded ? { excluded: input.scoping.excluded } : {}),
    },
    ranking: {
      scoper: input.ranking?.scoper ?? [],
      ...(input.ranking?.mcpSelector ? { mcpSelector: input.ranking.mcpSelector } : {}),
    },
    ...(input.invalidSelection ? { invalidSelection: input.invalidSelection } : {}),
    ...(input.surfaceGaps ? { surfaceGaps: input.surfaceGaps } : {}),
  });
  // The task-loop observation always carries a scoper ranking (possibly empty);
  // the neutral assembly leaves it optional because the grounded path has no
  // scoper. Restating it here keeps the loop's own invariant in its own type.
  return { ...observation, ranking: observation.ranking ?? { scoper: [] } };
}

/**
 * A tool that could close a detected requirement must not disappear from the
 * offered surface without recorded scoping provenance. Returns the unexplained
 * tools — empty is the invariant holding. Replay and the regression test both
 * use this; a requirement-closing tool that vanished silently is a scoping
 * failure, while one that was offered and not chosen is a selection question.
 */
export function unexplainedRequirementCandidates(observation: SelectionObservation): string[] {
  return observation.requirementCandidates
    .filter(candidate => !observation.offered.includes(candidate.candidateId))
    .filter(candidate => !(observation.scoping.excluded ?? []).some(entry => entry.candidateId === candidate.candidateId))
    .map(candidate => candidate.candidateId);
}

/**
 * Requirement-closing tools that were NOT offered, each labelled with WHY.
 *
 * The predicate above cannot see the case that matters most. It only calls a
 * missing tool "unexplained" when the tool is absent from `offered` AND absent
 * from `scoping.excluded` — but a tool removed by session mode never reaches
 * the scoper, so it is in neither list and the surface reads as fully
 * explained. T3 measured 6 of 8 verification scopes in exactly that state:
 * `alix_shell_run` is stripped by `--read-only` (`agent-loop.ts`), so
 * "Run pnpm typecheck:unused" was impossible, and the corpus could not say so.
 *
 * `scoper-excluded` is the explicable case. `absent-upstream` means the tool
 * was never a candidate — stripped by session mode, or missing from the base
 * tool set — and is the one worth surfacing. A requirement candidate the loop
 * knows about but the base surface never offered is exactly the asymmetry T3
 * mistook for a selector failure.
 */
export function deriveSurfaceGaps(observation: SelectionObservation): SurfaceGap[] {
  const excluded = new Set((observation.scoping.excluded ?? []).map(entry => entry.candidateId));
  return observation.requirementCandidates
    .filter(candidate => !observation.offered.includes(candidate.candidateId))
    .map(candidate => ({
      candidateId: candidate.candidateId,
      toolName: builtinNameOf(candidate.candidateId),
      reasons: [...candidate.reasons],
      absence: excluded.has(candidate.candidateId) ? "scoper-excluded" as const : "absent-upstream" as const,
    }));
}

/** True when a tool the objective needs could not have been called at all. */
export function surfaceBlockedTheObjective(observation: SelectionObservation): boolean {
  return deriveSurfaceGaps(observation).some(gap => gap.absence !== "scoper-excluded");
}

/**
 * The limitation notice injected when the surface could not offer a tool the
 * objective needed. Returns "" when nothing is blocked, so the caller can push
 * unconditionally.
 *
 * This exists because being blocked and being unable were indistinguishable to
 * the model. Cohort `t3d-2026-09-28-c` measured 6 of 8 verification-shaped
 * scopes answering a "run pnpm typecheck:unused" objective by *reading* — no
 * error, no retry, just a confident answer from inspection, because
 * `alix_shell_run` was never offered and nothing said so. `surfaceGaps`
 * recorded it for the operator; this tells the model, so the honest outcome is
 * "this scope cannot execute commands" instead of a silent downgrade to a
 * weaker method.
 *
 * Only `absent-upstream` gaps are surfaced. A `scoper-excluded` tool was a
 * relevance judgment on a tool that *was* reachable — telling the model it
 * cannot run would be false.
 */
export function renderSurfaceBlockNotice(gaps: ReadonlyArray<SurfaceGap>): string {
  const blocked = gaps.filter(gap => gap.absence !== "scoper-excluded");
  if (blocked.length === 0) return "";
  const names = blocked.map(gap => gap.toolName ?? gap.candidateId).join(", ");
  return [
    "<surface_constraint>",
    `This scope cannot execute commands: ${names} ${blocked.length === 1 ? "is" : "are"} not available in a read-only session.`,
    "Do not answer an execution request from inspection alone — reading a config file is not the same as running the check.",
    "Either verify by static inspection and state explicitly that the check was NOT executed and why,",
    "or report that the objective is not achievable in this scope.",
    "</surface_constraint>",
  ].join("\n");
}

/**
 * The deterministic ranking may only rank tools that were actually offered —
 * ranking a tool the model could not call would make the replay baseline
 * describe a surface that never existed. Scoped to the deterministic
 * (scoper) ranking: `mcpSelector` legitimately ranks MCP handles the selector
 * then truncates away, which is a different question from a builtin that was
 * ranked but never offered.
 */
export function rankingOutsideOffered(observation: SelectionObservation): string[] {
  return observation.ranking.scoper
    .map(entry => entry.candidateId)
    .filter(candidateId => !observation.offered.includes(candidateId));
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

/** Strip the `<tool_result …>` envelope the loop wraps results in. */
export function toolResultBody(content: string | undefined): string {
  return (content ?? "")
    .replace(/<\/?tool_result[^>]*>/g, "")
    .replace(/^\s*\[Tool Result\]\s*/i, "")
    .trim();
}

/**
 * True when a "final answer" is the last tool result repeated back. Weak models
 * end turns this way ("310 .tmp/out/notes.md"), which reads as a completion
 * summary while saying nothing about the work — and it satisfies the claim and
 * evidence checks, because an echo makes no claims and the requirement scan
 * cannot see that the objective's steps were skipped.
 */
export function isToolResultEcho(text: string, lastToolResult: string | undefined): boolean {
  const answer = toolResultBody(text);
  if (answer.length < 8) return false; // short prose is not an echo
  const result = toolResultBody(lastToolResult);
  if (result.length === 0) return false;
  if (answer === result) return true;
  if (result.length > 200) return false;
  // Quoting a short result inside real prose is normal ("the heading is
  // `# ALiX`"), so an embedded result only counts when it dominates the answer.
  return answer.includes(result) && result.length / answer.length >= 0.6;
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
