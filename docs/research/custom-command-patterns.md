# Custom-Command Patterns in Adjacent Tools

Research ticket: [#311 — "Research: Custom-command patterns in adjacent tools (Claude Code, Cursor, Cline)"](https://github.com/boduga/ALiX/issues/311)
Date: 2026-07-30

## TL;DR — recommended format for ALiX

The industry has converged on **Markdown files with YAML frontmatter, one directory per command, a `SKILL.md` entrypoint, and `$ARGUMENTS`-style interpolation** — because Claude Code, Cursor, and Codex all now read the same Agent Skills open standard (agentskills.io). Cursor and Cline still honor their older plain-markdown command formats, but both are actively migrating them to skills.

Borrowed recommendation for ALiX:
- **File layout**: `commands/<name>/COMMAND.md` (or extend the existing Hermes `skills/<name>/SKILL.md` loader) — the directory/file name becomes the invocation name.
- **Frontmatter**: `name`, `description`, `argument-hint`, `arguments` (named args), `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `context: fork`.
- **Interpolation**: `$ARGUMENTS` (full arg string), `$N` / `$ARGUMENTS[N]` (positional), `$name` (named), with `\$` escaping.
- **Precedence**: user scope overrides project scope; custom overrides built-in of the same name.

ALiX already ships a Hermes-format loader (`src/skills/loader.ts` + `src/skills/types.ts`) that reads `<root>/<name>/SKILL.md` with YAML frontmatter — it is a subset of this pattern. Extending its `SkillManifest` rather than inventing a parallel format is the lowest-friction path (see [Recommendations for ALiX](#recommendations-for-alix)).

---

## 1. Claude Code (most mature; the reference model)

### 1.1 Commands have been merged into skills

As of the current official docs (code.claude.com/docs/en/skills), **custom commands and skills are the same mechanism**:

> "Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way. Your existing `.claude/commands/` files keep working."

| Location | Invocation name | Notes |
| :--- | :--- | :--- |
| `.claude/commands/NAME.md` (project) | `/NAME` | Legacy command layout; still fully supported |
| `~/.claude/commands/NAME.md` (user) | `/NAME` | Legacy command layout |
| `.claude/skills/NAME/SKILL.md` (project) | `/NAME` | Recommended; directory name = command |
| `~/.claude/skills/NAME/SKILL.md` (user) | `/NAME` | Recommended; directory name = command |
| `<plugin>/skills/NAME/SKILL.md` (plugin) | `/plugin:NAME` | Namespaced by plugin; `name` frontmatter can override the final segment |
| `.claude/skills/NAME/SKILL.md` (enterprise managed) | `/NAME` | Org-wide; highest precedence |

A skill directory may bundle supporting files (referenced from `SKILL.md`): templates, examples, reference docs, and `scripts/` Claude can execute.

### 1.2 Frontmatter fields (commands and skills share these)

Optional YAML between `---` markers at the top of the file. All fields optional; `description` is the only recommended one (Claude uses it to decide when to auto-load the command, and it appears in autocomplete; defaults to the first paragraph of the body).

| Field | Purpose |
| :--- | :--- |
| `name` | Display name in listings. For personal/project skills the command still comes from the directory/file name; only plugin skills use `name` to set the command's final segment. |
| `description` | What it does + when to use. Truncated with `when_to_use` at 1,536 chars in the listing. |
| `when_to_use` | Extra auto-invocation trigger context (phrases, example requests). Appended to `description`. |
| `argument-hint` | Autocomplete hint for expected args, e.g. `[issue-number]` or `[filename] [format]`. |
| `arguments` | Named positional args (space-separated string or YAML list); map to `$name` placeholders in order. |
| `disable-model-invocation` | `true` = only the user can invoke it (Claude cannot auto-run it). Default `false`. |
| `user-invocable` | `false` = hidden from the `/` menu (Claude-only background knowledge). Default `true`. |
| `allowed-tools` | Tools pre-approved for the invoking turn without permission prompts, e.g. `Bash(git add *) Bash(git commit *)` or `Read Grep`. Grant clears next message. |
| `disallowed-tools` | Tools removed from Claude's pool while active (e.g. `AskUserQuestion` for a background loop). |
| `model` | Model override while active (`haiku`, `sonnet`, `opus`, full model id, or `inherit`). |
| `effort` | Effort override while active (`low`…`max`). |
| `context` | `fork` = run in an isolated subagent context (no conversation history). |
| `agent` | Subagent type to use with `context: fork` (Explore, Plan, general-purpose, or a custom `.claude/agents/` type). |
| `background` | With `context: fork`, `false` = wait for result in the invoking turn (default `true` = background). |
| `hooks` | Lifecycle hooks scoped to the skill. |
| `paths` | Glob patterns limiting auto-activation to matching files. |
| `shell` | Shell for `!`-commands: `bash` (default) or `powershell`. |

Example:

```markdown
---
name: fix-issue
description: Fix a GitHub issue by number
argument-hint: [issue-number]
disable-model-invocation: true
allowed-tools: Bash(gh *)
---

Fix GitHub issue $ARGUMENTS following our coding standards.

1. Read the issue description
2. Understand the requirements
3. Implement the fix
4. Write tests
5. Create a commit
```

### 1.3 Argument interpolation

| Placeholder | Meaning |
| :--- | :--- |
| `$ARGUMENTS` | The entire argument string after the command name. If the body has no `$ARGUMENTS`, the args are appended as `ARGUMENTS: <value>`. |
| `$ARGUMENTS[N]` | 0-based positional access (`$ARGUMENTS[0]` = first arg). |
| `$N` | Shorthand for `$ARGUMENTS[N]` (`$0`, `$1`, …). |
| `$name` | Named arg declared in the `arguments` frontmatter list; names map to positions in order. |
| `${CLAUDE_SESSION_ID}` | Current session id (logging, session-scoped files). |
| `${CLAUDE_EFFORT}` | Active effort level. |
| `${CLAUDE_SKILL_DIR}` | Directory containing the `SKILL.md` (used in `allowed-tools` Bash rules and body to reach bundled scripts without permission prompts). |
| `${CLAUDE_PROJECT_DIR}` | Project root. |

- Multi-word args use shell-style quoting: `/my-skill "hello world" second` → `$0` = `hello world`, `$1` = `second`; `$ARGUMENTS` always expands to the full typed string.
- A positional placeholder with no matching arg (`$2` with only one arg passed) stays literal; a named placeholder with no match expands to empty string.
- Escape a literal `$` before a digit/ARGUMENTS/declared name with a backslash: `\$1.00`.

### 1.4 Dynamic context injection and shell execution

- `` !`<command>` `` at the start of a line (or after whitespace) runs the shell command **before** the prompt is sent; its output replaces the placeholder in the content (preprocessing — Claude never sees the raw command).
- Multi-line shell: a fenced code block opened with ` ```! `.
- Must be at line start or after whitespace — `KEY=!`cmd`` is treated as literal.
- Bundle scripts and reference them via `${CLAUDE_SKILL_DIR}/scripts/render.sh`, with a matching `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/render.sh *)` so the script runs without prompting.
- `` !`git status` `` plus `Bash` in `allowed-tools` is the classic pattern (the docs' `summarize-changes` example inlines `` !`git diff HEAD` ``).
- `@file` references include a file's contents in the prompt (e.g. `Review @$1`).

### 1.5 Precedence rules

- **Scope precedence (same name)**: enterprise overrides personal; personal overrides project; any of these overrides a **bundled** skill/command with the same name. Plugin skills are namespaced (`plugin:name`), so they can't collide.
- **Skill vs legacy command (same name)**: the skill takes precedence over the `.claude/commands/` file.
- **Nested skills**: a nested `.claude/skills/` under a subdirectory gets a directory-qualified name (`apps/web:deploy`); typing the unqualified name runs the project-root version, and Claude is instructed to also invoke any variant whose directory holds the files it's working on.
- **Built-in commands vs bundled skills**: built-in commands (`/help`, `/compact`, `/init`, …) execute fixed logic directly; bundled skills (`/doctor`, `/code-review`, `/batch`, `/loop`, …) are prompt-based. Both are listed in the commands reference, marked **Skill** where applicable. Since v2.1.215 `/verify` and `/code-review` run only on manual invocation.
- **Model auto-invocation control**: Claude can invoke user commands automatically via the SlashCommand/Skill tool unless `disable-model-invocation: true`. Deny per-command with permission rules `Skill(commit)` / `Skill(deploy *)`, or disable the whole tool via `/permissions`.

---

## 2. Cursor

Cursor has **two** mechanisms plus a newer third (skills):

### 2.1 Custom slash commands (`.cursor/commands/`)

- **Location**: `.cursor/commands/<name>.md` (project, shared with team) and `~/.cursor/commands/` (global/user). Team commands via the Cursor Dashboard (enterprise).
- **Format**: plain Markdown — **no frontmatter allowed**. The filename becomes the command: `review-code.md` → `/review-code`. Names are lowercase, kebab-case.
- **Invocation**: type `/` in the Agent input, pick from the dropdown.
- **Content guidance**: clear, actionable instructions with examples and expected output format; one task per command. Commands are for explicit, focused, user-invoked tasks; rules are for automatic, context-aware conventions.

```markdown
# .cursor/commands/generate-tests.md
Generate comprehensive tests for the file I'm viewing.
- Cover happy path and edge cases
- Use the project's existing test framework and style
- Mock external calls
```

### 2.2 Rules (`.cursor/rules/*.mdc`)

Different from commands — frontmatter-driven, auto-applied:

| Field | Behavior |
| :--- | :--- |
| `alwaysApply: true` | Injected into every conversation; `globs`/`description` ignored. |
| `description: <string>` | Agent fetches the rule when relevant. |
| `globs: <patterns>` | Auto-attached when a matching file is in context. |

```markdown
---
globs: *.ts,*.tsx
---
Always use semicolons
```

### 2.3 Skills (the convergence point)

Cursor now also supports Agent-Standard skills: `.cursor/skills/<name>/SKILL.md` with frontmatter `name`, `description`, and optional `paths` (globs). Skills load from `.agents/skills/`, `~/.agents/skills/`, `.cursor/skills/`, `~/.cursor/skills/`, plus `.claude/skills/` and `.codex/skills/` — i.e. the same open standard Claude Code uses. Invoked via `/name` or attached via `@name`.

`/migrate-to-skills` (Cursor 2.4+) converts **dynamic rules and slash commands into skills** ("preserving their explicit invocation behavior"); rules with `alwaysApply: true` or `globs` stay as rules. This is the same "commands become skills" trajectory Claude Code took.

---

## 3. Cline

### 3.1 Custom workflows (Cline's slash commands)

- **Location**: `.clinerules/workflows/<name>.md` (workspace, version-controlled) or global `~/Documents/Cline/Workflows` (Linux/macOS) / `Documents\Cline\Workflows` (Windows). Workspace overrides global on name collision.
- **Format**: plain Markdown with a `# Title` and numbered `## Step N:` sections. **No frontmatter.** The filename becomes the command: `deploy.md` → `/deploy.md`.
- **Invocation**: type `/` for autocomplete (e.g. `/rel` matches `release-prep.md`); select to run. Each step pauses for approval; rejecting a step stops the workflow. Every workflow has an enable/disable toggle controlling `/`-menu visibility.
- **Steps**: natural-language instructions and/or embedded XML tool calls — `<execute_command>`, `<read_file>`, `<ask_followup_question>`, `<use_mcp_tool>`. Mix high-level instructions with explicit failure handling and decision points.
- **Safety**: "Workflows execute with your permissions. Review workflows before running them."
- **Creation**: via the Workflows tab (scale icon in the Cline panel) or "Create a workflow for the process I just completed."

```markdown
# Deploy workflow

Deploy the application to the staging environment.

## Step 1: Check for clean working directory
Verify there are no uncommitted changes. If there are, ask whether to continue or abort.

## Step 2: Run the test suite
<execute_command>
<command>pnpm test</command>
</execute_command>
If any tests fail, stop the workflow and report the failures.
```

### 3.2 Custom instructions / rules (always-on)

- `.clinerules/` directory or single `.clinerules` file in the project root — Markdown files auto-loaded and appended to the prompt on every session (persist across sessions; togglable since v3.13).
- Global custom instructions live in the Cline extension settings (gear icon → Custom Instructions).
- Conditional rules support YAML frontmatter with a `paths` key (glob patterns); no frontmatter = always active.
- **Skills**: enabled skills also surface in the `/` menu (e.g. `/aws-deploy`), loading their `SKILL.md` instructions on demand.

---

## 4. Cross-tool convergence

| Tool | Legacy custom-command format | Skills format (converged) |
| :--- | :--- | :--- |
| Claude Code | `.claude/commands/*.md` with frontmatter + `$ARGUMENTS` | `.claude/skills/*/SKILL.md` (merged; commands still work) |
| Cursor | `.cursor/commands/*.md`, plain MD, no frontmatter | `.cursor/skills/*/SKILL.md` via `/migrate-to-skills` |
| Cline | `.clinerules/workflows/*.md`, plain MD, `## Step N:` | Skills surfaced in `/` menu |

The shared direction: **Markdown body + YAML frontmatter + one-directory-per-command + `SKILL.md` entrypoint**, per the Agent Skills open standard (agentskills.io), which Claude Code, Cursor, Codex, and Cline all now consume. Legacy `.claude/commands/` files remain a supported, simpler subset. Cursor and Cline's original command formats are plain Markdown with **no argument interpolation** — only Claude Code (and the skills standard) supports `$ARGUMENTS`/`$N` interpolation and `argument-hint`.

---

## 5. Recommendations for ALiX

ALiX already has a Hermes-format skills subsystem that is a subset of the converged standard:

- `src/skills/types.ts` — `SkillManifest` (name, description, trigger, pattern, version, is_core, tags) + `parseFrontMatter` / `parseSkillContent` (supports `---` delimited YAML).
- `src/skills/loader.ts` — `loadSkills` / `loadSkillManifests` read `<root>/<name>/SKILL.md`.
- CLI: `alix skills` subcommands already exist (`src/cli/commands/skills/`) and now act as a marketplace installer — `skills available` / `install <name> [--from <path|url>]` / `install --list` resolve skill content from registered marketplaces (`src/cli/commands/skills/marketplace.ts`; defaults `anthropics/skills`, `langfuse/skills`) instead of shipping bundled `SKILL.md` files. The runtime `alix skill` (singular) extension-based loader (`src/skills/`) is untouched.

Lowest-friction path (extend, don't invent):

1. **Entrypoint**: keep `skills/<name>/SKILL.md` (directory name = invocation name) — or alias `commands/<name>/SKILL.md` if "command" vs "skill" distinction matters. Claude Code treats both layouts identically.
2. **Extend `SkillManifest`** with the command-relevant fields from the converged standard: `argument-hint` (string), `arguments` (string[]), `disable-model-invocation` (bool), `user-invocable` (bool), `allowed-tools` (string[]), `model`, `context: fork`. Backwards-compatible — existing fields are unchanged.
3. **Add interpolation** in the dispatcher: `$ARGUMENTS` (full string), `$N` / `$ARGUMENTS[N]` (positional), `$name` (named from `arguments`), `\$` escaping. Fall back to appending `ARGUMENTS: <value>` when the body has no placeholder.
4. **Precedence**: user scope overrides project scope; a custom command overrides a built-in of the same name; first match wins on collision (Claude Code: skill beats legacy command file, enterprise > personal > project > bundled).
5. **Invocation control**: honor `disable-model-invocation: true` to keep side-effectful commands user-only, and `user-invocable: false` for hidden/background knowledge.

## 6. Sources

- Claude Code — "Extend Claude with skills" (skills + custom commands merged): https://code.claude.com/docs/en/skills
- Claude Code — Commands reference (built-in commands, bundled skills): https://code.claude.com/docs/en/commands
- Claude Code docs index: https://code.claude.com/docs/llms.txt
- Claude Code — Community command frontmatter reference (mintlify mirror): https://mintlify.wiki/anthropics/claude-code/reference/commands/slash-commands
- Agent Skills open standard: https://agentskills.io
- Cursor — Commands changelog (`.cursor/commands/`): https://cursor.com/en-US/changelog/1-6
- Cursor — Rules docs: https://cursor.com/docs/rules.md
- Cursor — Skills docs (`.cursor/skills/`, `/migrate-to-skills`): https://cursor.com/docs/agent/chat/commands
- Cline — Using commands (built-ins, `/` autocomplete): https://docs.cline.bot/core-workflows/using-commands
- Cline — Custom workflows (`.clinerules/workflows/`, `## Step N:` format): https://mintlify.wiki/cline/cline/customization/workflows
- Cline — Rules / custom instructions (`.clinerules/`, conditional `paths`): https://docs.cline.bot/customization/workflows
- Cline — `/newrule` and slash commands: https://docs.cline.bot/features/slash-commands/new-rule
