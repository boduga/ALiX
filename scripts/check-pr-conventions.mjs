#!/usr/bin/env node
// Development-only PR metadata gate. Does not import ALiX runtime code.
export function validatePullRequest({ title, branch, base = "main" }) {
  const errors = [];
  const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|security)(\([a-z0-9][a-z0-9._-]*\))?!?: [a-z0-9][^\r\n]*$/;
  if (!conventional.test(title) || title.length > 100) {
    errors.push("PR title must be Conventional Commits format (type(scope): imperative summary, <=100 chars)");
  }
  if (base !== "main") errors.push("PR base must be main (approved dependency stacks require a separate exception)");
  if (branch === "main" || !/^(feat|fix|docs|chore|test|refactor|security|ci|build|hotfix)\/[a-z0-9][a-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.includes("//")) {
    errors.push("Use a scoped branch: feat/, fix/, docs/, chore/, test/, refactor/, security/, ci/, build/, or hotfix/");
  }
  return errors;
}

export function validateGitHubPullRequest(input) {
  const { title, branch, base = "main", author = "" } = input;
  // Dependabot branches and titles are generated externally; the dependency
  // update is still subject to the normal GitHub checks and branch protection.
  if (author === "dependabot[bot]" && branch.startsWith("dependabot/")) return [];
  return validatePullRequest({ title, branch, base });
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const input = {
    title: process.env.PR_TITLE || "",
    branch: process.env.PR_HEAD_REF || "",
    base: process.env.PR_BASE_REF || "main",
    author: process.env.PR_AUTHOR || "",
  };
  const errors = validateGitHubPullRequest(input);
  for (const error of errors) console.error("::error::" + error);
  if (errors.length) process.exitCode = 1;
  else console.log("PR conventions OK");
}
