// tests/cli/commands/issue-run-handler.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import helpers from the handler module
// These are not exported, so we test via the CLI or replicate the logic here

// Replicate the logic inline for testing
const ALLOWED_LABELS = ["bug", "feature", "chore", "enhancement", "docs"];
const BLOCKED_LABELS = ["blocked", "do-not-merge", "wontfix"];

interface IssueData {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
}

function checkEligibility(issue: IssueData): { eligible: boolean; reason?: string } {
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

describe("checkEligibility", () => {
  const baseIssue: IssueData = {
    number: 1,
    title: "Test issue",
    body: "Test body",
    state: "open",
    labels: ["bug"],
    url: "https://github.com/owner/repo/issues/1",
  };

  it("passes for open issue with allowed label", () => {
    const result = checkEligibility(baseIssue);
    assert.strictEqual(result.eligible, true);
  });

  it("rejects closed issue", () => {
    const result = checkEligibility({ ...baseIssue, state: "closed" });
    assert.strictEqual(result.eligible, false);
    assert.ok(result.reason?.includes("closed"));
  });

  it("rejects issue with blocked label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["blocked"] });
    assert.strictEqual(result.eligible, false);
    assert.ok(result.reason?.includes("blocked"));
  });

  it("rejects issue with do-not-merge label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["do-not-merge"] });
    assert.strictEqual(result.eligible, false);
  });

  it("rejects issue with wontfix label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["wontfix"] });
    assert.strictEqual(result.eligible, false);
  });

  it("rejects issue without any allowed label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["question"] });
    assert.strictEqual(result.eligible, false);
    assert.ok(result.reason?.includes("allowed labels"));
  });

  it("accepts issue with multiple allowed labels", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["bug", "enhancement"] });
    assert.strictEqual(result.eligible, true);
  });

  it("blocked label takes precedence over allowed label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["bug", "blocked"] });
    assert.strictEqual(result.eligible, false);
  });

  it("accepts chore label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["chore"] });
    assert.strictEqual(result.eligible, true);
  });

  it("accepts docs label", () => {
    const result = checkEligibility({ ...baseIssue, labels: ["docs"] });
    assert.strictEqual(result.eligible, true);
  });
});

describe("buildPrompt", () => {
  it("includes title and body", () => {
    const prompt = buildPrompt({
      number: 42,
      title: "Add logging",
      body: "Need better logging",
      state: "open",
      labels: ["feature"],
      url: "https://github.com/owner/repo/issues/42",
    });
    assert.ok(prompt.includes("Add logging"));
    assert.ok(prompt.includes("Need better logging"));
    assert.ok(prompt.includes("https://github.com/owner/repo/issues/42"));
  });

  it("truncates long body", () => {
    const longBody = "x".repeat(5000);
    const prompt = buildPrompt({
      number: 1,
      title: "Long body",
      body: longBody,
      state: "open",
      labels: ["bug"],
      url: "https://github.com/owner/repo/issues/1",
    });
    assert.ok(prompt.length < 5000);
    assert.ok(prompt.includes("truncated"));
  });

  it("handles empty body", () => {
    const prompt = buildPrompt({
      number: 1,
      title: "No body",
      body: "",
      state: "open",
      labels: ["bug"],
      url: "https://github.com/owner/repo/issues/1",
    });
    assert.ok(prompt.includes("No body"));
  });
});
