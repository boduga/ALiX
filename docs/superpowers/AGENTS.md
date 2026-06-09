# DOX — Superpowers Specs & Plans

**Purpose:** Persistent design specs and implementation plans for all feature work.

**Ownership:**
- `specs/` — Design specs (`YYYY-MM-DD-<topic>-design.md`), written during brainstorming and approved before implementation.
- `plans/` — Implementation plans (`YYYY-MM-DD-<feature-name>.md`), written after spec approval, executed task-by-task.

**Local Contracts:**
- Specs use format: `YYYY-MM-DD-<topic>-design.md` and follow the brainstorming skill output.
- Plans use format: `YYYY-MM-DD-<feature-name>.md` and follow the writing-plans skill template.
- Both specs and plans are committed to git for history.
- Specs are written before plans; plans are executed after spec approval.
- Baseline tags reference completed milestones (m0.14, m0.15, etc.).
- Do not store code, build artifacts, or generated content here.

**Work Guidance:**
- Before starting a new milestone, review existing specs and plans for context.
- Each milestone builds on previous ones. Read relevant closed specs to understand prior decisions.
- Tags are immutable; baseline tags mark completed milestones.

**Child DOX Index:**
None. This directory is flat.
