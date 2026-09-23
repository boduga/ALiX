# docs/superpowers — Implementation Specs & Plans

## Purpose

The design-before-code boundary for ALiX features. **Specs** record *what and
why* — the decisions, invariants, and acceptance criteria. **Plans** record
*how, in which order* — steps, gates, and later the as-built result. Nothing in
`src/` belongs here; these are durable design documents, not code.

## Ownership

| Path | Contents |
|------|----------|
| `specs/YYYY-MM-DD-<topic>-design.md` | One feature's design/spec (54 present). |
| `plans/YYYY-MM-DD-<topic>.md` | One feature's implementation plan or as-built record (81 present). |
| `plans/archived/` | Superseded plans kept for history (1 present). |

There is no index file: discovery is by dated filename and by the spec↔plan
links the documents themselves carry.

## Local Contracts

- **Spec → plan → code, in that order.** The chain is enforced by the
  `brainstorming` skill (spec must be approved) and the `writing-plans` skill
  (plan before implementation). Do not start code while the spec is unapproved.
- **Naming is the index.** Specs always use `YYYY-MM-DD-<topic>-design.md`;
  plans use `YYYY-MM-DD-<topic>.md`. The date is the creation date, the topic
  is kebab-case. Never rename an existing file — the links break.
- **Plans reference their spec** by filename when one exists, so a plan is
  traceable to the decisions it implements.
- **Approved decisions are amended, not rewritten.** When design changes after
  approval, record it as an explicit dated amendment section alongside the new
  value and rationale (precedent: §3.1 "Post-review amendments" in the
  claim-verification spec). Silent rewrites lose the history that explains why
  a decision looks odd later.
- **Shipped plans become as-built records.** Update the `Status` header with
  the PR numbers and stop treating them as instructions — read them as history.
  Do not delete a shipped plan.
- **A spec's caveats stay until evidence retires them.** Removing a caveat
  requires the evidence that supersedes it, not the passage of time.

## Work Guidance

- For a feature: find its spec first, then its plan; the spec is authoritative
  on intent when the two disagree.
- When reviewing a spec, check it against the locked decisions table (if it has
  one) — that table is what must not drift.
- Keep documents operational: stable contracts and constraints, not diary
  entries or changelog narration.
- Do not add index/README files here unless the directory's shape actually
  changes; dated filenames plus cross-links are the intended navigation.

## Verification

Docs-only, so no typecheck/test applies. Before considering a change here done:

```bash
# Naming drift — report, do not fail (known exceptions listed below)
ls docs/superpowers/specs | grep -v '^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.*-design\.md$'
ls docs/superpowers/plans  | grep -v '^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.*\.md$'

# Spec/plan cross-references must resolve (expect no output)
grep -rhoE '[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+-design\.md' docs/superpowers/plans \
  | sort -u | while read f; do test -f "docs/superpowers/specs/$f" || echo "missing: $f"; done
```

**Known naming exceptions** (pre-existing; rename is forbidden by the contract
above, so they are recorded rather than corrected):

- `specs/2026-07-29-{mode-aware-prompts,staged-synthesis,tool-summary}-spec.md` — `-spec` suffix instead of `-design`
- `specs/2026-08-10-capability-platform-greenfield-reconciled-program.md` — no `-design` suffix
- `specs/a3-cross-file-review.json` — JSON, not Markdown
- `plans/context-budget-c0-c1.md` — no date prefix

A file outside this list is drift worth flagging.

Also note `detect_changes` reports **"No changes detected"** for a brand-new
file: git diff does not include untracked paths. Run it before committing, but
confirm the new file is staged (`git status`) — absence from that report is not
evidence of absence.

If this file's name, path, or scope changes, the root `AGENTS.md` Child DOX
Index entry must change with it.

## Child DOX Index

None — `specs/` and `plans/` are filename-organized and hold no separate
contracts of their own.
