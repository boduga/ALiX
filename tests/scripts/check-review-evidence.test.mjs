import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  REVIEW_EVIDENCE_PATTERN,
  canonicalizeRawDiff,
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

/**
 * Write a file whose name is a byte sequence, not a string.
 *
 * `writeFileSync` accepts a Buffer path, which is the only way to create a
 * filename that is not valid UTF-8. Decoding such a name to test it would
 * destroy the very bytes the test is about.
 */
function writeFileBytes(root, nameBytes, content) {
  writeFileSync(Buffer.concat([Buffer.from(root + "/"), nameBytes]), content);
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

/**
 * Invoke the checker with the replacement guard ABSENT from its environment.
 *
 * Same reasoning as check-dox-claims.test.mjs: the checker sets the guard on its
 * own git reads, so an ambient GIT_NO_REPLACE_OBJECTS=1 -- which preflight
 * injects into every child through stepEnv() -- would stand in for that and let
 * the digest test pass with the guard removed. Deleting the key leaves the code
 * under test as the only guard. Blanking it is not equivalent: git treats an
 * empty value as ENABLED.
 */
function checker(root, args, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.GIT_NO_REPLACE_OBJECTS;
  return spawnSync(process.execPath, [join(root, "scripts", "check-review-evidence.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: childEnv,
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
  // The review digest binds a reviewed head to the change a reviewer saw.
  // `diff.noprefix`, `diff.interHunkContext`, and `diff.suppressBlankEmpty`
  // each changed the old patch digest on an identical change, so a reviewer
  // with a personal config and CI could disagree about the same PR. The digest
  // is now taken over `--raw` records; this test proves the pins win over
  // repository/user config rather than only describing them.
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "content line one\ncontent line two\n");
    // Ordering needs more than one changed file to be observable.
    writeFile(root, "src/aaa.txt", "a\n");
    writeFile(root, "src/zzz.txt", "z\n");
    const head = commit(root, "content");
    const plain = digestFor(root, base, head);

    // Every knob that influenced the patch rendering, plus the abbreviation
    // setting: `core.abbrev` and `core.fileMode` are host policy, not content.
    runGit(root, ["config", "diff.noprefix", "true"]);
    runGit(root, ["config", "diff.mnemonicPrefix", "true"]);
    runGit(root, ["config", "diff.interHunkContext", "7"]);
    runGit(root, ["config", "diff.suppressBlankEmpty", "true"]);
    runGit(root, ["config", "diff.algorithm", "patience"]);
    runGit(root, ["config", "diff.context", "9"]);
    runGit(root, ["config", "diff.relative", "true"]);
    runGit(root, ["config", "core.abbrev", "7"]);
    runGit(root, ["config", "core.fileMode", "false"]);
    // orderFile reorders the per-file records outright, so it moves the hashed
    // bytes even when every rendering knob is pinned. The digest sorts the
    // records, which is why this must not matter -- and why no platform-
    // specific order file is needed.
    writeFile(root, "orderfile.txt", "src/zzz.txt\nsrc/change.txt\nsrc/aaa.txt\n");
    runGit(root, ["config", "diff.orderFile", join(root, "orderfile.txt")]);
    assert.equal(digestFor(root, base, head), plain);

    // Host-local attributes and diff drivers are the vector command-line flags
    // cannot cover: `-diff`/`binary` replace the patch body with a binary
    // stanza, and a funcname driver rewrites hunk headers. Neither can touch a
    // blob id, so both must leave the digest alone.
    writeFile(root, ".git/info/attributes", "*.txt -diff\n*.md binary\n*.md diff=hostile\n");
    runGit(root, ["config", "diff.hostile.funcname", "^content"]);
    runGit(root, ["config", "diff.hostile.binary", "true"]);
    runGit(root, ["config", "diff.hostile.command", "/bin/echo pwned"]);
    assert.equal(digestFor(root, base, head), plain);

    // The user-level attribute file is a second source, read in addition to
    // the repository one. It must not matter either.
    const userAttributes = join(root, "user-attributes");
    writeFile(root, "user-attributes", "*.txt -diff\n");
    runGit(root, ["config", "core.attributesFile", userAttributes]);
    assert.equal(digestFor(root, base, head), plain);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a rename record is rejected, not silently mis-paired", () => {
  // `--raw -z` emits `metadata NUL path NUL` for A/D/M/T records, but a
  // rename under `-M` emits `metadata NUL oldpath NUL newpath NUL`. An even
  // number of rename records therefore produced an even field count, and the
  // pair loop paired a PATH with the NEXT record’s metadata. Two different
  // trees could then hash the same. The shipped caller pins `--no-renames`,
  // and the canonicalizer now rejects the shape instead of trusting that.
  const metadata = (status, blob) => `:${"100644"} ${"100644"} ${blob} ${blob} ${status}`;
  const nul = Buffer.from([0]);
  const encode = (fields) => Buffer.concat(fields.flatMap((f) => [Buffer.from(f), nul]));

  // Two renames: 6 fields, even, and mis-paired under a naive pair loop.
  const twoRenames = encode([
    metadata("R100", "1".repeat(40)), "old-a.txt", "new-a.txt",
    metadata("R100", "2".repeat(40)), "old-b.txt", "new-b.txt",
  ]);
  assert.throws(() => canonicalizeRawDiff(twoRenames), /rename\/copy records need --no-renames/);

  // The honest shape is still accepted, so the guard rejects the defect and
  // not the normal path.
  const ok = encode([metadata("A", "3".repeat(40)), "src/new.ts", metadata("D", "4".repeat(40)), "src/old.ts"]);
  assert.equal(canonicalizeRawDiff(ok).equals(canonicalizeRawDiff(ok)), true);
});

test("a colon in a path cannot impersonate metadata", () => {
  // Checking only the first byte for ":" is not falsifiable: a path may begin
  // with ":" too. Two renames -- one whose target and one whose source start
  // with ":" -- place a path in an even position, pass a first-byte test, and
  // bind paths to the wrong records. Measured with real `git diff --raw -z -M`
  // output in a throwaway repo, that stream was accepted before the metadata
  // grammar was parsed.
  const metadata = (status, blob) => `:100644 100644 ${blob} ${blob} ${status}`;
  const nul = Buffer.from([0]);
  const encode = (fields) => Buffer.concat(fields.flatMap((f) => [Buffer.from(f), nul]));

  // Even-indexed fields here are meta, ":new-a.txt", and ":old-b.txt".
  const colonPaths = encode([
    metadata("R100", "1".repeat(40)), "old-a.txt", ":new-a.txt",
    metadata("R100", "2".repeat(40)), ":old-b.txt", "new-b.txt",
  ]);
  assert.throws(
    () => canonicalizeRawDiff(colonPaths),
    /rename\/copy records need --no-renames|is not <mode sha status>/,
  );

  // A path that begins with ":" in an ODD position is still a legitimate path,
  // so the parser must reject the impersonation without rejecting real names
  // that start with a colon.
  const legitimate = encode([metadata("A", "5".repeat(40)), ":colon-named.txt"]);
  assert.equal(canonicalizeRawDiff(legitimate).toString("utf8").includes(":colon-named.txt"), true);

  // Combined (`--cc`, unmerged) records carry three modes and three ids and a
  // multi-character status. They are legitimate two-field records.
  const combined = encode([`::100644 100644 100644 ${"6".repeat(40)} ${"7".repeat(40)} ${"8".repeat(40)} M`, "conflict.txt"]);
  assert.equal(canonicalizeRawDiff(combined).toString("utf8").includes("conflict.txt"), true);
});

test("the metadata grammar enforces the mode and id arity it documents", () => {
  // A grammar that only checks "starts with : and has some hex" is not the
  // grammar docs/reviews/AGENTS.md claims. These three shapes are neither the
  // ordinary `:<mode> <mode> <sha> <sha> <status>` nor the combined
  // `::<mode> <mode> <mode> <sha> <sha> <sha> <status>`, so accepting them
  // would let a path-shaped field pass as metadata again.
  const nul = Buffer.from([0]);
  const encode = (fields) => Buffer.concat(fields.flatMap((f) => [Buffer.from(f), nul]));
  const sha = (c) => c.repeat(40);
  const malformed = [
    // single colon, three modes (combined arity under an ordinary prefix)
    `:100644 100644 100644 ${sha("1")} ${sha("2")} M`,
    // combined prefix, only two modes
    `::100644 100644 ${sha("1")} ${sha("2")} ${sha("3")} M`,
    // combined prefix, three modes but only two ids
    `::100644 100644 100644 ${sha("1")} ${sha("2")} M`,
  ];
  for (const field of malformed) {
    assert.throws(
      () => canonicalizeRawDiff(encode([field, "some/path.txt"])),
      /is not <mode sha status>/,
      `must reject ${field}`,
    );
  }
});

test("the digest distinguishes two trees that swap content between files", () => {
  // `--raw -z` emits two NUL-terminated fields per changed path: metadata, then
  // path. Splitting the stream on NUL and sorting the bare fields separates a
  // path from the blob that belongs to it, so `a=X,b=Y` and `a=Y,b=X` sorted to
  // the same bytes and the same digest. Both trees are distinct changes and a
  // review of one must not be accepted for the other.
  const { root, base } = fixture();
  try {
    // Tree A: a.txt=X, b.txt=Y. Both are additions, so both records carry the
    // same zero old-blob id and differ only in new blob and path.
    writeFile(root, "a.txt", "X\n");
    writeFile(root, "b.txt", "Y\n");
    const treeA = commit(root, "a=x b=y");
    const digestA = digestFor(root, base, treeA);

    // Tree B: a.txt=Y, b.txt=X. Same blob set, a different mapping to paths.
    writeFile(root, "a.txt", "Y\n");
    writeFile(root, "b.txt", "X\n");
    const treeB = commit(root, "a=y b=x");
    const digestB = digestFor(root, base, treeB);

    assert.notEqual(digestA, digestB, "swapping which blob lives at which path is a different change");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the digest distinguishes paths that differ only in non-UTF-8 bytes", () => {
  // Paths are bytes. Decoding the raw stream through UTF-8 maps every invalid
  // sequence onto U+FFFD, so two genuinely different filenames can hash the
  // same. The canonicalizer must never decode a path.
  const { root, base } = fixture();
  try {
    writeFileBytes(root, Buffer.from([0xfe, 0x2e, 0x74, 0x78, 0x74]), "payload\n");
    const headFe = commit(root, "fe path");

    // A second change from the same base, differing only in the path byte.
    runGit(root, ["reset", "-q", "--hard", base]);
    writeFileBytes(root, Buffer.from([0xff, 0x2e, 0x74, 0x78, 0x74]), "payload\n");
    const headFf = commit(root, "ff path");

    const digestFe = digestFor(root, base, headFe);
    const digestFf = digestFor(root, base, headFf);
    assert.notEqual(digestFe, digestFf, "0xfe.txt and 0xff.txt are different paths");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a submodule ignore rule cannot hide a post-review gitlink change", () => {
  // A `.gitmodules` entry with `ignore = all` (repository-controlled, and the
  // normal state of a vendored dependency) removes gitlink records from every
  // diff. `-c diff.ignoreSubmodules=none` does not override it; only
  // `--ignore-submodules=none` does. Without the flag a post-review submodule
  // bump produced an identical digest and the gate exited 0 over a change.
  const { root, base } = fixture();
  try {
    const sub = join(root, "subrepo-src");
    mkdirSync(sub, { recursive: true });
    runGit(sub, ["init", "-q"]);
    runGit(sub, ["config", "user.name", "Review Evidence Test"]);
    runGit(sub, ["config", "user.email", "review-evidence@example.invalid"]);
    writeFile(sub, "inner.txt", "one\n");
    const innerOne = commit(sub, "inner one");
    writeFile(sub, "inner.txt", "two\n");
    const innerTwo = commit(sub, "inner two");

    runGit(root, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/sub"]);
    writeFile(root, ".gitmodules", '[submodule "vendor/sub"]\n\tpath = vendor/sub\n\turl = ' + sub + '\n\tignore = all\n');
    runGit(root, ["add", ".gitmodules"]);

    // Point the gitlink at the first inner commit.
    runGit(join(root, "vendor/sub"), ["checkout", "-q", innerOne]);
    runGit(root, ["add", "vendor/sub"]);
    const reviewed = commit(root, "sub at inner one");
    const reviewedDigest = digestFor(root, base, reviewed);

    // Bump the gitlink without touching anything else.
    runGit(join(root, "vendor/sub"), ["checkout", "-q", innerTwo]);
    runGit(root, ["add", "vendor/sub"]);
    const bumped = commit(root, "bump submodule");
    const bumpedDigest = digestFor(root, base, bumped);

    assert.notEqual(reviewedDigest, bumpedDigest, "a gitlink bump is a change even when .gitmodules ignores it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a submodule ignore rule cannot hide a post-review gitlink change from the evidence gate", () => {
  // The digest pins `--ignore-submodules=none`, but the post-review change check
  // is a second diff in the same gate. Removing the flag there still passed all
  // 37 tests, so a reviewed head followed by a gitlink bump exited 0: the gate
  // reported "only review evidence changed" for a diff it could not see.
  const { root, base } = fixture();
  try {
    const sub = join(root, "subrepo-src");
    mkdirSync(sub, { recursive: true });
    runGit(sub, ["init", "-q"]);
    runGit(sub, ["config", "user.name", "Review Evidence Test"]);
    runGit(sub, ["config", "user.email", "review-evidence@example.invalid"]);
    writeFile(sub, "inner.txt", "one\n");
    const innerOne = commit(sub, "inner one");
    writeFile(sub, "inner.txt", "two\n");
    const innerTwo = commit(sub, "inner two");

    runGit(root, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/sub"]);
    writeFile(root, ".gitmodules", '[submodule "vendor/sub"]\n\tpath = vendor/sub\n\turl = ' + sub + '\n\tignore = all\n');
    runGit(root, ["add", ".gitmodules"]);
    runGit(join(root, "vendor/sub"), ["checkout", "-q", innerOne]);
    runGit(root, ["add", "vendor/sub"]);
    const reviewedHead = commit(root, "sub at inner one");

    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    runGit(join(root, "vendor/sub"), ["checkout", "-q", innerTwo]);
    runGit(root, ["add", "vendor/sub"]);
    const bumpedHead = commit(root, "bump submodule after review");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", bumpedHead]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /content changed after the reviewed head: vendor\/sub/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a gitlink bump after review is attributed to its evidence commit", () => {
  // Three diffs decide this verdict: the digest, the post-review change check,
  // and the per-evidence-commit attribution. Only the first two were pinned;
  // dropping `--ignore-submodules=none` from `changedPathsInCommit` left 38/38
  // green. The gate still exits 1 through the other two, so the loss is
  // diagnostic -- the record stops naming which commit touched reviewed
  // content -- and an unpinned diagnostic drifts until it is wrong silently.
  const { root, base } = fixture();
  try {
    const sub = join(root, "subrepo-src");
    mkdirSync(sub, { recursive: true });
    runGit(sub, ["init", "-q"]);
    runGit(sub, ["config", "user.name", "Review Evidence Test"]);
    runGit(sub, ["config", "user.email", "review-evidence@example.invalid"]);
    writeFile(sub, "inner.txt", "one\n");
    const innerOne = commit(sub, "inner one");
    writeFile(sub, "inner.txt", "two\n");
    const innerTwo = commit(sub, "inner two");

    runGit(root, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/sub"]);
    writeFile(root, ".gitmodules", '[submodule "vendor/sub"]\n\tpath = vendor/sub\n\turl = ' + sub + '\n\tignore = all\n');
    runGit(root, ["add", ".gitmodules"]);
    runGit(join(root, "vendor/sub"), ["checkout", "-q", innerOne]);
    runGit(root, ["add", "vendor/sub"]);
    const reviewedHead = commit(root, "sub at inner one");

    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    runGit(join(root, "vendor/sub"), ["checkout", "-q", innerTwo]);
    runGit(root, ["add", "vendor/sub"]);
    const evidenceHead = commit(root, "bump submodule and record evidence");

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", evidenceHead]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(`evidence commit ${evidenceHead.slice(0, 12)}`));
    assert.match(result.stderr, /also changed reviewed content: vendor\/sub/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a replacement ref cannot change the digest of a commit", () => {
  // `git replace` makes a ref resolve to a different commit without changing
  // the real history, so a replacement ref would let the digest describe a tree
  // nobody committed. The checker disables replacement objects.
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "real\n");
    const real = commit(root, "real");
    const plain = digestFor(root, base, real);

    runGit(root, ["checkout", "-q", "-b", "tamper", base]);
    writeFile(root, "src/change.txt", "tampered\n");
    const tampered = commit(root, "tampered");
    runGit(root, ["checkout", "-q", "-"]);
    runGit(root, ["replace", real, tampered]);

    assert.equal(digestFor(root, base, real), plain, "a replacement ref must not restate what the commit contains");
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

test("an unreadable evidence blob is an invocation error, not missing evidence", () => {
  // `readCommittedFile` must separate "this path is absent from the commit"
  // (real verdict, exit 1) from "git cannot answer" (invocation error, exit 2).
  // A test only on an unresolvable HEAD stops at `rev-parse`, so it never
  // reaches the `git show` failure this distinction exists for. Corrupting the
  // evidence blob forces `ls-tree` to succeed and `show` to fail.
  const { root, base } = fixture();
  try {
    writeFile(root, "src/change.txt", "reviewed content\n");
    const reviewedHead = commit(root, "reviewed code");
    const digest = digestFor(root, base, reviewedHead);
    writeFile(root, "docs/reviews/PR-1111.json", evidenceFor(1111, reviewedHead, digest));
    const head = commit(root, "review evidence");

    const blob = runGit(root, ["rev-parse", `${head}:docs/reviews/PR-1111.json`]);
    const objectPath = join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2));
    rmSync(objectPath, { force: true });

    const result = checker(root, ["--pr", "1111", "--base", base, "--head", head]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /could not read docs\/reviews\/PR-1111\.json/);
    assert.doesNotMatch(result.stderr, /missing review evidence/);
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
