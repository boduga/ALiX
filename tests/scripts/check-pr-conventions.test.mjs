import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePullRequest, validateGitHubPullRequest } from "../../scripts/check-pr-conventions.mjs";

test("accepts agent and maintainer PRs", () => {
  assert.deepEqual(validatePullRequest({title:"chore(dev): harden PR checks",branch:"chore/dev-git-workflow-hardening"}), []);
  assert.deepEqual(validatePullRequest({title:"security: deny untrusted launch",branch:"security/1054-launch-guard"}), []);
});
test("rejects unsafe branch names and nonconventional titles", () => {
  assert.ok(validatePullRequest({title:"Update things",branch:"main"}).length >= 2);
  assert.ok(validatePullRequest({title:"fix: repair issue",branch:"review/temporary"}).length);
  assert.ok(validatePullRequest({title:"fix: repair issue",branch:"feat/foo//bar"}).length);
  assert.ok(validatePullRequest({title:"fix: repair issue",branch:"feat/../bar"}).length);
});
test("requires main base by default", () => {
  assert.ok(validatePullRequest({title:"fix: repair issue",branch:"fix/repair",base:"experimental"}).length);
});
test("allows generated dependabot PRs only for dependabot identity", () => {
  assert.deepEqual(validateGitHubPullRequest({title:"Bump package",branch:"dependabot/npm_and_yarn/pkg",author:"dependabot[bot]"}), []);
  assert.ok(validateGitHubPullRequest({title:"Bump package",branch:"dependabot/npm_and_yarn/pkg",author:"somebody"}).length);
});
