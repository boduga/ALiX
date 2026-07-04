/**
 * issue-run-handler.ts — `alix issue run` skeleton.
 *
 * Fetches a GitHub issue, checks eligibility, creates execution context,
 * calls runTask, and prints a structured summary.
 *
 * Phase 6, step 1: non-mutating skeleton only — no branch, no commit, no PR.
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { RunResult } from "../../run.js";
import type { ExecutionContext } from "../../observability/execution-context.js";

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

/**
 * Fetch issue data from GitHub via `gh` CLI.
 */
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

/**
 * Check whether an issue is eligible for autonomous execution.
 */
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

/**
 * Build a task prompt from issue data.
 */
function buildPrompt(issue: IssueData): string {
  let prompt = `Execute the following GitHub issue:\n\n`;
  prompt += `Title: ${issue.title}\n\n`;
  if (issue.body) {
    // Truncate body to a reasonable length for the prompt
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

/**
 * Handle `alix issue run --repo <owner/name> --issue <number>`.
 */
export async function handleIssueRunCommand(args: string[]): Promise<void> {
  const repo = parseArg(args, "--repo");
  const issueStr = parseArg(args, "--issue");

  if (!repo || !issueStr) {
    console.error("Usage: alix issue run --repo <owner/name> --issue <number>");
    process.exit(1);
  }

  const issueNumber = parseInt(issueStr, 10);
  if (isNaN(issueNumber)) {
    console.error(`Invalid issue number: ${issueStr}`);
    process.exit(1);
  }

  // -- Stage 1: Fetch issue --------------------------------------------------
  console.log(`Fetching issue #${issueNumber} from ${repo}...`);
  let issue: IssueData;
  try {
    issue = await fetchIssue(repo, issueNumber);
  } catch (err: unknown) {
    console.error(`Failed to fetch issue: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`  Issue: #${issue.number} — ${issue.title}`);
  console.log(`  State: ${issue.state}`);
  console.log(`  Labels: ${issue.labels.join(", ") || "(none)"}`);
  console.log();

  // -- Stage 2: Eligibility -------------------------------------------------
  const eligibility = await checkEligibility(issue);
  if (!eligibility.eligible) {
    console.log(`❌ Issue not eligible: ${eligibility.reason}`);
    process.exit(0);
  }

  console.log("✅ Issue eligible for execution");
  console.log();

  // -- Stage 3: Execution context -------------------------------------------
  const runId = `issue-run-${randomUUID().slice(0, 8)}`;
  const sessionId = `sess-${Date.now()}`;
  const workflowId = `wf-issue-${issueNumber}-${Date.now().toString(36)}`;

  const context: ExecutionContext = {
    runId,
    sessionId,
    workflowId,
  };

  console.log("ExecutionContext:");
  console.log(`  Run:   ${runId}`);
  console.log(`  Session: ${sessionId}`);
  console.log(`  Workflow: ${workflowId}`);
  console.log();

  // -- Stage 4: Run the task ------------------------------------------------
  const taskPrompt = buildPrompt(issue);

  console.log(`Running issue #${issue.number}...`);
  console.log();

  let result: RunResult;
  try {
    const { runTask } = await import("../../run.js");
    result = await runTask(process.cwd(), taskPrompt, {
      sessionMode: "bypass",
      parentRunId: runId,
    });
  } catch (err: unknown) {
    console.error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // -- Stage 5: Summary -----------------------------------------------------
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
  console.log("  Issue Execution Summary");
  console.log("═══════════════════════════════════════");
  console.log(`  Issue:    #${summary.issueNumber} — ${summary.issueTitle}`);
  console.log(`  Eligible: ${summary.eligible ? "yes" : "no"}`);
  console.log(`  Run ID:   ${summary.runId}`);
  console.log(`  Session:  ${summary.sessionId}`);
  console.log(`  Workflow: ${summary.workflowId}`);
  console.log(`  Outcome:  ${summary.outcome}`);
  if (result.summary) {
    console.log(`  Summary:  ${result.summary.slice(0, 500)}`);
  }
  console.log("═══════════════════════════════════════");

  // Exit with appropriate code
  if (result.reason === "completed") {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArg(args: string[], key: string): string | undefined {
  const idx = args.indexOf(key);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}
