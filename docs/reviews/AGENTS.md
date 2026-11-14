# docs/reviews — Review Evidence

## Purpose

Committed record of the fresh-context agent review required before merge. Each
file is a verdict about one PR's diff, not a narrative: what was reviewed, by
whom, with what findings, at which commit.

## Ownership

| Path | Contents |
|------|----------|
| `docs/reviews/PR-<n>.json` | One review evidence record per PR, named by PR number |
| `docs/reviews/AGENTS.md` | This contract |

`PR-<n>.json` is the filename shape the checker derives from the PR number; do
not invent alternative names or add indexes, because the gate reads exactly the
derived path from the head commit.

## Local Contracts

- **Read from the head commit.** `scripts/check-review-evidence.mjs` reads
  `git show <head>:docs/reviews/PR-<n>.json`. An uncommitted or working-tree
  copy is not evidence and is rejected as missing.
- **Reviewed head must be an ancestor of the PR head.** A rebase or force-push
  that drops the reviewed commit makes the record stale; re-review the new head.
  The reviewed head may be earlier than the PR head when the only paths changed
  in between are review evidence.
- **Evidence commits are separate.** The record must be added or updated after
  the reviewed head, in a commit that changes nothing outside `docs/reviews/`.
- **Digest binds the change, not a rendering of it.** The record's diff digest
  field is the SHA-256 of the sorted `--raw` commit records for `base...head`
  with `docs/reviews/**` excluded. Exclusion is required — the record is
  committed into the diff it describes. Each record is kept whole as
  `(metadata, path)` and sorted as a pair: sorting metadata and paths as two
  flat fields detaches a path from its blob, and two trees that swap the same
  blob between two paths then hash identically. Paths are hashed as raw bytes,
  never decoded, because decoding collapses distinct non-UTF-8 names onto
  U+FFFD. Raw records name modes, full blob ids and paths, so host-local
  `.git/info/attributes`, `core.attributesFile` and `funcname` drivers cannot
  change the value by changing how a file is rendered, and sorting the pairs
  makes `diff.orderFile` irrelevant instead of pinning it to a
  platform-specific file.
- **Every change-set gate blocks the two ways a diff can lie about the tree.**
  A diff can be *empty* for a real change, which no amount of sorting repairs.
  `.gitmodules` `ignore = all` (repository-controlled, and the normal state of
  a vendored dependency) drops every gitlink record, so a post-review submodule
  bump hashed the same as the reviewed tree; `-c diff.ignoreSubmodules=none`
  does **not** override it — only `--ignore-submodules=none` does. `git
  replace` lets a ref resolve to a commit nobody committed, so replacement
  objects are disabled with `GIT_NO_REPLACE_OBJECTS=1`. A wrong change set
  makes every gate answer a question about a tree nobody pushed. The two are
  different risks carried by different commands, so the requirement is split
  rather than applied blanket:
  - **Anything that runs `diff`** needs `--ignore-submodules=none` *and*
  `GIT_NO_REPLACE_OBJECTS=1`. That is `scripts/check-review-evidence.mjs` (the
  digest and its post-review path check), `scripts/preflight.mjs` (whether
  typecheck and tests run), `.githooks/pre-push` (whether preflight runs at all,
  including its `merge-base` base selection — guarding only the diff that
  follows let a replacement ref hand preflight a rewritten base), and the two
  advisory gates that read the change set as their whole input:
  `scripts/check-pr-scope.mjs` (which areas a PR touches) and
  `scripts/check-dox-claims.mjs` (lines the branch adds).
  - **Anything that runs only `merge-base`, `cat-file`, `log` or `rev-parse`**
  needs `GIT_NO_REPLACE_OBJECTS=1` and is unaffected by the submodule flag —
  those commands never consult `.gitmodules`. `scripts/check-evidence-integrity.mjs`
  is this case (which commit last touched an artifact, ancestry, and commit
  existence — the reads that decide *which history exists* at all); its
  `--ignore-submodules` scope is empty rather than unpinned.

  Pins are behavioral, not textual. A test that only greps for a flag proves an
  author typed it; a fixture that fails when the flag is removed proves the gate
  reads the real change set. Measured counterexample: the DOX audit's
  `.gitmodules` fixture kept an ordinary file changed alongside the gitlink, so
  its verdict stayed green with the flag removed. A gitlink-ONLY branch is what
  separates the two — one changed file guarded, an unchanged range unguarded.
  A parent guard does not reach a child: preflight exports
  `stepEnv()` so the `check:dox` and `check:evidence` steps it spawns resolve
  the same history it does, because a guarded `git()` in the parent made a
  child that reads git for itself look protected when it was not. A gate that
  omits the flag is its own false green — preflight read a gitlink-only branch
  as documentation-only and printed `Preflight OK`, the pre-push hook exited 0
  before preflight ever started, and both advisory gates reported on a
  substituted diff.
- **The raw record shape is checked, not assumed.** `--raw -z` emits one
  metadata field per one path, and a rename/copy record breaks that pairing by
  carrying a second path — an even number of them would pair a path with the
  next record's metadata and hash two different trees identically. The
  canonicalizer parses each metadata field against the full grammar it claims
  to be (`:<mode> <mode> <sha> <sha> <status>`, or the `::` combined form git
  emits with `--cc`) and rejects a rename/copy status outright. A first-byte
  check for `:` is not that test: a *path* may begin with `:` too, so two
  renames — one colon-prefixed target and one colon-prefixed source — put a path
  in an even position and were accepted, mis-pairing two trees identically. The
  grammar is pinned to the exact colon and `::` arity git emits, so a
  *near*-grammar field — right prefix, wrong field count — is rejected instead
  of matching a looser pattern.
  `--no-renames` stays pinned on every invocation so dropping it fails loudly
  instead of quietly widening what the digest covers.
- **What the digest still does not bind.** It binds tree content, not the
  humans who saw it: it says the same bytes were reviewed, not that the
  reviewer understood them, and not that a model's blind spots are absent.
  That is why `humanSecurityAcceptance` is always `false`. Use `--print` to
  produce the exact value; do not compute it another way.
- **Findings are closed or explained.** Every finding needs an `id`, `title`,
  `severity`, `status` (`fixed`, `accepted-risk`, `not-applicable`), and
  `resolution`. A `high`/`critical` accepted risk additionally needs an
  `operatorDecision` reference; accepting that risk is a human decision.
- **The human security acceptance field is always `false`.** Fresh context
  removes contamination, not correlated model blind spots. Agent review is a
  real second check and never independent human security qualification, GB-12
  authority, or discharge of the GE-04 hold.
- **No fabricated attribution.** Record the real reviewer agent id, model, and
  `context: "fresh"`. A reviewer id equal to the author id fails as self-review.

## Work Guidance

1. Finish reviewed content and commit it at the candidate head.
2. Print the binding values:
   `node scripts/check-review-evidence.mjs --print --pr <n> --base origin/main --head <sha>`
3. Spawn the reviewer with no authoring context (`fork_context: false` when the
   tool supports it) and give it the diff plus applicable contracts.
4. Fix findings, re-review the final head if code changed, then write the record
   against the final reviewed head.
5. Commit only the record, then run
   `pnpm check:review -- --pr <n> --base origin/main --head HEAD`.

## Verification

- `node scripts/check-review-evidence.mjs` (CI gate; `PR_NUMBER`,
  `PR_BASE_SHA`, `PR_HEAD_SHA` from the workflow)
- `node --test tests/scripts/check-review-evidence.test.mjs`
- `pnpm check:staleness` after changing referenced paths

## Child DOX Index

None.
