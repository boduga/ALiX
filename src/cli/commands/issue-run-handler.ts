/**
 * issue-run-handler.ts — `alix issue run` skeleton.
 *
 * Fetches a GitHub issue, checks eligibility, creates execution context,
 * calls runTask, and prints a structured summary with evidence events.
 *
 * Phase 6, step 1: non-mutating skeleton only — no branch, no commit, no PR.
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunResult } from "../../run.js";
import type { ExecutionContext } from "../../observability/execution-context.js";
import { EventLog } from "../../events/event-log.js";

interface ProposalSummary {
  issueNumber: number;
  issueTitle: string;
  runId?: string;
  sessionId?: string;
  workflowId?: string;
  proposedObjective: string;
  proposedFiles: string[];
  proposedVerification: string[];
  risks: string[];
  nextAction: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IssueData {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
}

interface IssueRunSummary {
  issueNumber: number;
  issueTitle: string;
  eligible: boolean;
  rejectionReason?: string;
  runId?: string;
  sessionId?: string;
  workflowId?: string;
  outcome?: string;
}

const ALLOWED_LABELS = ["bug", "feature", "chore", "enhancement", "docs"];
const BLOCKED_LABELS = ["blocked", "do-not-merge", "wontfix"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchIssue(repo: string, issue: number): Promise<IssueData> {
  const output = execSync(
    `gh issue view "${issue}" --repo "${repo}" --json number,title,body,state,labels,url`,
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
  );
  const parsed = JSON.parse(output);
  return {
    number: parsed.number,
    title: parsed.title,
    body: parsed.body ?? "",
    state: parsed.state,
    labels: (parsed.labels ?? []).map((l: { name: string }) => l.name),
    url: parsed.url,
  };
}

async function checkEligibility(issue: IssueData): Promise<{ eligible: boolean; reason?: string }> {
  if (issue.state !== "open") {
    return { eligible: false, reason: `Issue is ${issue.state}, not open` };
  }
  const hasBlocked = issue.labels.some((l) => BLOCKED_LABELS.includes(l.toLowerCase()));
  if (hasBlocked) {
    return { eligible: false, reason: "Issue has a blocked/do-not-merge/wontfix label" };
  }
  const hasAllowed = issue.labels.some((l) => ALLOWED_LABELS.includes(l.toLowerCase()));
  if (!hasAllowed) {
    return { eligible: false, reason: `Issue has none of the allowed labels: ${ALLOWED_LABELS.join(", ")}` };
  }
  return { eligible: true };
}

function buildPrompt(issue: IssueData): string {
  let prompt = `Execute the following GitHub issue:\n\n`;
  prompt += `Title: ${issue.title}\n\n`;
  if (issue.body) {
    const bodyPreview = issue.body.length > 4000 ? issue.body.slice(0, 4000) + "\n...[truncated]" : issue.body;
    prompt += `Description:\n${bodyPreview}\n\n`;
  }
  prompt += `Issue URL: ${issue.url}\n\n`;
  prompt += `Read the issue description carefully. Plan and execute the necessary changes.`;
  return prompt;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleIssueRunCommand(args: string[]): Promise<void> {
  const repo = parseArg(args, "--repo");
  const issueStr = parseArg(args, "--issue");
  const dryRun = args.includes("--dry-run");
  const postComment = args.includes("--comment");
  const proposalMode = args.includes("--proposal");
  const createPr = args.includes("--pr");

  if (!repo || !issueStr) {
    console.error("Usage: alix issue run --repo <owner/name> --issue <number> [--dry-run] [--proposal] [--comment] [--pr]");
    process.exit(1);
  }

  const issueNumber = parseInt(issueStr, 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${issueStr}`);
    process.exit(1);
  }

  // Initialize event log
  const sessionId = `sess-${Date.now()}`;
  const sessionDir = join(process.cwd(), ".alix", "sessions", sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const eventLog = new EventLog(sessionDir);
  await eventLog.init();
  const eb = { sessionId, actor: "system" as const };

  // Stage 1: Fetch issue
  console.log(`Fetching issue #${issueNumber} from ${repo}...`);
  let issue: IssueData;
  try {
    issue = await fetchIssue(repo, issueNumber);
  } catch (err: unknown) {
    await eventLog.append({ ...eb, type: "issue.fetch_failed" as const, payload: { repo, issueNumber, error: String(err) } });
    console.error(`Failed to fetch issue: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  await eventLog.append({ ...eb, type: "issue.fetched" as const, payload: { repo, issueNumber: issue.number, title: issue.title, state: issue.state, labels: issue.labels, url: issue.url } });

  console.log(`  Issue: #${issue.number} — ${issue.title}`);
  console.log(`  State: ${issue.state}`);
  console.log(`  Labels: ${issue.labels.join(", ") || "(none)"}`);
  console.log();

  // Stage 2: Eligibility
  const eligibility = await checkEligibility(issue);
  if (!eligibility.eligible) {
    await eventLog.append({ ...eb, type: "issue.rejected" as const, payload: { repo, issueNumber: issue.number, title: issue.title, reason: eligibility.reason } });
    console.log(`❌ Issue not eligible: ${eligibility.reason}`);
    process.exit(0);
  }

  await eventLog.append({ ...eb, type: "issue.eligible" as const, payload: { repo, issueNumber: issue.number, title: issue.title } });
  console.log("✅ Issue eligible for execution");
  console.log();

  // Stage 3: Execution context
  const runId = `issue-run-${randomUUID().slice(0, 8)}`;
  const workflowId = `wf-issue-${issueNumber}-${Date.now().toString(36)}`;

  const context: ExecutionContext = { runId, sessionId, workflowId };
  await eventLog.append({ ...eb, type: "issue.context_created" as const, payload: { runId, sessionId, workflowId } });

  console.log("ExecutionContext:");
  console.log(`  Run:   ${runId}`);
  console.log(`  Session: ${sessionId}`);
  console.log(`  Workflow: ${workflowId}`);
  console.log();

  // Stage 4: Run the task
  let taskPrompt = buildPrompt(issue);
  if (proposalMode) {
    await eventLog.append({ ...eb, type: "issue.proposal_requested" as const, payload: { issueNumber: issue.number, title: issue.title, runId, sessionId, workflowId } });
    taskPrompt = `[PROPOSAL MODE] Analyze this issue and produce a structured change proposal. Describe:\n1. Objective — what needs to change\n2. Files to inspect or modify\n3. Verification steps needed\n4. Risks or unknowns\n5. Recommended next action\n\nDO NOT modify any files.\n\n${taskPrompt}`;
  } else if (dryRun) {
    taskPrompt = `[READ-ONLY ANALYSIS] Analyze this issue and describe what changes would be needed. DO NOT modify any files.\n\n${taskPrompt}`;
  }
  await eventLog.append({ ...eb, type: "issue.run_started" as const, payload: { issueNumber: issue.number, title: issue.title, runId, sessionId, workflowId, dryRun, proposalMode } });

  console.log(`Running issue #${issue.number}...`);
  console.log();

  let result: RunResult;
  try {
    const { runTask } = await import("../../run.js");
    result = await runTask(process.cwd(), taskPrompt, { sessionMode: "bypass", parentRunId: runId });
  } catch (err: unknown) {
    await eventLog.append({ ...eb, type: "issue.run_failed" as const, payload: { issueNumber: issue.number, runId, error: String(err) } });
    console.error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Stage 5: Summary
  await eventLog.append({ ...eb, type: "issue.completed" as const, payload: { issueNumber: issue.number, title: issue.title, runId, workflowId, outcome: result.reason ?? "completed", dryRun, proposalMode, summary: result.summary } });

  const summary: IssueRunSummary = {
    issueNumber: issue.number,
    issueTitle: issue.title,
    eligible: true,
    runId,
    sessionId,
    workflowId,
    outcome: result.reason ?? "completed",
  };

  console.log();
  console.log("═══════════════════════════════════════");
  console.log(`  ${proposalMode ? "Proposal Summary (DRY RUN)" : `Issue Execution Summary${dryRun ? " (DRY RUN)" : ""}`}`);
  console.log("═══════════════════════════════════════");
  console.log(`  Issue:    #${summary.issueNumber} — ${summary.issueTitle}`);
  console.log(`  Mode:     ${proposalMode ? "proposal dry run (no changes)" : dryRun ? "dry run (no changes)" : "live"}`);
  console.log(`  Eligible: ${summary.eligible ? "yes" : "no"}`);
  console.log(`  Run ID:   ${summary.runId}`);
  console.log(`  Session:  ${summary.sessionId}`);
  console.log(`  Workflow: ${summary.workflowId}`);
  console.log(`  Outcome:  ${summary.outcome}`);
  if (proposalMode) {
    console.log(`  Note:     Review the agent's proposal above. To apply, re-run without --proposal.`);
  }
  if (result.summary) {
    console.log(`  Summary:  ${result.summary.slice(0, 500)}`);
  }
  console.log("═══════════════════════════════════════");

  // Create draft PR if requested
  if (createPr && result.reason === "completed") {
    const { createDraftPr } = await import("./issue-draft-pr.js");
    console.log(`\nCreating draft PR for #${issue.number}...`);
    const prResult = createDraftPr(repo, issue.number, issue.title);
    if (prResult.success) {
      console.log(`✅ Draft PR created: ${prResult.prUrl ?? prResult.branchName}`);
      await eventLog.append({ ...eb, type: "issue.draft_pr_created" as const, payload: { issueNumber: issue.number, runId, branchName: prResult.branchName, prUrl: prResult.prUrl } });
    } else {
      console.error(`❌ Draft PR creation failed: ${prResult.error}`);
      await eventLog.append({ ...eb, type: "issue.draft_pr_failed" as const, payload: { issueNumber: issue.number, runId, error: prResult.error } });
    }
  }

  // Emit proposal event if in proposal mode
  if (proposalMode) {
    await eventLog.append({ ...eb, type: "issue.proposal_generated" as const, payload: { issueNumber: issue.number, title: issue.title, runId, sessionId, workflowId, outcome: result.reason ?? "completed" } });
  }

  // Optionally post comment to GitHub
  if (postComment) {
    try {
      const outcome = result.reason ?? "completed";
      postIssueComment(repo, issue.number, summary, outcome, dryRun);
      console.log(`\nComment posted to #${issue.number}.`);
    } catch (err: unknown) {
      console.error(`\nFailed to post comment: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (result.reason === "completed") {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

function parseArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

/**
 * Post a structured comment to a GitHub issue.
 */
function postIssueComment(repo: string, issueNumber: number, summary: IssueRunSummary, runOutcome: string, isDryRun: boolean): void {
  const outcomeIcon = runOutcome === "completed" ? "✅" : "⚠️";
  const body = [
    `🤖 **ALiX Issue Execution Report**`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Issue | #${summary.issueNumber} — ${summary.issueTitle} |`,
    `| Outcome | ${outcomeIcon} ${runOutcome} |`,
    `| Mode | ${isDryRun ? "Dry run" : "Live"} |`,
    `| Run ID | \`${summary.runId}\` |`,
    `| Session | \`${summary.sessionId}\` |`,
    `| Workflow | \`${summary.workflowId}\` |`,
    ``,
  ].join("\n");

  execSync(
    `gh issue comment "${issueNumber}" --repo "${repo}" --body "${body.replace(/"/g, '\\"')}"`,
    { encoding: "utf-8" },
  );
}
