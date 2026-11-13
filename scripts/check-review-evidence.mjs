#!/usr/bin/env node
/**
 * check-review-evidence.mjs — make "a separate agent session reviewed the diff"
 * a verdict instead of a sentence in a PR body.
 *
 * CONTRIBUTING step 7 asks for a separate agent session to review the complete
 * diff. Nothing verified that the review happened, that it covered what was
 * merged, or that it was still current. This turns it into a check:
 *
 *   1. PRESENT   `docs/reviews/PR-<n>.json` exists in the PR head commit.
 *   2. FRESH     it records a commit that is an ancestor of the PR head. The
 *                reviewed commit may be earlier than the head, but every path
 *                changed between them must be review evidence. A rebase that
 *                drops the reviewed commit makes the evidence stale.
 *   3. BOUND     the evidence must be added or updated after the reviewed
 *                commit, in a commit that changes only review evidence. A
 *                review cannot be reused across code that changed after it.
 *   4. CLEAN     no finding is `open`, and `request-changes` fails the gate.
 *   5. HONEST    the file cannot record human security acceptance. Reviewer
 *                identity and fresh context are self-declared, so this is an
 *                attribution record, not proof of independence.
 *
 * The digest is taken over the base...head diff with `docs/reviews/**`
 * excluded. That exclusion is required: the evidence file is committed into
 * the diff it describes, so including it would make every review stale the
 * moment it was recorded. The exclusion cannot be used to smuggle reviewed
 * code, because rule 3 limits post-review commits to that same path.
 *
 * Usage (CI):
 *   PR_NUMBER=1111 PR_BASE_SHA=$(...) PR_HEAD_SHA=$(...) \
 *     node scripts/check-review-evidence.mjs
 *
 * Usage (author, before writing evidence):
 *   node scripts/check-review-evidence.mjs --print --pr 1111 \
 *     --base <base-sha> --head <head-sha>
 *
 * Usage (local, current branch against main):
 *   node scripts/check-review-evidence.mjs --print --pr 1111 --base origin/main
 *
 * Exit codes: 0 recorded, fresh, and clean; 1 missing/stale/blocked; 2 invocation error.
 */

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

export const REVIEW_EVIDENCE_DIR = "docs/reviews";

/** Every path this check treats as review metadata rather than reviewed content. */
export const REVIEW_EVIDENCE_PATTERN = /^docs\/reviews\/.+\.json$/;

export const REVIEWER_KINDS = ["agent"];
export const VERDICTS = ["approve", "request-changes"];
export const FINDING_STATUSES = ["fixed", "accepted-risk", "not-applicable"];
export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "info"];

export function evidencePathFor(pr) {
  if (!Number.isInteger(pr) || pr <= 0) throw new Error(`PR number must be a positive integer, got \`${pr}\``);
  return `${REVIEW_EVIDENCE_DIR}/PR-${pr}.json`;
}

/**
 * The exact git invocation whose stdout is hashed. Pinned so a reviewer and CI
 * cannot compute "the same" digest from different diffs.
 *
 * The digest is taken over `--raw` records, not patch text. A patch digest
 * binds whatever *rendering* the local host chose, and that rendering is
 * steered by more than command-line flags. `.git/info/attributes` and
 * `core.attributesFile` can mark a path `-diff` (emitting `GIT binary patch`),
 * `binary`, or bind it to a `funcname` driver that rewrites `@@` hunk headers.
 * Both were measured on an identical change: `*.md -diff` moved a patch digest
 * from 6db88a84… to e46c1496…, and a `funcname` driver moved it again. Neither
 * `--text` nor any `-c` pin neutralizes the funcname case, because the driver
 * is the renderer. A commit identity record cannot be steered that way: it
 * names modes, full 40-hex blob ids, status letters and paths, and no attribute
 * or diff driver can change a blob id.
 *
 * Sorting the records also removes the ordering dependency. `diff.orderFile`
 * reorders sections, so the previous contract pinned it with an external file —
 * `/dev/null`, which does not exist on Windows. Sorting the records makes the
 * digest order-independent instead of merely pinned, which is stronger and
 * needs no file.
 *
 * Two settings delete records rather than re-render them, so sorting cannot
 * help and they are overridden here:
 *
 *   - `--ignore-submodules=none`. A `.gitmodules` entry with `ignore = all`
 *     (repository-controlled, and the usual state of a vendored dependency) or
 *     a host `diff.ignoreSubmodules=all` drops every gitlink record. Measured:
 *     a post-review submodule bump then produced an identical digest and the
 *     gate exited 0 over a changed tree. `-c diff.ignoreSubmodules=none` is
 *     NOT sufficient — `.gitmodules` is read after configuration.
 *   - `GIT_NO_REPLACE_OBJECTS=1` in the environment. `git replace` rewrites the
 *     commit a ref resolves to, so the measured tree changes without the real
 *     history changing. Measured: 73ee2c6d… under a replacement ref versus
 *     f7b54658… without it, restored by the variable.
 *
 * Consequence: this digest proves "the same tree change", not "the same
 * rendered text". A content edit changes a blob id, including a pure
 * whitespace or line-ending edit inside one file, so a stale review is
 * detectable. What it does not bind is the arbitrary text a host's diff driver
 * would have produced for that tree.
 *
 * The `-c` pins are placed before `diff`, so they win over a user's or CI
 * runner's config, including `GIT_CONFIG_*` environment entries.
 */
export function canonicalDiffArgs(base, head) {
  return [
    "-c", "core.quotepath=false",
    "-c", "core.abbrev=40",
    "-c", "diff.noprefix=false",
    "-c", "diff.mnemonicPrefix=false",
    "-c", "diff.relative=false",
    "-c", "diff.external=",
    "diff",
    "--raw",
    "-z",
    "--no-abbrev",
    "--full-index",
    "--no-renames",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    `${base}...${head}`,
    "--",
    ":(exclude)docs/reviews/**",
  ];
}

/**
 * The `--raw` metadata grammar: `:<mode> <mode> <sha> <sha> <status>`, or the
 * combined form `::<mode> <mode> <mode> <sha> <sha> <sha> <status>` that git
 * emits with `--cc` for an unmerged path. Modes are six octal digits; object
 * ids are hex and at least 40 characters (a sha256 repository uses 64); the
 * status is one to three uppercase letters with an optional similarity score.
 *
 * The grammar exists because a path can look like metadata. A first-byte check
 * for ":" was defeated by two renames -- one colon-prefixed target and one
 * colon-prefixed source -- which put a path in an even position; real
 * `git diff --raw -z -M` output for that change was accepted and mis-paired.
 * Matching the whole shape the field must have is what makes the check
 * falsifiable.
 */
const RAW_META_RE = /^::?[0-7]{6}(?: [0-7]{6}){1,2}(?: [0-9a-f]{40,}){2,3} [A-Z]{1,3}[0-9]{0,3}$/;

/**
 * Canonicalize raw-diff output into a stable byte string.
 *
 * `--raw -z` emits, per changed path, two NUL-terminated fields:
 *
 *     :<oldmode> <newmode> <oldblob> <newblob> <status> NUL <path> NUL
 *
 * The pair is the record. Splitting the stream on NUL and sorting the bare
 * fields separates every path from the metadata that describes it, which lets
 * two different trees hash the same: with two files that share a base blob,
 * swapping their contents produced identical sorted field lists and therefore
 * an identical digest. Records are kept whole and sorted as pairs.
 *
 * Paths are bytes, not text. They need not be valid UTF-8, and decoding through
 * a string maps every invalid byte sequence onto U+FFFD, so `0xfe.txt` and
 * `0xff.txt` hashed the same. Nothing here decodes a path.
 *
 * @param {Buffer} buffer stdout of `canonicalDiffArgs` with `encoding: null`
 * @returns {Buffer} sorted records, each terminated by NUL
 */
export function canonicalizeRawDiff(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("raw diff canonicalization requires the raw byte buffer");
  const nul = Buffer.from([0]);
  const fields = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0) {
      fields.push(buffer.subarray(start, i));
      start = i + 1;
    }
  }
  if (start !== buffer.length) {
    throw new Error("raw diff output did not end with a NUL terminator");
  }
  if (fields.length % 2 !== 0) {
    throw new Error(`raw diff output had ${fields.length} NUL-delimited fields, but --raw -z emits metadata/path pairs`);
  }
  const records = [];
  for (let i = 0; i < fields.length; i += 2) {
    // Pairing is only sound when every metadata field is really metadata and
    // every record carries exactly one path. Checking the first byte for ":" is
    // not enough to establish that: a *path* may begin with ":" too, so two
    // renames -- one whose target and one whose source start with ":" -- place a
    // path in the even position and pass a first-byte test, silently binding a
    // path to the wrong record. Measured with real `git diff --raw -z -M`
    // output, that stream was accepted.
    //
    // So the field is parsed as the grammar it claims to be. `--raw` emits
    // `<modes> <blobs> <status>`, and a combined (unmerged) record starts with
    // "::" and carries three of each. Anything that does not parse is not a
    // record boundary we can trust, and a rename/copy status -- which appends a
    // second path -- is rejected outright rather than paired.
    const meta = fields[i].toString("latin1");
    if (!RAW_META_RE.test(meta)) {
      throw new Error(
        `raw diff metadata field ${JSON.stringify(meta.slice(0, 80))} is not \u003cmode sha status\u003e, so the ` +
          "stream does not pair as (metadata, path); rename/copy records need --no-renames",
      );
    }
    const status = meta.slice(meta.lastIndexOf(" ") + 1);
    if (status.startsWith("R") || status.startsWith("C")) {
      throw new Error(
        `raw diff emitted a ${status} record, which carries a second path; rename/copy records need --no-renames`,
      );
    }
    records.push(Buffer.concat([fields[i], nul, fields[i + 1], nul]));
  }
  records.sort(Buffer.compare);
  return Buffer.concat(records);
}

export function diffDigest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * The environment every git call in this checker runs under.
 *
 * `git replace` makes a ref resolve to a different commit without changing the
 * real history, so a replacement ref in a local clone would let the digest (and
 * the ancestor/path checks) describe a tree nobody committed. Replacement
 * objects are disabled for every invocation rather than only for the digest.
 */
function gitEnv() {
  return { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" };
}

function git(argv, encoding = "utf8") {
  return execFileSync("git", argv, {
    cwd: ROOT,
    encoding,
    maxBuffer: 1 << 28,
    env: gitEnv(),
  });
}

export function computeDiffDigest(base, head) {
  return diffDigest(canonicalizeRawDiff(git(canonicalDiffArgs(base, head), null)));
}

/**
 * `git merge-base --is-ancestor` uses exit status as its answer: 0 is yes and 1
 * is no. Any other status is git failing to answer, which must not be read as
 * "not an ancestor" — that would turn an unreadable repository into a stale
 * review verdict (exit 1) instead of an invocation error (exit 2).
 */
export function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: gitEnv(),
  });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `git merge-base --is-ancestor ${ancestor} ${descendant} failed (status ${result.status}): ${result.stderr.trim()}`,
  );
}

export function changedPathsBetween(from, to) {
  // A `.gitmodules` `ignore = all` hides gitlink records from every diff, and
  // `-c diff.ignoreSubmodules=none` does not override it. Without
  // `--ignore-submodules=none` a post-review submodule bump would be absent
  // here as well as in the digest, so the "only review evidence changed" rule
  // would pass over real content.
  const out = git([
    "-c", "core.quotepath=false",
    "diff", "--name-only", "--no-renames", "--ignore-submodules=none", from, to,
  ]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function commitsBetween(from, to) {
  const out = git(["rev-list", "--reverse", `${from}..${to}`]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function changedPathsInCommit(commit) {
  const out = git([
    "-c", "core.quotepath=false",
    "diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames",
    "--ignore-submodules=none", commit,
  ]);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function resolveCommit(ref) {
  return git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

/**
 * Read a path as it exists in a commit.
 *
 * Three outcomes must stay distinguishable, because two of them are not review
 * verdicts at all:
 *   - the blob exists                     → its contents
 *   - the path is absent from the commit  → `null` (real "no evidence" verdict)
 *   - git cannot answer (bad object, I/O) → throw (invocation error, exit 2)
 *
 * `git show` alone collapses the middle and last cases into a non-zero exit
 * with a message nobody parses, which turns an unreadable repository into an
 * ordinary "missing review evidence" result.
 */
export function readCommittedFile(head, path) {
  const listed = spawnSync("git", ["ls-tree", "-z", "--name-only", head, "--", path], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: gitEnv(),
  });
  if (listed.error) throw listed.error;
  if (listed.status !== 0) {
    throw new Error(`git ls-tree ${head} -- ${path} failed (status ${listed.status}): ${listed.stderr.trim()}`);
  }
  if (!listed.stdout.split("\0").filter(Boolean).includes(path)) return null;
  return git(["show", `${head}:${path}`]);
}

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pure verdict function. Every fact it needs is passed in, so the tests can
 * exercise each rule without a real repository.
 *
 * @param {{
 *   evidence: unknown,
 *   expectedPr?: number,
 *   headSha?: string,
 *   diffSha256?: string,
 *   reviewIsAncestor?: boolean,
 *   changedSinceReview?: string[],
 * }} input
 * @returns {string[]} errors
 */
export function validateReviewEvidence({
  evidence,
  expectedPr,
  headSha,
  diffSha256,
  reviewIsAncestor,
  changedSinceReview = [],
}) {
  const errors = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return ["review evidence must be a JSON object"];
  }

  if (evidence.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, got \`${JSON.stringify(evidence.schemaVersion)}\``);
  }
  if (!Number.isInteger(evidence.pr) || evidence.pr <= 0) {
    errors.push("`pr` must be a positive integer");
  } else if (expectedPr !== undefined && evidence.pr !== expectedPr) {
    errors.push(`evidence is for PR #${evidence.pr}, but this run is for PR #${expectedPr}`);
  }

  if (typeof evidence.reviewedHeadSha !== "string" || !SHA1.test(evidence.reviewedHeadSha)) {
    errors.push("`reviewedHeadSha` must be a 40-character lowercase commit SHA");
  }
  if (typeof evidence.diffSha256 !== "string" || !SHA256.test(evidence.diffSha256)) {
    errors.push("`diffSha256` must be a 64-character lowercase sha256");
  } else if (diffSha256 !== undefined && evidence.diffSha256 !== diffSha256) {
    errors.push(
      `recorded diffSha256 does not match the PR diff (recorded ${evidence.diffSha256.slice(0, 12)}…, ` +
        `computed ${diffSha256.slice(0, 12)}…) — the reviewed content changed, re-review it`,
    );
  }
  if (reviewIsAncestor === false) {
    errors.push(
      "the reviewed head is not an ancestor of the PR head — a rebase or force-push invalidated the review; re-review the current head",
    );
  }

  const author = evidence.author ?? {};
  if (!nonEmptyString(author.agentId)) errors.push("`author.agentId` is required: the review must attribute who wrote the change it judges");

  const reviewer = evidence.reviewer ?? {};
  if (!REVIEWER_KINDS.includes(reviewer.kind)) {
    errors.push(
      `\`reviewer.kind\` must be one of ${REVIEWER_KINDS.map((k) => `\`${k}\``).join(", ")} — ` +
        "human security acceptance is not recordable in this file",
    );
  }
  if (!nonEmptyString(reviewer.agentId)) errors.push("`reviewer.agentId` is required");
  if (!nonEmptyString(reviewer.model)) errors.push("`reviewer.model` is required");
  if (reviewer.context !== "fresh") {
    errors.push("`reviewer.context` must be `fresh`: a review in the author's context is not a second check");
  }
  if (nonEmptyString(reviewer.agentId) && reviewer.agentId === author.agentId) {
    errors.push("`reviewer.agentId` equals `author.agentId` — a self-review is not a separate session");
  }

  const acceptance = evidence.humanSecurityAcceptance;
  if (acceptance !== false) {
    errors.push(
      "`humanSecurityAcceptance` must be `false`: this record cannot discharge human security acceptance " +
        "or the GE-04 hold, and claiming it is the one thing this file must never do",
    );
  }

  if (!VERDICTS.includes(evidence.verdict)) {
    errors.push(`\`verdict\` must be one of ${VERDICTS.map((v) => `\`${v}\``).join(", ")}`);
  } else if (evidence.verdict === "request-changes") {
    errors.push("the reviewer requested changes — the gate stays red until a review of the fixed head approves it");
  }

  if (!Array.isArray(evidence.findings)) {
    errors.push("`findings` must be an array (empty is allowed and means no findings)");
  } else {
    const ids = new Set();
    for (const [i, finding] of evidence.findings.entries()) {
      const at = `findings[${i}]`;
      if (!finding || typeof finding !== "object") {
        errors.push(`${at} must be an object`);
        continue;
      }
      if (!nonEmptyString(finding.id)) {
        errors.push(`${at}.id is required`);
      } else if (ids.has(finding.id)) {
        errors.push(`${at}.id \`${finding.id}\` is duplicated`);
      } else {
        ids.add(finding.id);
      }
      if (!nonEmptyString(finding.title)) errors.push(`${at}.title is required`);
      if (!FINDING_SEVERITIES.includes(finding.severity)) {
        errors.push(`${at}.severity must be one of ${FINDING_SEVERITIES.map((s) => `\`${s}\``).join(", ")}`);
      }
      if (!FINDING_STATUSES.includes(finding.status)) {
        errors.push(
          `${at}.status must be one of ${FINDING_STATUSES.map((s) => `\`${s}\``).join(", ")} ` +
            "— an open finding blocks the merge",
        );
        continue;
      }
      if (!nonEmptyString(finding.resolution)) errors.push(`${at}.resolution is required: state what was done or why it is safe`);
      if (finding.status === "accepted-risk") {
        if (finding.severity === "high" || finding.severity === "critical") {
          if (!nonEmptyString(finding.operatorDecision)) {
            errors.push(
              `${at} accepts a ${finding.severity}-severity risk without \`operatorDecision\` — ` +
                "accepting that risk is a human decision, not a reviewer default",
            );
          }
        }
      }
    }
  }

  if (changedSinceReview.length) {
    const offending = changedSinceReview.filter((p) => !REVIEW_EVIDENCE_PATTERN.test(p));
    if (offending.length) {
      errors.push(
        `content changed after the reviewed head: ${offending.slice(0, 5).join(", ")}` +
          (offending.length > 5 ? `, and ${offending.length - 5} more` : "") +
          " — only review evidence may be added after a review; re-review the change",
      );
    }
  }

  return errors;
}

function parseArgs(argv) {
  const get = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const prRaw = get("--pr") ?? process.env.PR_NUMBER ?? null;
  return {
    pr: prRaw === null ? null : Number(prRaw),
    base: get("--base") ?? process.env.PR_BASE_SHA ?? null,
    head: get("--head") ?? process.env.PR_HEAD_SHA ?? null,
    evidence: get("--evidence"),
    print: argv.includes("--print"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  const fail = (message) => {
    console.error(`::error::${message}`);
    process.exit(2);
  };

  if (!Number.isInteger(args.pr) || args.pr <= 0) fail("--pr (or PR_NUMBER) must be a positive integer");
  if (!args.base) fail("--base (or PR_BASE_SHA) is required");
  // `--print` is the author-side helper that produces the digest to record, and
  // the natural head there is the current commit. The gate itself is never
  // allowed to guess: CI must state the exact head it is judging.
  if (!args.head && !args.print) fail("--head (or PR_HEAD_SHA) is required");
  if (!args.head && args.print) args.head = "HEAD";

  let baseSha;
  let headSha;
  try {
    baseSha = resolveCommit(args.base);
    headSha = resolveCommit(args.head);
  } catch (error) {
    fail(`could not resolve ${args.base}...${args.head}: ${error.message}`);
  }

  let diffSha256;
  try {
    diffSha256 = computeDiffDigest(baseSha, headSha);
  } catch (error) {
    fail(`could not compute the ${baseSha}...${headSha} diff: ${error.message}`);
  }

  const evidencePath = args.evidence ?? evidencePathFor(args.pr);

  if (args.print) {
    console.log(
      JSON.stringify(
        {
          pr: args.pr,
          reviewedHeadSha: headSha,
          diffSha256,
          evidencePath,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  let evidenceText;
  try {
    evidenceText = readCommittedFile(headSha, evidencePath);
  } catch (error) {
    fail(`could not read ${evidencePath} at ${headSha.slice(0, 12)}…: ${error.message}`);
  }
  if (evidenceText === null) {
    console.error(`::error::missing review evidence at ${evidencePath}`);
    console.error(
      `::error::commit the review evidence at ${headSha.slice(0, 12)}…; a working-tree copy is not evidence. ` +
        `run \`node scripts/check-review-evidence.mjs --print --pr ${args.pr} --base ${args.base} --head ${args.head}\` for the digest`,
    );
    process.exit(1);
  }

  let evidence;
  try {
    evidence = JSON.parse(evidenceText);
  } catch (error) {
    console.error(`::error::${evidencePath} is not valid JSON: ${error.message}`);
    process.exit(1);
  }

  const reviewed = evidence?.reviewedHeadSha;
  let reviewIsAncestor;
  let changedSinceReview = [];
  let evidenceCommits = [];
  try {
    reviewIsAncestor = SHA1.test(String(reviewed)) ? isAncestor(reviewed, headSha) : undefined;
    if (reviewIsAncestor) {
      changedSinceReview = changedPathsBetween(reviewed, headSha);
      evidenceCommits = commitsBetween(reviewed, headSha)
        .map((sha) => ({ sha, paths: changedPathsInCommit(sha) }))
        .filter(({ paths }) => paths.includes(evidencePath));
    }
  } catch (error) {
    // A git failure is not evidence about the review. Report it as an
    // invocation error so a transient repository problem cannot be recorded as
    // a stale or valid review verdict.
    fail(`could not verify the reviewed head ${String(reviewed).slice(0, 12)}…: ${error.message}`);
  }
  const errors = validateReviewEvidence({
    evidence,
    expectedPr: args.pr,
    headSha,
    diffSha256,
    reviewIsAncestor,
    changedSinceReview,
  });

  if (reviewIsAncestor && !evidenceCommits.length) {
    errors.push(
      `${evidencePath} was not added or updated after the reviewed head ${reviewed.slice(0, 12)}… — ` +
        "review candidate code first, then commit the review evidence separately",
    );
  }
  for (const { sha, paths } of evidenceCommits) {
    const offending = paths.filter((path) => !REVIEW_EVIDENCE_PATTERN.test(path));
    if (offending.length) {
      errors.push(
        `evidence commit ${sha.slice(0, 12)}… also changed reviewed content: ${offending.slice(0, 5).join(", ")}` +
          (offending.length > 5 ? `, and ${offending.length - 5} more` : "") +
          " — commit review evidence separately",
      );
    }
  }

  for (const error of errors) console.error(`::error::${error}`);
  if (errors.length) process.exit(1);
  console.log(`Review evidence OK (${evidencePath}, verdict ${evidence.verdict}, ${evidence.findings.length} finding(s))`);
}
