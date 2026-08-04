# ALiX Skills Slash Commands in the TUI — Design Spec

**Date:** 2026-08-03
**Status:** Approved design
**Feature branch (to create):** `skills-slash-tui` off `main`

## Context

ALiX has a full skills subsystem (`src/skills/`): skills live in `~/.alix/skills/<name>/SKILL.md` with a `SkillManifest` carrying `name`, `description`, `trigger` (a slash command like `/tdd`), `pattern`, and optional `scripts/`. The agent session already loads *auto-matched* skills into its system prompt via `setupSkills()`/`SkillCatalog.match()`, and the CLI has `alix skills run` to execute a skill's script in the Layer-4 sandbox.

But the **TUI** has no way to invoke a skill by slash command. Typing `/tdd` into the chat input today either opens the command palette (`/` on empty chat) or sends the literal text to the agent. This feature gives the TUI a first-class **skill slash-command surface**: typing `/tdd` resolves the skill, loads it explicitly into the agent session, and submits the rest of the line as the task — while preserving today's auto-matching behavior.

## Goals

- Users can invoke any installed skill by its `trigger` (or `/name`) from the TUI chat/agent input, with in-input completion.
- Explicit skill activation **adds** to, never replaces, automatic pattern/trigger matching (union → dedupe → inject).
- No regression to the existing command palette (`/` on empty chat, `Ctrl+P`).
- No breakage to existing `processTurn`/`processChat` callers.

## Non-goals

- Running a skill's `scripts/*` directly from the slash command (the "Activate skill" model was chosen; `alix skills run` remains the script-runner surface).
- Registering skills as capabilities in the palette (Approach 3) — future complement, not this feature.

---

## Architecture

A pure parsing/completion layer (`src/skills/slash.ts`) sits between the TUI input and the agent session. It parses `/trigger rest`, resolves the named skill, and hands the agent session an explicit skill list. The session merges explicit + auto-matched skills (union, dedupe, inject).

```
[input buffer: "/tdd fix failing parser"]
        │  parseSlashInput()
        ▼
slash.ts: { command: "/tdd", rest: "fix failing parser" }
        │  resolveSkillName("tdd", catalog) via cached catalog
        ▼
app.ts: submit via dispatchToSession(text="fix failing parser", skills:["tdd"])
        │
        ▼
agent session processTurn(text, { skills:["tdd"] })
        │
        ▼
setupSkills(explicitSkills:["tdd"], task)
   │    explicit: load body of /tdd            → {LoadedSkill}
   │    auto:     catalog.match(task)           → {LoadedSkill[]}
   │    union → dedupe by canonical id → inject into "Available Skills"
        ▼
Existing system-prompt section; agent acts on the skill
```

## Components

### 1. `src/skills/slash.ts` (new — pure, no TUI/CLI imports)

- `parseSlashInput(buffer: string): { command: string; rest: string } | null`
  - `/^\/(\S+)\s?(.*)$/`; returns `null` when the buffer doesn't start with `/`, or is exactly `/`.
  - Normalizes: `command` is the slash token (e.g. `/tdd`), `rest` is everything after the first whitespace.
- `skillSlashNames(manifest: SkillManifest): string[]`
  - `[trigger?, "/name"]`, deduped, leading-slash normalized. Trigger wins the "canonical" label when present.
- `rankSkillMatches(skills: SkillManifest[], query: string): SkillManifest[]`
  - Scored match, best-first, stable. **Ordering is part of the contract**, documented here and asserted in tests:
    1. **exact trigger** (the whole trigger equals the query token)
    2. **exact name**
    3. **prefix trigger**
    4. **prefix name**
    5. **fuzzy** (subsequence). Fuzzy is implemented now with a simple subsequence matcher, and the ordering is asserted so future fuzzy upgrades can't reorder results.
- `resolveSkillName(command: string, skills: SkillManifest[]): string | null`
  - Strip `/`, match by trigger first, then by name. Returns the canonical skill `name` (the catalog's key).
- `canonicalSkillId(manifest: SkillManifest): string`
  - Returns the catalog's canonical identifier for dedup. **`canonicalSkillId()` is the SOLE dedup authority.** No other field (display name, trigger, path) is ever used to decide whether two skills are the same in the union/dedupe/inject path. This is `manifest.name` for now (the key used by `SkillCatalog.getAll()`/`get()` and the on-disk directory name `<root>/<name>/`), but it is isolated behind this function so that if two skills ever share a display name and the catalog gains a different canonical id (e.g. a path or slug), dedup updates in one place.
  - Contract: the union/dedupe/inject path MUST call `canonicalSkillId()` and nothing else to identify a skill. Documented here and asserted in the alias-collision regression test (see Testing).

### 2. `src/skills/catalog.ts` — add `getByTriggerOrName(ref)`

- `getByTriggerOrName(ref: string): SkillEntry | undefined`
  - Dedupes the existing `get()`/`getAll()` by-name-vs-by-trigger lookup into one method used by slash.ts. Accepts `tdd` or `/tdd`.

### 3. `src/skills/session.ts` — thread explicit skills

- `setupSkills(task, factoryConfig, explicitSkills?: string[])` → returns `{ injected: LoadedSkill[]; autoMatched: LoadedSkill[] }`
  - **Union/dedupe/inject happens inside `setupSkills`, not the caller.** Precedence (documented in code):

    ```
    explicit skills [from /tdd]
            +
    auto-matched skills [catalog.match(task)]
            ↓
    union
            ↓
    dedupe by canonicalSkillId (explicit body wins when duplicated)
            ↓
    inject into "## Available Skills" system-prompt section
    ```

  - Multiple explicit skills (`explicitSkills: ["tdd", "typescript"]`) are all loaded and injected.
  - Explicit + auto duplicate → exactly one copy injected (regression-tested).
  - **Explicit loading is transactional.** The explicit set is resolved and loaded as one atomic unit:
    - *Resolution* (name → skill) is per-name and non-fatal: a name that resolves to no installed skill is skipped with a warning (`Skill "tdd" isn't installed. Continuing without it.`).
    - *Loading* is atomic: all resolved explicit bodies are loaded together (`Promise.all`). If any body load throws, the **entire explicit set is dropped wholesale** and the turn continues with auto-match only — never a half-injected explicit subset. This keeps the injected state consistent: either the full explicit set is present, or none of it is.
- `processTurn(message, options?: { skills?: string[] })`
- `processChat(message, options?: { skills?: string[] })`
  - Both pass `options.skills` through to `setupSkills`. Existing callers (run.ts, repl.ts, daemon-client, tui app) pass no second arg → unchanged behavior.

### 4. Generation-based catalog cache (startup + install/remove invalidation)

- New `src/skills/slash-catalog.ts` — a small async, **generation-based** cache:
  - `getSlashCatalog(): Promise<SkillManifest[]>` — returns the cached list, building once on first access via `loadSkillManifests(skillsHome)`.
  - `invalidateSlashCatalog()` — bumps the generation counter; the next `getSlashCatalog()` rebuilds.
  - **Generation model:** the cache holds `{ generation: number; manifests: SkillManifest[] }`. Every build captures the generation it was built at; `getSlashCatalog()` compares the current generation against the cached build's generation and rebuilds on mismatch. This is race-safe: a build that started before an invalidation, and finishes after it, is detected as stale (its captured generation ≠ current) and discarded — the caller rebuilds. Consumers never read a half-stale list and never block on filesystem during typing (steady-state reads are a pure in-memory return).
  - **Documented lifecycle:**

    ```
    startup            → load catalog (gen N)
    skill install/remove → invalidateSlashCatalog() (gen N+1)
    completion/enter   → read cached catalog (no filesystem work during typing)
    ```

  - `install.ts` (both install paths) and `removeSkill()` call `invalidateSlashCatalog()` after the skill lands/leaves.
  - The skills home is read from `~/.alix/skills` (matching the existing hardcoded path; `skills.store.path` config plumbing is out of scope).

### 5. `src/tui/app.ts` — input layer

- **Slash-completion strip** below the chat/agent prompt when the buffer starts with `/`: renders `rankSkillMatches` results (top N) in ranked order; the **highlighted candidate** is the strip's selection.
- **Tab behavior — cycle the strip selection:**
  - Buffer starts with `/` → **Tab moves the strip highlight to the next candidate** (wraps around; stays on the first when there's a single candidate). Tab does **not** modify the buffer text — it only changes which candidate is selected. The strip always shows which candidate is highlighted (e.g. `>` marker).
  - When the buffer is not a slash command, Tab falls through to the existing keybinding (today's behavior).
- **Enter behavior — decision is at Enter, not at typing:**
  - Buffer is exactly `/` → open the palette (today's behavior preserved).
  - Buffer starts with `/` and resolves to a skill → strip the trigger, submit `rest` (or the skill name when `rest` is empty) via `dispatchToSession(..., { skills: [name] })`.
    - **Resolution precedence:** the strip's **highlighted candidate** wins when the user Tab-cycled to it; otherwise the buffer token is resolved by `rankSkillMatches` top match (so `/tdd` works with no Tab at all).
  - Buffer starts with `/` and the command does **not** resolve → **non-fatal, keep the text in the buffer**, show an inline hint "Unknown skill \"/foobar\" — press Tab for completions." Do **not** submit to the agent (prevents accidental LLM calls from a typo).
  - Anything else → today's path.
  - **This creates a consistent rule:** the slash char's meaning is resolved at Enter — `/` alone = palette, `/anything` = slash command. Typing `/` naturally enters slash mode; the old palette shortcut still works if the user presses Enter immediately on `/`. Tab and Enter compose: **Tab to select, Enter to activate**.
- `dispatchToSession` threads an optional `skills` field through to `processChat`/`processTurn`.

### 6. `src/tui/views/chat-view.ts` + `agent-view.ts` — render the completion strip

- A couple of canvas rows under the prompt line showing matching skill triggers/names; highlighted first match. Discoverability only.

## Data flow (union/dedupe/inject)

```
explicit skills [from /tdd]
        +
auto-matched skills [catalog.match(task)]
        ↓
union
        ↓
dedupe by canonicalSkillId (explicit wins the body if duplicated)
        ↓
inject into "## Available Skills" system-prompt section
```

## Error handling

| Situation | Behavior |
|---|---|
| Buffer is exactly `/` | Open palette (unchanged). |
| `/unknown rest` | Non-fatal: keep text in buffer, show "Unknown skill \"/unknown\" — press Tab for completions." No agent call. |
| Explicit name resolves to no installed skill | Non-fatal per-name: warning line in scrollback `Skill "tdd" isn't installed. Continuing without it.`; the name is excluded from the explicit batch. Auto-match continues. |
| A resolved explicit skill's body fails to load | **Transactional:** the entire explicit set is dropped (never a half-injected subset) and the turn continues with auto-match only. |
| Empty `rest` for a valid skill | Submit the skill's name as the task. |
| Cache miss / catalog build failure | Rebuild on generation mismatch; fall back to a fresh load on build error; treat as empty list on unrecoverable error. |
| Alias collision (skill A's name == skill B's trigger) | `canonicalSkillId()` remains the sole dedup authority. **Resolution** precedence: trigger-match wins over name-match (documented; pinned by the alias-collision regression test). |

## Testing

### Unit — `tests/skills/slash.test.ts`
- `parseSlashInput`: no-slash, bare `/`, `/name`, `/name rest`, trailing/extra whitespace, empty rest.
- `skillSlashNames`: trigger present vs absent; dedupe when trigger === name; leading-slash normalization.
- `rankSkillMatches`: **ordering contract asserted** — exact trigger > exact name > prefix trigger > prefix name > fuzzy, each category's order stable. Regression guard on the ranking (so a future fuzzy upgrade can't reorder).
- `resolveSkillName`: by trigger, by name, unknown → null.
- `canonicalSkillId`: returns name; documented as the dedup key.
- **Alias-collision resolution precedence:** skill A has `name: "ts"`, skill B has `trigger: "/ts"` and `name: "b"`. `resolveSkillName("/ts")` resolves to B (trigger wins). Dedup still keys on `canonicalSkillId` — A (`ts`) and B (`b`) are distinct entries.

### Unit — `tests/skills/catalog.test.ts`
- `getByTriggerOrName`: by trigger, by name, by `/trigger`, unknown → undefined.

### Cache — `tests/skills/slash-catalog.test.ts`
- Builds once on first access (catalog cached).
- `invalidateSlashCatalog()` causes next read to reload.
- Reading the cached catalog does not re-read the filesystem.
- **Generation race:** a build that started before `invalidateSlashCatalog()` and resolves after it is detected stale (captured generation ≠ current) and discarded — the next read rebuilds. (Simulated by controlling build timing / injected manifest loader.)

### Session — `tests/agent/session-skills.test.ts`
- **Alias precedence:** a skill reachable by both `trigger` and `name` resolves to the same skill (single injection).
- **Alias-collision regression:** skill A (`name: "ts"`) and skill B (`name: "b"`, `trigger: "/ts"`) — dedup keys on `canonicalSkillId`, so `{ts, b}` stay two entries even though `"/ts"` resolves to B. Verifies the sole-dedup-authority contract.
- **Multiple explicit skills:** `skills: ["tdd", "typescript"]` injects both.
- **Explicit + automatic duplicate:** explicit skill that also auto-matches → exactly one copy in the injected prompt.
- **Transactional load:** when a resolved explicit skill's body fails to load, the entire explicit set is dropped (auto-match only) — no partial injection.
- Union still runs auto-match when explicit skills are present.

### TUI — `tests/tui/app.test.ts`
- Buffer `/ty` renders a completion strip.
- Enter on a valid skill strips trigger, submits `rest` with `skills` set.
- Enter on exactly `/` opens the palette.
- Enter on `/unknown` keeps text in buffer, does NOT submit to the agent, shows the hint.
- **Tab cycles the strip selection** (wraps; single candidate stays); Tab with a non-slash buffer falls through to the existing binding.
- **Tab-then-Enter composes:** Tab to a candidate, then Enter activates that skill.
- `dispatchToSession` threads `skills` through.

## Verification

1. `pnpm build` clean.
2. `pnpm test:node` — full node:test suite (skills + supply-chain + session + TUI), 0 fail.
3. `pnpm test:vitest` — evidence suite, 0 fail.
4. `gitnexus detect_changes` — confirm only expected symbols/processes affected (per project CLAUDE.md).
5. Manual TUI smoke: `alix tui` — type `/ty` (see completion strip), Enter `/tdd ...` (agent session gets skill injected), Enter `/` (palette opens), Enter `/nope` (hint, text preserved).
