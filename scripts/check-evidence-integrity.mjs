#!/usr/bin/env node
/**
 * Evidence integrity: a checked-in evidence artifact must postdate the thing it
 * describes, and must not move in the same commit as its own generator.
 *
 * The failure this exists to catch is not a wrong number in a JSON file. It is
 * the one demonstrated by hand during the 2026-11-13 review: edit
 * `scripts/check-ge04-*.py` so it emits a friendlier artifact, edit the artifact
 * to match, commit both — and the suite goes green. Nothing in the repository
 * objected, because every check compared the artifact to the generator, and both
 * had just been rewritten together. A checker can only vouch for the relation
 * between two things; it cannot vouch for either being the original.
 *
 * So this check does not re-verify the numbers. It verifies *provenance order*
 * over git history, which is the part a same-commit edit destroys:
 *
 *   1. COVERAGE   every file matched by the manifest's `coverage` globs is
 *                 listed. An unlisted artifact is unreviewed evidence, which
 *                 reads exactly like evidence that does not exist.
 *   2. CONTENT    every listed artifact and generator hash matches the file on
 *                 disk. Cheap, and it makes the manifest a real index rather
 *                 than a list of names.
 *   3. ORDER      the commit that last touched an artifact must be a strict
 *                 descendant of the commit that last touched its generator, and
 *                 of every source it `describes`. Evidence records a state that
 *                 already existed; it may not be created alongside it.
 *   4. MARKERS    a commit SHA that an artifact records about itself
 *                 (`sourceCommit`, `baseCommit`, `reviewed_revision`, …) must be
 *                 a real commit, and must be an ancestor of — never equal to —
 *                 the commit that carries the artifact. An artifact cannot claim
 *                 to describe its own commit.
 *   5. REFLEXIVITY this checker and the manifest may not be last touched by the
 *                 same commit. Otherwise the way to disable a finding is to edit
 *                 the rule and the data together, which is failure #1 one level
 *                 up.
 *   6. INDEX      the manifest must postdate every artifact it indexes. The
 *                 manifest's sha256 is not a security control on its own: it is
 *                 written by whoever writes the artifact, so editing both in one
 *                 commit produces a pair that agrees with itself. Requiring the
 *                 index to move in a later commit breaks that single-commit
 *                 shape; the artifact change and the claim that it is unchanged
 *                 can no longer be the same event.
 *
 * ORDER uses ancestry (`git merge-base --is-ancestor`), not commit timestamps.
 * Timestamps are rewritten by rebase and cherry-pick, so a rebased artifact could
 * look older than its own source and produce a finding about history that no
 * longer exists. Reachability through the commit graph is the property that
 * actually means "this existed first", and it survives a rewrite.
 *
 * Honest limits, stated so no reader mistakes this for more than it is:
 *
 *   - Order is a *social* control, not a cryptographic one. A determined author
 *     can launder an edit across three commits (source, generator, artifact) and
 *     this check passes. What it removes is the cheap one-commit version, and it
 *     leaves the three-commit version visible in history as a pattern a reviewer
 *     can grep for. It is a cost and a signal, not a proof.
 *   - It says nothing about whether the artifact's *content* is correct. That is
 *     the generator's claim; `--recompute` re-runs each generator and fails on
 *     drift, which is the strongest content check available offline.
 *   - It is not independent acceptance. No ordering property can substitute for
 *     a reviewer who did not write the code. See `docs/security/AGENTS.md`.
 *
 * Artifact classes, because "has a generator" is not universally true:
 *
 *   - `generator`  a checked-in script emits this file. `producedBy` is required,
 *                  `--recompute` re-runs it, and a diff is a failure.
 *   - `attested`   a human or agent recorded an observation. There is no
 *                  generator to re-run; provenance is a required statement of how
 *                  the file came to exist, and the `describes`/MARKERS checks
 *                  still apply. Pretending such a file is machine-generated would
 *                  be the exact overstatement this script exists to prevent.
 *
 * A missing git repository is an invocation error (exit 2), never a pass. With no
 * history every ordering question is unanswerable, and reporting "ok" because
 * nothing could be checked is the silent-pass failure this file is about.
 *
 * Usage:
 *   node scripts/check-evidence-integrity.mjs [--root <dir>] [--manifest <path>]
 *        [--json] [--recompute] [--max-recompute-skipped <n>]
 *        [--allow-declared-skips]
 *        [--pending-commit-tolerant]
 *
 * `--max-recompute-skipped <n>` is the shrink-only counterpart of
 * `--max-accepted` for generators that declare `recompute: false`. Such a
 * generator is never re-run, so a `--recompute` run that includes it cannot pass
 * *for that artifact* — the verdict stays `not_checked`. This flag turns that
 * honest absence into a reviewed number instead of an invisible one: growing the
 * set of generators exempt from regeneration fails the build, and shrinking it
 * requires the pin to be lowered on purpose. Requires `--recompute`.
 *
 * A `not_checked` verdict exits 1. That includes a recompute run whose declared
 * skip set matches its pin: the run proved nothing about those artifacts, and a
 * zero exit would let CI report success for work it did not perform. CI
 * acknowledges exactly that bounded absence with `--allow-declared-skips`, which
 * is accepted only together with `--max-recompute-skipped` and only when every
 * unchecked reason is a declared skip AND the run recorded no blocking finding.
 * That second condition is the load-bearing one: an acknowledgement cannot
 * launder a real finding, because a verdict that already failed is never
 * upgraded. Any other `not_checked` reason still fails, so the acknowledgement
 * cannot widen to uncommitted evidence, an empty manifest, or an unreadable tree.
 *
 * `--pending-commit-tolerant` downgrades an uncommitted artifact or generator
 * from a finding to an explicit NOT CHECKED result. It exists for the pre-commit
 * preflight and the pre-push hook, where evidence is expected to be dirty. It
 * never reports a pass: the verdict becomes `not_checked` and says so. CI runs
 * strict.
 *
 * Exit codes: 0 pass, 1 findings or not-checked, 2 invocation/environment error.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const jsonMode = argv.includes("--json");
const recompute = argv.includes("--recompute");
const pendingCommitTolerant = argv.includes("--pending-commit-tolerant");
const maxAcceptedArg = getArg("--max-accepted");
const maxAccepted = maxAcceptedArg === null ? null : Number(maxAcceptedArg);
const maxRecomputeSkippedArg = getArg("--max-recompute-skipped");
const maxRecomputeSkipped = maxRecomputeSkippedArg === null ? null : Number(maxRecomputeSkippedArg);
const allowDeclaredSkips = argv.includes("--allow-declared-skips");

const root = resolve(getArg("--root") ?? process.cwd());
const manifestPath = resolve(root, getArg("--manifest") ?? "docs/security/evidence-manifest.json");

const toRepoPath = (absolute) => relative(root, absolute).split("\\").join("/");

/** Invocation errors exit 2 so a misconfigured run is never read as a clean one. */
function usage(message) {
  const payload = { ok: false, verdict: "error", error: message, exitCode: 2 };
  if (jsonMode) console.error(JSON.stringify(payload, null, 2));
  else console.error(`ERROR: ${message}`);
  process.exit(2);
}

if (maxRecomputeSkippedArg !== null && !recompute) {
  usage("--max-recompute-skipped requires --recompute; without it there is no skip set to bound");
}
if (allowDeclaredSkips && maxRecomputeSkippedArg === null) {
  usage("--allow-declared-skips requires --max-recompute-skipped; an acknowledgement without a bounded skip set is unbounded");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Every git read below decides WHAT HISTORY EXISTS: which commit last touched an
 * artifact, whether one commit is an ancestor of another, whether a commit is
 * present. `git replace <sha> <synthetic>` makes a ref resolve to a commit
 * nobody committed, so `lastCommit` returned the replacement commit and this
 * checker certified a real order defect (artifact and generator sharing a
 * commit) as `pass`. Replacement objects are disabled for every invocation.
 */
const gitEnv = () => ({ ...process.env, GIT_NO_REPLACE_OBJECTS: "1" });

const gitText = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28, env: gitEnv() }).trim();

try {
  gitText(["rev-parse", "--git-dir"]);
} catch (error) {
  usage(
    `git is unavailable in ${root} (${error instanceof Error ? error.message.split("\n")[0] : String(error)}). ` +
      "Every ordering question needs history; with none, this check cannot pass. " +
      "Run it inside the repository, or ensure the checkout contains .git.",
  );
}

/**
 * Last commit that touched a repository-relative path, or null when the path is
 * untracked.
 *
 * A path that has never been committed cannot have a verifiable order, so it is
 * reported rather than treated as "infinitely old" — treating it as old would
 * make an uncommitted artifact pass every ordering comparison it participates
 * in, which is precisely backwards.
 */
function lastCommit(relPath) {
  try {
    const out = gitText(["log", "-1", "--format=%H", "--", relPath]);
    return out || null;
  } catch {
    return null;
  }
}

/** True when `ancestor` is reachable from `descendant`. A commit is its own ancestor. */
function isAncestor(ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    encoding: "utf8",
    env: gitEnv(),
  });
  if (result.error) {
    usage(`could not run git merge-base: ${result.error.message}`);
  }
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  usage(
    `git merge-base --is-ancestor ${ancestor.slice(0, 12)} ${descendant.slice(0, 12)} failed ` +
      `(status ${result.status}): ${(result.stderr ?? "").trim()}`,
  );
  return false;
}

function commitExists(sha) {
  const result = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
    cwd: root,
    encoding: "utf8",
    env: gitEnv(),
  });
  if (result.error) usage(`could not run git cat-file: ${result.error.message}`);
  return result.status === 0;
}

const short = (sha) => (typeof sha === "string" ? sha.slice(0, 12) : String(sha));

function sha256File(absolute) {
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

// ---------------------------------------------------------------------------
// Glob support (manifest coverage)
// ---------------------------------------------------------------------------

/**
 * Supported syntax, deliberately minimal: `**` crosses directories, `*` and `?`
 * stay within one segment, everything else is literal. A hidden glob dependency
 * would let the manifest's coverage mean something the reader cannot check by
 * eye, so the subset is spelled out and the compiler is here.
 */
function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const followedBySlash = glob[i + 2] === "/";
        out += followedBySlash ? "(?:.*/)?" : ".*";
        i += followedBySlash ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp(out + "$");
}

/** Every regular file under root, skipping VCS metadata and dependency trees. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const findings = [];
const add = (check, path, detail, subject = null) => findings.push({ check, path, detail, subject });

if (!existsSync(manifestPath)) {
  usage(
    `manifest not found at ${toRepoPath(manifestPath) || manifestPath}. ` +
      "The manifest is what makes an artifact's absence detectable; without it, " +
      "deleting the manifest would silence every finding.",
  );
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  usage(`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const manifestRepoPath = toRepoPath(manifestPath);
const coverage = Array.isArray(manifest.coverage) ? manifest.coverage : [];
const generatorPaths = Array.isArray(manifest.generators) ? manifest.generators : [];
const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
const notCovered = Array.isArray(manifest.notCovered) ? manifest.notCovered : [];
const exceptions = Array.isArray(manifest.exceptions) ? manifest.exceptions : [];

/**
 * `notCovered` is the manifest's only way to say "this file exists and is
 * deliberately outside the contract". It is not a way to silence a file: every
 * entry needs a reason, must name a real path, and is printed on every run so a
 * reviewer sees the boundary instead of a shorter artifact list.
 */
const notCoveredPaths = new Map();
for (const entry of notCovered) {
  const path = typeof entry === "string" ? entry : entry?.path;
  const reason = typeof entry === "string" ? "" : entry?.reason;
  if (typeof path !== "string" || !path.trim()) {
    add("coverage", manifestRepoPath, "`notCovered` entry without a `path`");
    continue;
  }
  if (typeof reason !== "string" || !reason.trim()) {
    add("coverage", path, "`notCovered` entry without a `reason` — an unexplained exclusion is indistinguishable from a missing artifact");
    continue;
  }
  // A placeholder satisfies "non-empty" while explaining nothing, so the shape
  // of a real reason is enforced: a sentence, not a token.
  if (reason.trim().length < 20 || /^(n\/?a|none|tbd|todo|later|skip|excluded|ignore|\.+)$/i.test(reason.trim())) {
    add(
      "coverage",
      path,
      `\`notCovered\` reason \`${reason.trim()}\` does not explain why the file is outside the contract; ` +
        "state what it is and what covers it instead",
    );
    continue;
  }
  if (notCoveredPaths.has(path)) add("coverage", path, "appears in `notCovered` more than once");
  notCoveredPaths.set(path, reason);
}

// -- 1. Coverage -----------------------------------------------------------

const listedArtifactPaths = new Set();
for (const artifact of artifacts) {
  if (!artifact || typeof artifact.path !== "string") {
    add("coverage", manifestRepoPath, "artifact entry without a string `path`");
    continue;
  }
  if (listedArtifactPaths.has(artifact.path)) add("coverage", artifact.path, "listed more than once");
  listedArtifactPaths.add(artifact.path);
}

if (coverage.length) {
  const matchers = coverage.map(globToRegExp);
  for (const candidate of walk(root).map(toRepoPath)) {
    if (!matchers.some((re) => re.test(candidate))) continue;
    // The manifest cannot list itself: its own sha256 would change the moment it
    // is edited, so self-inclusion is unrepresentable rather than skipped.
    if (candidate === manifestRepoPath) continue;
    if (listedArtifactPaths.has(candidate)) continue;
    if (notCoveredPaths.has(candidate)) continue;
    add(
      "coverage",
      candidate,
      "matched by a coverage glob but absent from the manifest — record it (path, sha256, class, describes), or list it under `notCovered` with a reason",
    );
  }
}

for (const path of listedArtifactPaths) {
  if (!existsSync(join(root, path))) add("coverage", path, "listed in the manifest but missing from disk");
  if (notCoveredPaths.has(path)) {
    add("coverage", path, "is both a claimed artifact and `notCovered`; a file is inside the contract or outside it, not both");
  }
}
for (const path of notCoveredPaths.keys()) {
  if (!existsSync(join(root, path))) {
    add("coverage", path, "is `notCovered` but missing from disk — a stale exclusion hides nothing and should be deleted");
  }
}

/**
 * A generator entry is either a path, or `{path, recompute: false, reason}`.
 *
 * `recompute: false` exists because "has a generator" and "can be regenerated
 * now" are different claims. A generator that prints to stdout, embeds the
 * source commit, or requires an `--output` argument cannot be re-run blind; a
 * check that ran it anyway would either fail on a healthy tree or pass without
 * comparing anything. Declaring that explicitly is honest; silently skipping it
 * would read as a passed recompute.
 */
const generatorSet = new Set();
const generatorMeta = new Map();
for (const generator of generatorPaths) {
  const path = typeof generator === "string" ? generator : generator?.path;
  if (typeof path !== "string" || !path.trim()) {
    add("coverage", manifestRepoPath, "`generators` entry without a string path");
    continue;
  }
  if (generatorSet.has(path)) add("coverage", path, "listed as a generator more than once");
  generatorSet.add(path);
  const meta = typeof generator === "string" ? {} : generator;
  if (meta.recompute === false && (typeof meta.reason !== "string" || !meta.reason.trim())) {
    add("coverage", path, "`recompute: false` requires a `reason`; an unexplained skip is a passed recompute that never ran");
  }
  generatorMeta.set(path, meta);
  if (!existsSync(join(root, path))) add("coverage", path, "listed as a generator but missing from disk");
}

for (const artifact of artifacts) {
  if (!artifact || typeof artifact.path !== "string") continue;
  const kind = artifact.class ?? (artifact.producedBy ? "generator" : "attested");
  if (kind === "generator") {
    if (!artifact.producedBy) {
      add("coverage", artifact.path, "class `generator` requires `producedBy`");
    } else if (!generatorSet.has(artifact.producedBy)) {
      add(
        "coverage",
        artifact.path,
        `producedBy \`${artifact.producedBy}\` is not in the manifest's \`generators\` list, so its history is untracked`,
      );
    }
  } else if (kind === "attested") {
    if (artifact.producedBy) {
      add("coverage", artifact.path, "class `attested` must not declare `producedBy`; pick one class");
    }
    if (typeof artifact.provenance !== "string" || !artifact.provenance.trim()) {
      add(
        "coverage",
        artifact.path,
        "class `attested` requires a `provenance` statement describing how the file came to exist",
      );
    }
  } else {
    add("coverage", artifact.path, `unknown class \`${String(kind)}\` (expected \`generator\` or \`attested\`)`);
  }
}

// -- 2. Content ------------------------------------------------------------

const hashes = new Map();
function verifyHash(repoPath, declared, kind) {
  const absolute = join(root, repoPath);
  if (!existsSync(absolute)) return;
  let actual;
  try {
    actual = sha256File(absolute);
  } catch (error) {
    add("content", repoPath, `${kind} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  hashes.set(repoPath, actual);
  if (typeof declared !== "string" || !/^[0-9a-f]{64}$/.test(declared)) {
    add("content", repoPath, `${kind} has no valid sha256 in the manifest`);
  } else if (declared !== actual) {
    add("content", repoPath, `${kind} hash drifted: manifest ${short(declared)}…, disk ${short(actual)}…`);
  }
}

for (const artifact of artifacts) {
  if (!artifact || typeof artifact.path !== "string") continue;
  verifyHash(artifact.path, artifact.sha256, "artifact");
}
for (const generator of generatorSet) verifyHash(generator, manifest.generatorSha256?.[generator], "generator");

// -- 3. Order --------------------------------------------------------------

const pendingCommit = [];

/**
 * Evidence must postdate its subject. "Postdate" is checked as strict graph
 * descent, so a shared commit and a backwards commit are both findings, and a
 * rebase cannot manufacture one.
 */
function requireOrder(artifactPath, subjectPath, relation) {
  const after = lastCommit(artifactPath);
  if (!after) {
    pendingCommit.push({ path: artifactPath, relation, other: subjectPath });
    return;
  }
  const before = lastCommit(subjectPath);
  if (!before) {
    add("order", artifactPath, `describes \`${subjectPath}\`, which has no commit history`, {
      relation,
      subject: subjectPath,
      artifactCommit: after,
      subjectCommit: null,
      markerValue: null,
    });
    return;
  }
  if (after === before) {
    add(
      "order",
      artifactPath,
      `shared its last commit with ${relation} \`${subjectPath}\` (${short(after)}) — ` +
        "evidence must postdate what it records, in a separate commit",
      { relation, subject: subjectPath, artifactCommit: after, subjectCommit: before, markerValue: null },
    );
    return;
  }
  if (!isAncestor(before, after)) {
    add(
      "order",
      artifactPath,
      `is not descended from ${relation} \`${subjectPath}\` (artifact ${short(after)}, subject ${short(before)}) — ` +
        "an artifact that does not descend from its subject records a state that is not in its history",
      { relation, subject: subjectPath, artifactCommit: after, subjectCommit: before, markerValue: null },
    );
  }
}

for (const artifact of artifacts) {
  if (!artifact || typeof artifact.path !== "string") continue;
  if (artifact.producedBy) requireOrder(artifact.path, artifact.producedBy, "its generator");
  for (const source of Array.isArray(artifact.describes) ? artifact.describes : []) {
    if (typeof source !== "string") {
      add("order", artifact.path, "`describes` entry that is not a string path");
      continue;
    }
    requireOrder(artifact.path, source, "a recorded source");
  }
}

// -- 4. Self-recorded commit markers ---------------------------------------

/**
 * Several artifacts carry a commit SHA about themselves. That is a provenance
 * claim already in the data, so it costs nothing to verify: the SHA must exist,
 * and it must be an ancestor of the commit carrying the artifact. Equality is a
 * finding rather than a pass — an artifact asserting it describes its own commit
 * is claiming the state and the record of the state are the same event.
 */
const MARKER_KEYS = ["sourceCommit", "baseCommit", "sourceBaseCommit", "reviewed_revision", "source_commit"];

for (const artifact of artifacts) {
  if (!artifact || typeof artifact.path !== "string") continue;
  const absolute = join(root, artifact.path);
  if (!existsSync(absolute)) continue;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    continue; // not JSON, or not parseable: content checking owns that, not here
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

  const carriers = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (MARKER_KEYS.includes(key) && typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value)) {
      carriers.push({ key, value });
    }
  }
  if (!carriers.length) continue;

  const artifactCommit = lastCommit(artifact.path);
  if (!artifactCommit) {
    pendingCommit.push({ path: artifact.path, relation: "its own commit markers", other: MARKER_KEYS.join("/") });
    continue;
  }
  for (const { key, value } of carriers) {
    if (!commitExists(value)) {
      add("markers", artifact.path, `\`${key}\` names ${short(value)}, which is not a commit in this repository`, {
        relation: "marker",
        subject: key,
        artifactCommit,
        subjectCommit: null,
        markerValue: value,
      });
      continue;
    }
    if (value === artifactCommit) {
      add(
        "markers",
        artifact.path,
        `\`${key}\` is the artifact's own commit (${short(value)}) — evidence cannot record the commit that creates it`,
        { relation: "marker", subject: key, artifactCommit, subjectCommit: value, markerValue: value },
      );
    } else if (!isAncestor(value, artifactCommit)) {
      add(
        "markers",
        artifact.path,
        `\`${key}\` names ${short(value)}, which is not an ancestor of the artifact's commit (${short(artifactCommit)}) — ` +
          "the recorded state is not in this artifact's history",
        { relation: "marker", subject: key, artifactCommit, subjectCommit: value, markerValue: value },
      );
    }
  }
}

// -- 4b. Index ordering ----------------------------------------------------

/**
 * The manifest records a sha256 per artifact. That hash proves nothing about
 * intent by itself: it is computed from whatever is on disk when it is written.
 * Changing an artifact and its recorded hash in one commit makes every content
 * comparison self-consistent — the same failure the generator rule catches, one
 * level up. So the index must be a later event than the thing it indexes.
 *
 * The cost is stated plainly: a new or changed artifact takes one commit for the
 * artifact and another for its manifest entry. That is the friction this check
 * buys, and it is visible in history as two linked commits rather than one.
 */
{
  const manifestCommit = manifestRepoPath ? lastCommit(manifestRepoPath) : null;
  if (!manifestCommit) {
    pendingCommit.push({ path: manifestRepoPath, relation: "the artifacts it indexes", other: "all listed artifacts" });
  } else {
    for (const artifact of artifacts) {
      if (!artifact || typeof artifact.path !== "string") continue;
      const artifactCommit = lastCommit(artifact.path);
      if (!artifactCommit) {
        pendingCommit.push({ path: artifact.path, relation: "its manifest entry", other: manifestRepoPath });
        continue;
      }
      if (artifactCommit === manifestCommit) {
        add(
          "index",
          artifact.path,
          `was indexed in the same commit that last changed it (${short(manifestCommit)}) — ` +
            "the manifest records a hash of whatever it is committed with, so this pair cannot disagree; " +
            "commit the artifact first, then its manifest entry",
          { relation: "manifest", subject: manifestRepoPath, artifactCommit, subjectCommit: manifestCommit, markerValue: null },
        );
        continue;
      }
      if (!isAncestor(artifactCommit, manifestCommit)) {
        add(
          "index",
          artifact.path,
          `is not an ancestor of the manifest that indexes it (artifact ${short(artifactCommit)}, manifest ${short(manifestCommit)}) — ` +
            "the index records a state that is not in its history",
          { relation: "manifest", subject: manifestRepoPath, artifactCommit, subjectCommit: manifestCommit, markerValue: null },
        );
      }
    }
  }
}

// -- 5. Reflexivity --------------------------------------------------------

const selfCommit = lastCommit("scripts/check-evidence-integrity.mjs");
if (selfCommit) {
  const manifestCommit = lastCommit(manifestRepoPath);
  if (manifestCommit && manifestCommit === selfCommit) {
    add(
      "reflexivity",
      manifestRepoPath,
      `shared its last commit with the checker (${short(selfCommit)}) — ` +
        "editing the rule and the data together is the same failure one level up",
    );
  }
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.path !== "string") continue;
    if (lastCommit(artifact.path) === selfCommit) {
      add("reflexivity", artifact.path, "shared its last commit with the checker that judges it");
    }
  }
}

// -- Optional: recompute ---------------------------------------------------

const recomputeResults = [];
const generatorArtifacts = artifacts.filter((a) => a && a.producedBy);
if (recompute && generatorArtifacts.length) {
  /**
   * Snapshot every covered path before re-running anything. A generator is
   * allowed to compute; it is not allowed to quietly rewrite the evidence it is
   * being checked against. Comparing before/after catches the `--write` path,
   * where a generator that always rewrites would otherwise look like a pass
   * because the file it wrote agrees with itself.
   */
  const snapshot = new Map();
  for (const path of [...listedArtifactPaths, ...generatorSet]) {
    const absolute = join(root, path);
    if (existsSync(absolute)) snapshot.set(path, sha256File(absolute));
  }

  // Only run a generator whose bytes match the manifest. Otherwise `--recompute`
  // becomes a way to certify a generator that was edited in the same change.
  const runnable = [...generatorSet].filter((generator) => {
    if (generatorMeta.get(generator)?.recompute === false) return false;
    if (!hashes.has(generator)) return false;
    const declared = manifest.generatorSha256?.[generator];
    return typeof declared === "string" && declared === hashes.get(generator);
  });

  for (const generator of generatorSet) {
    if (runnable.includes(generator)) continue;
    const meta = generatorMeta.get(generator) ?? {};
    if (meta.recompute === false) {
      recomputeResults.push({ generator, ok: false, skipped: true, reason: "declared-not-recomputable", detail: meta.reason });
      continue;
    }
    const missing = !existsSync(join(root, generator));
    recomputeResults.push({
      generator,
      ok: false,
      skipped: true,
      reason: missing ? "missing" : "hash-mismatch",
      detail: missing ? "missing from disk" : "hash does not match the manifest; refusing to execute it",
    });
  }

  for (const generator of runnable) {
    const isPython = generator.endsWith(".py");
    const isNode = generator.endsWith(".mjs") || generator.endsWith(".js");
    const command = isPython ? process.env.PYTHON ?? "python3" : isNode ? process.execPath : null;
    if (!command) {
      add("recompute", generator, "unsupported generator type; cannot re-run");
      continue;
    }
    try {
      execFileSync(command, [generator], { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 120_000 });
      recomputeResults.push({ generator, ok: true });
    } catch (error) {
      const detail = (error && typeof error === "object" && "stderr" in error ? String(error.stderr) : String(error))
        .trim()
        .split("\n")
        .slice(-6)
        .join("\n");
      recomputeResults.push({ generator, ok: false, detail });
      add("recompute", generator, "re-ran the generator and it reported drift (see recompute detail)");
    }
  }

  for (const [path, before] of snapshot) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      add("recompute", path, "generator deleted a covered file");
      continue;
    }
    const after = sha256File(absolute);
    if (after !== before) {
      add(
        "recompute",
        path,
        "changed while generators ran — regeneration must be a no-op in a clean tree, " +
          "so the checked-in artifact was not what the source produces",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const checked =
  [...listedArtifactPaths].filter((p) => hashes.has(p)).length + [...generatorSet].filter((p) => hashes.has(p)).length;

const declaredNotRecomputable = [...generatorSet].filter((g) => generatorMeta.get(g)?.recompute === false);

const pending = [...new Map(pendingCommit.map((entry) => [entry.path, entry])).values()];

if (pending.length && !pendingCommitTolerant) {
  for (const entry of pending) {
    add(
      "order",
      entry.path,
      `is not committed, so its order against ${entry.relation} \`${entry.other}\` cannot be verified — commit it`,
    );
  }
}

const notCheckedReasons = [];
const declaredSkipReasonPrefix = "recompute NOT CHECKED for ";
if (pending.length && pendingCommitTolerant) {
  notCheckedReasons.push(
    `order NOT CHECKED for ${pending.length} uncommitted path(s): ${pending
      .map((p) => p.path)
      .slice(0, 5)
      .join(", ")}${pending.length > 5 ? ", …" : ""}. Commit them; pre-push and CI run this strict.`,
  );
}

if (recompute && declaredNotRecomputable.length) {
  notCheckedReasons.push(
    `${declaredSkipReasonPrefix}${declaredNotRecomputable.length} generator(s) declared not recomputable: ${declaredNotRecomputable
      .slice(0, 5)
      .join(", ")}${declaredNotRecomputable.length > 5 ? ", …" : ""}. Their artifacts are hash-pinned and order-checked, not reproduced.`,
  );
}

const orderChecked = artifacts.length > 0 && pending.length === 0;
if (!artifacts.length) {
  notCheckedReasons.push(
    "order vacuous: the manifest lists no artifacts, so nothing was compared. This becomes a real check the moment an artifact is recorded.",
  );
}

// ---------------------------------------------------------------------------
// Retrospective exceptions (shrink-only)
// ---------------------------------------------------------------------------

/**
 * ORDER and MARKERS describe history that already happened. When the rule is
 * introduced, old artifacts are frequently already wrong: the census was
 * committed beside its generator, the pin was authored with its readers. The
 * available fixes are to delete the evidence, rewrite history, or launder a new
 * commit — all worse than recording the defect.
 *
 * So a defect may be accepted, but only in the narrowest possible form. Each
 * exception pins the exact artifact commit AND the exact subject commit (or
 * marker value) it covers. It cannot cover a later commit of the same file,
 * because the pinned hash no longer matches. That makes an exception a
 * statement about one historical event rather than a per-file waiver, which is
 * the difference between a ledger of debt and a hole in the check.
 *
 * Exceptions also may not touch coverage, content, reflexivity or recompute.
 * Those are properties of the current tree that can always be fixed now; only
 * the irreversible record of the past is exceptable.
 *
 * An exception that matches nothing is a finding. A ledger that only grows is
 * how an allowlist stops describing the tree.
 */
const EXCEPTABLE_CHECKS = new Set(["order", "markers"]);
const acceptedExceptions = [];
const unusedExceptions = [];
const exceptionKeys = new Set();

const objectId = (value) => (typeof value === "string" && value ? value : null);
for (const [index, exception] of exceptions.entries()) {
  const where = `exceptions[${index}]`;
  if (!exception || typeof exception !== "object") {
    add("exceptions", manifestRepoPath, `${where} is not an object`);
    continue;
  }
  const missing = ["artifact", "check", "reason"].filter((k) => typeof exception[k] !== "string" || !exception[k].trim());
  if (missing.length) {
    add("exceptions", exception?.artifact ?? manifestRepoPath, `${where} is missing ${missing.join(", ")}`);
    continue;
  }
  // Without an exact commit pin, an exception would match any future defect in
  // the same file — including one the exception was not written about. That is a
  // permanent waiver wearing a ledger entry's clothes.
  if (typeof exception.artifactCommit !== "string" || !/^[0-9a-f]{40}$/i.test(exception.artifactCommit)) {
    add(
      "exceptions",
      exception.artifact,
      `${where} must pin the full 40-character \`artifactCommit\` it was written about`,
    );
    continue;
  }
  if (
    exception.subjectCommit !== undefined &&
    !/^[0-9a-f]{40}$/i.test(String(exception.subjectCommit))
  ) {
    add("exceptions", exception.artifact, `${where} has a \`subjectCommit\` that is not a full commit SHA`);
    continue;
  }
  if (!EXCEPTABLE_CHECKS.has(exception.check)) {
    add(
      "exceptions",
      exception.artifact,
      `${where} tries to except \`${exception.check}\`; coverage, content, reflexivity and recompute describe the current tree and must be fixed, not excepted`,
    );
    continue;
  }
  const key = [exception.check, exception.artifact, exception.relation ?? "", exception.subject ?? ""].join("\u0000");
  if (exceptionKeys.has(key)) {
    add("exceptions", exception.artifact, `${where} duplicates an earlier exception for the same finding`);
    continue;
  }
  exceptionKeys.add(key);
  acceptedExceptions.push({ ...exception, index });
}

const findingKey = (finding) =>
  [finding.check, finding.path, finding.subject?.relation ?? "", finding.subject?.subject ?? ""].join("\u0000");

const survivingFindings = [];
for (const finding of findings) {
  if (!EXCEPTABLE_CHECKS.has(finding.check)) {
    survivingFindings.push(finding);
    continue;
  }
  const match = acceptedExceptions.find(
    (exception) =>
      exception.check === finding.check &&
      exception.artifact === finding.path &&
      (exception.relation ?? "") === (finding.subject?.relation ?? "") &&
      (exception.subject ?? "") === (finding.subject?.subject ?? "") &&
      objectId(exception.artifactCommit) === objectId(finding.subject?.artifactCommit) &&
      objectId(exception.subjectCommit) === objectId(finding.subject?.subjectCommit) &&
      objectId(exception.markerValue) === objectId(finding.subject?.markerValue),
  );
  if (match) {
    match.matched = true;
    survivingFindings.push({
      ...finding,
      accepted: true,
      acceptedBy: `exceptions[${match.index}]`,
      acceptanceReason: match.reason,
    });
  } else {
    survivingFindings.push(finding);
  }
}

for (const exception of acceptedExceptions) {
  if (!exception.matched) {
    unusedExceptions.push(exception);
    survivingFindings.push({
      check: "exceptions",
      path: exception.artifact,
      detail:
        `exceptions[${exception.index}] matched no current finding (check \`${exception.check}\`, ` +
        `artifactCommit ${short(exception.artifactCommit)}) — a stale exception is coverage that does not exist; delete it`,
    });
  }
}

findings.length = 0;
findings.push(...survivingFindings);

const acceptedFindings = findings.filter((f) => f.accepted);

const blockingFindings = findings.filter((f) => !f.accepted);

/**
 * Accepted historical defects are a fourth, distinct outcome rather than a
 * flavour of `not_checked`.
 *
 * They are permanent: the past cannot be re-verified. If they forced
 * `not_checked` on every run, the steady state of a healthy tree would read the
 * same as a run that genuinely could not check something (uncommitted evidence,
 * no artifacts) — and a gate that always says "not checked" stops being read at
 * all. `pass_with_accepted` says: every property of the current tree verified,
 * plus a fixed ledger of past defects that is printed on every run.
 */
let verdict;
if (blockingFindings.length > 0) verdict = "fail";
else if (notCheckedReasons.length) verdict = "not_checked";
else if (acceptedFindings.length) verdict = "pass_with_accepted";
else verdict = "pass";

// Shrink-only ratchet. CI passes the count it expects; adding an exception then
// requires editing CI, which is a reviewer-visible act. Shrinking is always
// allowed, and lowering the pin is what the message asks for.
if (maxAccepted !== null) {
  if (!Number.isInteger(maxAccepted) || maxAccepted < 0) {
    usage(`--max-accepted expects a non-negative integer, got \`${maxAcceptedArg}\``);
  }
  if (acceptedFindings.length > maxAccepted) {
    const finding = {
      check: "exceptions",
      path: manifestRepoPath,
      detail:
        `accepted defects grew from the pinned ${maxAccepted} to ${acceptedFindings.length}; ` +
        "the ledger is shrink-only — fix the defect or get the pin raised deliberately",
    };
    findings.push(finding);
    blockingFindings.push(finding);
    verdict = "fail";
  } else if (acceptedFindings.length < maxAccepted) {
    notCheckedReasons.push(
      `accepted defects dropped to ${acceptedFindings.length} but the run pinned ${maxAccepted}; ` +
        "lower --max-accepted so the ratchet tightens",
    );
    verdict = "fail";
  }
}

// The recompute equivalent. `--recompute` cannot pass for a generator that
// declares itself non-reproducible, so the honest outcome is `not_checked`.
// Without a pinned count that state is indistinguishable from someone quietly
// declaring one more generator non-reproducible; with it, that edit fails.
if (maxRecomputeSkipped !== null) {
  if (!Number.isInteger(maxRecomputeSkipped) || maxRecomputeSkipped < 0) {
    usage(`--max-recompute-skipped expects a non-negative integer, got \`${maxRecomputeSkippedArg}\``);
  }
  if (declaredNotRecomputable.length > maxRecomputeSkipped) {
    const finding = {
      check: "recompute",
      path: manifestRepoPath,
      detail:
        `generators declared not recomputable grew from the pinned ${maxRecomputeSkipped} to ` +
        `${declaredNotRecomputable.length}; the skip set is shrink-only — make the generator ` +
        "reproducible or get the pin raised deliberately",
    };
    findings.push(finding);
    blockingFindings.push(finding);
    verdict = "fail";
  } else if (declaredNotRecomputable.length < maxRecomputeSkipped) {
    const finding = {
      check: "recompute",
      path: manifestRepoPath,
      detail:
        `${declaredNotRecomputable.length} generator(s) are declared not recomputable but the run ` +
        `pinned ${maxRecomputeSkipped}; lower --max-recompute-skipped so the ratchet tightens`,
    };
    findings.push(finding);
    blockingFindings.push(finding);
    verdict = "fail";
  }
}

// A bounded declared-skip set is the one absence the caller may acknowledge —
// and only that one, and only in place of `not_checked`. The run then reports
// `pass_with_declared_skips` rather than `pass`, so the acknowledgement stays
// visible in the JSON and in the log instead of collapsing into an unqualified
// success. Every other unchecked reason (uncommitted order, an empty manifest)
// remains a non-zero exit, and a real finding is never acknowledged away: the
// `verdict === "not_checked"` guard is what keeps this from overwriting `fail`.
const onlyDeclaredSkips =
  verdict === "not_checked" &&
  blockingFindings.length === 0 &&
  notCheckedReasons.length > 0 &&
  notCheckedReasons.every((reason) => reason.startsWith(declaredSkipReasonPrefix));
if (allowDeclaredSkips && onlyDeclaredSkips) verdict = "pass_with_declared_skips";

const payload = {
  ok: verdict === "pass" || verdict === "pass_with_accepted" || verdict === "pass_with_declared_skips",
  verdict,
  root,
  manifest: manifestRepoPath,
  coverageGlobs: coverage,
  notCovered: notCovered.map((entry) => (typeof entry === "string" ? entry : `${entry?.path ?? "?"}: ${entry?.reason ?? "no reason"}`)),
  artifactsListed: listedArtifactPaths.size,
  generatorsPinned: generatorSet.size,
  contentVerified: checked,
  orderChecked,
  recomputeSkipped: declaredNotRecomputable.length,
  notChecked: notCheckedReasons,
  pendingCommit: pending,
  accepted: acceptedFindings.map((f) => ({
    check: f.check,
    path: f.path,
    detail: f.detail,
    acceptedBy: f.acceptedBy,
    reason: f.acceptanceReason,
  })),
  unusedExceptions: unusedExceptions.map((e) => ({ path: e.artifact, index: e.index })),
  recompute: recomputeResults,
  findings,
};

if (jsonMode) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  if (verdict === "fail") {
    console.error(`Evidence integrity FAILED — ${blockingFindings.length} finding(s)\n`);
    for (const finding of blockingFindings) {
      console.error(`  [${finding.check}] ${finding.path}`);
      console.error(`      ${finding.detail}`);
    }
    console.error("");
  } else if (verdict === "pass") {
    console.log("Evidence integrity OK");
  } else if (verdict === "pass_with_accepted") {
    console.log(`Evidence integrity OK (${acceptedFindings.length} accepted historical defect(s), listed below)`);
  } else if (verdict === "pass_with_declared_skips") {
    console.log(
      `Evidence integrity OK (${declaredNotRecomputable.length} generator(s) declared not recomputable; ` +
        "their artifacts were hash-pinned and order-checked, not reproduced)",
    );
  } else {
    console.log("Evidence integrity: NOT CHECKED (no findings, but part of the contract was not verified)");
  }
  for (const finding of acceptedFindings) {
    console.log(`ACCEPTED [${finding.check}] ${finding.path} — ${finding.acceptedBy}: ${finding.acceptanceReason}`);
  }
  console.log(
    `artifacts ${listedArtifactPaths.size} · generators ${generatorSet.size} · content verified ${checked} · order ${orderChecked ? "verified" : "not verified"}` +
      (maxRecomputeSkipped === null ? "" : ` · recompute skipped ${declaredNotRecomputable.length} (pinned ${maxRecomputeSkipped})`),
  );
  for (const reason of notCheckedReasons) console.log(`NOT CHECKED: ${reason}`);
  for (const entry of notCovered) {
    const path = typeof entry === "string" ? entry : `${entry?.path ?? "?"}: ${entry?.reason ?? "no reason"}`;
    console.log(`NOT COVERED: ${path}`);
  }
  if (recompute && !generatorArtifacts.length) {
    console.log("recompute: the manifest has no generator-class artifacts; nothing to recompute");
  } else if (recomputeResults.length) {
    const passed = recomputeResults.filter((r) => r.ok).length;
    console.log(`recompute: ${passed}/${recomputeResults.length} generator(s) reported no drift`);
    for (const result of recomputeResults.filter((r) => !r.ok)) {
      const label = result.reason === "declared-not-recomputable" ? "DECLARED NOT RECOMPUTABLE" : result.skipped ? "SKIPPED" : "FAILED";
      console.log(`  ${result.generator}: ${label} — ${result.detail}`);
    }
    const declared = recomputeResults.filter((r) => r.reason === "declared-not-recomputable").length;
    if (declared) {
      console.log(
        `recompute: ${declared} generator(s) declared not recomputable; this run proves nothing about their artifacts`,
      );
    }
  }
}

process.exit(payload.ok ? 0 : 1);
