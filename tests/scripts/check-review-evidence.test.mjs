import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  REVIEW_EVIDENCE_PATTERN,
  validateReviewEvidence,
} from "../../scripts/check-review-evidence.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const DIGEST = "d".repeat(64);

function validEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    pr: 1111,
    reviewedHeadSha: SHA_A,
    diffSha256: DIGEST,
    author: { agentId: "author-agent" },
    reviewer: { kind: "agent", agentId: "reviewer-agent", model: "test-model", context: "fresh" },
    humanSecurityAcceptance: false,
    verdict: "approve",
    findings: [],
    ...overrides,
  };
}

function validate(overrides = {}, input = {}) {
  return validateReviewEvidence({
    evidence: validEvidence(overrides),
    expectedPr: 1111,
    headSha: SHA_B,
    diffSha256: DIGEST,
    reviewIsAncestor: true,
    changedSinceReview: [],
    ...input,
  });
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Review Evidence Test",
      GIT_AUTHOR_EMAIL: "review-evidence@example.invalid",
      GIT_COMMITTER_NAME: "Review Evidence Test",
      GIT_COMMITTER_EMAIL: "review-evidence@example.invalid",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout.trim();
}

function writeFile(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commit(root, message) {
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", message]);
  return runGit(root, ["rev-parse", "HEAD"]);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "alix-review-evidence-"));
  runGit(root, ["init", "-q"]);
  runGit(root, ["config", "user.name", "Review Evidence Test"]);
  runGit(root, ["config", "user.email", "review-evidence@example.invalid"]);
  writeFile(root, "package.json", '{"type":"module"}\n');
  writeFile(root, "scripts/check-review-evidence.mjs", readFileSync(new URL("../../scripts/check-review-evidence.mjs", import.meta.url)));
  const base = commit(root, "base");
  return { root, base };
}

function checker(root, args, env = {}) {
  return spawnSync(process.execPath, [join(root, "scripts/check-review-evidence.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function evidenceFor(pr, reviewedHeadSha, diffSha256, extra = {}) {
  return JSON.stringify(
    validEvidence({ pr, reviewedHeadSha, diffSha256, ...extra }),
    null,
    2,
  ) + "\n";
}

function digestFor(root, base, head) {
  const printed = checker(root, ["--print", "--pr", "1111", "--base", base, "--head", head]);
  assert.equal(printed.status, 0, printed.stdout + printed.stderr);
  return JSON.parse(printed.stdout).diffSha256;
}

test("valid evidence passes", () => {
  assert.deepEqual(validate(), []);
});

test("missing or non-object evidence fails", () => {
  assert.deepEqual(validateReviewEvidence({ evidence: null }), ["review evidence must be a JSON object"]);
  assert.deepEqual(validateReviewEvidence({ evidence: [] }), ["review evidence must be a JSON object"]);
});

test("PR mismatch fails", () => {
  assert.ok(validate({ pr: 1112 }).some((error) => /evidence is for PR #1112/.test(error)));
});

test("invalid SHA and digest formats fail", () => {
  const errors = validate({ reviewedHeadSha: "ABC", diffSha256: "not-a-digest" });
  assert.ok(errors.some((error) => /reviewedHeadSha/.test(error)));
  assert.ok(errors.some((error) => /diffSha256/.test(error)));
});

test("digest mismatch fails", () => {
  assert.ok(validate({}, { diffSha256: "e".repeat(64) }).some((error) => /does not match the PR diff/.test(error)));
});

test("a reviewed head earlier than the PR head is valid when only evidence changed", () => {
  assert.deepEqual(validate({}, { changedSinceReview: ["docs/reviews/PR-1111.json"] }), []);
});

test("a non-ancestor reviewed head fails", () => {
  assert.ok(validate({}, { reviewIsAncestor: false }).some((error) => /not an ancestor/.test(error)));
});

test("request-changes fails", () => {
  assert.ok(validate({ verdict: "request-changes" }).some((error) => /requested changes/.test(error)));
});

test("unknown or open finding status fails", () => {
  const finding = { id: "F1", title: "Open", severity: "medium", status: "open", resolution: "pending" };
  assert.ok(
    validate({ findings: [finding] }).some((error) => /status must be one of/.test(error) && /open finding blocks/.test(error)),
  );
});

test("self-review fails", () => {
  assert.ok(
    validate({ reviewer: { kind: "agent", agentId: "author-agent", model: "test-model", context: "fresh" } }).some((error) =>
      /self-review/.test(error),
    ),
  );
});

test("a reviewer without fresh context fails", () => {
  assert.ok(
    validate({ reviewer: { kind: "agent", agentId: "reviewer-agent", model: "test-model", context: "shared" } }).some((error) =>
      /reviewer.context/.test(error),
    ),
  );
});

test("humanSecurityAcceptance true fails", () => {
  assert.ok(validate({ humanSecurityAcceptance: true }).some((error) => /humanSecurityAcceptance/.test(error)));
});

test("high accepted risk requires an operator decision", () => {
  const finding = { id: "F1", title: "Accepted", severity: "high", status: "accepted-risk", resolution: "accepted" };
  assert.ok(validate({ findings: [finding] }).some((error) => /without `operatorDecision`/.test(error)));
  assert.deepEqual(
    validate({ findings: [{ ...finding, operatorDecision: "operator accepted in #42" }] }),
    [],
  );
});

test("duplicate finding IDs fail", () => {
  const finding = { id: "F1", title: "Finding", severity: "low", status: "fixed", resolution: "fixed" };
  assert.ok(validate({ findings: [finding, finding] }).some((error) => /duplicated/.test(error)));
});

test("code changed after review fails and names the path", () => {
  assert.ok(
    validate({}, { changedSinceReview: ["src/agents/agent.ts"] }).some(
      (error) => /content changed after the reviewed head/.test(error) && /src\/agents\/agent\.ts/.test(error),
    ),
  );
});

test("review evidence pattern accepts JSON below docs/reviews only", () => {
  assert.equal(REVIEW_EVIDENCE_PATTERN.test("docs/reviews/PR-1111.json"), true);
  assert.equal(REVIEW_EVIDENCE_PATTERN.test("docs/reviews/nested/PR-1111.json"), true);
  assert.equal(REVIEW_EVIDENCE_PATTERN.test("docs/reviews/PR-1111.md"), false);
  assert.equal(REVIEW_EVIDENCE_PATTERN.test("src/reviews/PR-1111.json"), false);
});

test("missing evidence exits 1", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content without evidence\n");
    const head = commit(root, "code");
    const result = checker(root, ["--pr", "1111", "--base", base, "--head", head]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /missing review evidence/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("invocation errors exit 2", () => {
  const { root } = fixture();
  try {
    assert.equal(checker(root, ["--pr", "1111"]).status, 2);
    assert.equal(checker(root, ["--pr", "1111", "--base", "HEAD"]).status, 2);
    assert.equal(checker(root, ["--pr", "nope", "--base", "HEAD", "--head", "HEAD"]).status, 2);
    assert.equal(checker(root, ["--pr", "1111", "--base", "does-not-exist", "--head", "HEAD"]).status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--print emits the PR, resolved head, digest, and evidence path without evidence", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "printable content\n");
    const head = commit(root, "code");
    const result = checker(root, ["--print", "--pr", "1111", "--base", base, "--head", head]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      pr: 1111,
      reviewedHeadSha: head,
      diffSha256: digestFor(root, base, head),
      evidencePath: "docs/reviews/PR-1111.json",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--print defaults the head to HEAD, while the gate refuses to guess", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "printable content\n");
    const head = commit(root, "code");
    const printed = checker(root, ["--print", "--pr", "1111", "--base", base]);
    assert.equal(printed.status, 0, printed.stdout + printed.stderr);
    assert.equal(JSON.parse(printed.stdout).reviewedHeadSha, head);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an untracked evidence file is not evidence", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content with untracked evidence\n");
    const head = commit(root, "code");
    const digest = digestFor(root, base, head);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, head, digest));
    const result = checker(root, ["--pr", "1111", "--base", base, "--head", head]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /missing review evidence/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("committed but malformed JSON exits 1 and names the path", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content with malformed evidence\n");
    const head = commit(root, "code");
    writeFile(root, "docs/reviews/PR-1111.json", "{ this is not json\n");
    const evidenceHead = commit(root, "malformed evidence");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", evidenceHead]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /docs\/reviews\/PR-1111\.json is not valid JSON/);
    assert.notEqual(evidenceHead, head);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two-phase review passes: code at H1, evidence-only commit at H2", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "reviewed content\n");
    const reviewedHead = commit(root, "reviewed code");
    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    const evidenceHead = commit(root, "review evidence");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", evidenceHead]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Review evidence OK/);

    assert.equal(runGit(root, ["merge-base", "--is-ancestor", reviewedHead, evidenceHead]), "");
    assert.deepEqual(runGit(root, ["diff", "--name-only", reviewedHead, evidenceHead]).split("\n"), [
      "docs/reviews/PR-1111.json",
    ]);
    assert.deepEqual(runGit(root, ["rev-list", "--reverse", `${reviewedHead}..${evidenceHead}`]).split("\n"), [
      evidenceHead,
    ]);
    assert.deepEqual(
      runGit(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", evidenceHead]).split("\n"),
      ["docs/reviews/PR-1111.json"],
    );
    assert.equal(runGit(root, ["rev-parse", "HEAD"]), evidenceHead);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("code changed after review at H2 fails and names the offending path", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "reviewed content\n");
    const reviewedHead = commit(root, "reviewed code");
    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    writeFile(root, "src/later.txt", "unreviewed content\n");
    const laterHead = commit(root, "unreviewed code after review");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", laterHead]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /content changed after the reviewed head: src\/later\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evidence committed together with code fails the separate-commit rule", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "reviewed content\n");
    const reviewedHead = commit(root, "reviewed code");
    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    writeFile(root, "src/same-commit.txt", "not separately reviewed\n");
    const mixedHead = commit(root, "evidence with code");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", mixedHead]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /also changed reviewed content: src\/same-commit\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rebased or non-ancestor reviewed head fails", () => {
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "reviewed content\n");
    const reviewedHead = commit(root, "reviewed code");
    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    commit(root, "review evidence");

    runGit(root, ["checkout", "-q", "-b", "rebased", base]);
    writeFile(root, "src/change.txt", "equivalent but rewritten content\n");
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    const rebasedHead = commit(root, "rewritten history with old evidence");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", rebasedHead]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /not an ancestor/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the digest is stable under hostile diff configuration", () => {
  // The review digest binds a reviewed head to the exact bytes a reviewer saw.
  // `diff.noprefix`, `diff.interHunkContext`, and `diff.suppressBlankEmpty`
  // each changed that digest on an identical change, so a reviewer with a
  // personal config and CI would disagree about the same PR. canonicalDiffArgs
  // pins them; this test proves the pins win over repository/user config
  // rather than only describing them.
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content line one\ncontent line two\n");
    // Ordering needs more than one changed file to be observable.
    writeFile(root, "src/aaa.txt", "a\n");
    writeFile(root, "src/zzz.txt", "z\n");
    const head = commit(root, "content");
    const plain = digestFor(root, base, head);

    runGit(root, ["config", "diff.noprefix", "true"]);
    runGit(root, ["config", "diff.mnemonicPrefix", "true"]);
    runGit(root, ["config", "diff.interHunkContext", "7"]);
    runGit(root, ["config", "diff.suppressBlankEmpty", "true"]);
    runGit(root, ["config", "diff.algorithm", "patience"]);
    runGit(root, ["config", "diff.context", "9"]);
    // orderFile reorders the per-file sections outright, so it changes the
    // hashed bytes even when every other knob is pinned.
    writeFile(root, "orderfile.txt", "src/zzz.txt\nsrc/change.txt\nsrc/aaa.txt\n");
    runGit(root, ["config", "diff.orderFile", join(root, "orderfile.txt")]);

    assert.equal(digestFor(root, base, head), plain);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent evidence path is a verdict but an unreadable commit is an invocation error", () => {
  // "No evidence committed" (exit 1) and "git could not answer" (exit 2) are
  // different facts. A catch around `git show` collapsed them, so an unreadable
  // object read as an ordinary missing-evidence verdict.
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content\n");
    const head = commit(root, "code");

    // Absent path in a readable commit stays a review verdict.
    const absent = checker(root, ["--pr", "1111", "--base", base, "--head", head]);
    assert.equal(absent.status, 1, absent.stdout + absent.stderr);
    assert.match(absent.stderr, /missing review evidence/);

    // A head git cannot resolve never reaches the evidence read: exit 2.
    const unreadable = checker(root, ["--pr", "1111", "--base", base, "--head", "0".repeat(40)]);
    assert.equal(unreadable.status, 2, unreadable.stdout + unreadable.stderr);
    assert.match(unreadable.stderr, /could not resolve/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a reviewed head git cannot resolve is an invocation error, not a stale review", () => {
  // `merge-base --is-ancestor` exits 1 for "no" and 128 for "I cannot answer".
  // A catch-all `false` turned an unreadable repository into a review verdict
  // (exit 1) instead of an invocation error (exit 2).
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content\n");
    const head = commit(root, "code");
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, "f".repeat(40), "d".repeat(64)));
    commit(root, "evidence naming an unknown commit");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", "HEAD"]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /could not verify the reviewed head/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
