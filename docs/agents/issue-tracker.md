# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Git branch and pull-request lifecycle

**Default:** one feature branch → one primary PR → review → merge. An incremental task within an existing feature uses its current branch and PR; a test, audit, follow-up correction, or qualification checkpoint alone is not a reason to open another PR. Use a separate branch only for genuinely independent, reviewable work that can merge on its own, or where the operator explicitly authorizes a dependency stack.

### Before making a branch or PR

1. Read applicable `AGENTS.md` contracts, then inspect `git status -sb`, `git worktree list`, `git branch -vv`, `git fetch origin`, and open PRs (`gh pr list --state open`). Confirm the expected worktree and base, including any uncommitted/untracked files; do not switch, reset, stash, clean, or overwrite another task's changes without reviewing them.
2. Identify the existing issue, branch, and PR for the feature. Update that branch and PR when the scope belongs to the same feature. Create a new branch from the latest agreed integration base only when no suitable feature branch exists. Never branch from a stale feature tip by accident.
3. Describe the intended PR scope and dependency on its target branch. Avoid overlapping PRs that count the same commits as independent features; never equate a green PR status with integration, authorization, or release readiness.

### Review, merge, and close

1. Confirm review ownership and check the **cumulative** diff against the intended target (`git diff <base>...<head>`), ancestry (`git merge-base --is-ancestor`) and a non-mutating merge simulation (`git merge-tree --write-tree <base> <head>`). Re-run these checks if the base advances.
2. Run repository-required GitNexus/DOX checks and relevant tests/CI; inspect security, governance, and release gates separately. A passing merge simulation or CI does not waive approvals or lift any security hold.
3. Merge the approved primary PR into its intended base using the project's agreed merge method; verify the PR is merged, the expected commit is reachable from the target, and `git status` is clean. Close completed issues with a link to the merged PR.
4. If a PR is redundant or superseded, first ensure the replacement includes its commits or equivalent reviewed changes. Add an explicit pointer, **close without merging**, and retain its branch and review history unless branch deletion is separately approved. Never close a distinct unfinished feature as though it was merged.
5. After merge, fetch the new target, inspect remaining dependent PRs, and retarget them only if their intended base has changed. Preserve unrelated worktrees and branches. Do not rewrite or force-push other collaborators' branches without explicit approval.

**Exception — approved stacks:** A dependency stack may be used only when independently justified and approved. Give each slice a single clear base, document the dependency order, and review its incremental and cumulative diff before merging the parent. Do not create a new stacked PR for each small test or audit. Consolidate redundant review surfaces while preserving their history.
