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
  committed into the diff it describes. Raw records name modes, full blob ids
  and paths, so host-local `.git/info/attributes`, `core.attributesFile` and
  `funcname` drivers cannot change the value by changing how a file is
  rendered. Sorting the records makes `diff.orderFile` irrelevant instead of
  pinning it to a platform-specific file. Any content edit changes a blob id,
  including a whitespace-only edit, so a stale review still fails; what the
  digest does not bind is the text a particular diff driver would print. Use
  `--print` to produce the exact value; do not compute it another way.
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
