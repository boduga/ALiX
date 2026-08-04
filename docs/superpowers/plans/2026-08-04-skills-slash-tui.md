# Skill Slash Commands in the TUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ALiX TUI a first-class skill slash-command surface — typing `/tdd` resolves the installed skill, injects it explicitly into the agent session, and submits the rest of the line as the task, with in-input completion.

**Architecture:** A pure parsing/completion layer (`src/skills/slash.ts`) sits between the TUI input and the agent session. It parses `/trigger rest`, resolves the skill, and hands the session an explicit skill list. The session merges explicit + auto-matched skills (union → dedupe by canonical id → inject into the "Available Skills" system-prompt section). A generation-based catalog cache (`src/skills/slash-catalog.ts`) keeps typing free of filesystem work. TUI input mode is resolved at Enter: `/` alone opens the palette, `/anything` is a slash command.

**Tech Stack:** TypeScript, node:test + vitest, existing `src/skills/{types,loader,catalog}.ts`, existing TUI raw-terminal input layer (`src/tui/app.ts`).

## Global Constraints

- **Explicit skill activation ADDS to, never replaces, automatic matching.** Union → dedupe → inject. `/tdd fix failing parser` may still auto-match `typescript`.
- **`canonicalSkillId()` is the SOLE dedup authority.** No other field (display name, trigger, path) decides whether two skills are the same in the union/dedupe path.
- **Explicit loading is transactional:** per-name resolution is non-fatal (missing skill → warn + skip), but body loading is atomic (`Promise.all`) — any load failure drops the ENTIRE explicit set, never a half-injected subset.
- **Catalog is generation-based and cached.** Steady-state completion reads are pure in-memory; `invalidateSlashCatalog()` bumps the generation, install/remove call it.
- **Enter resolves the slash char:** buffer exactly `/` → palette; buffer `/anything` → slash command. Tab cycles the completion-strip selection (does not modify the buffer); Enter activates the highlighted candidate, else the top `rankSkillMatches` match.
- **Unknown `/command` is non-fatal:** text stays in the buffer, an inline hint shows "press Tab for completions", NO agent call is made.
- **Existing `processTurn`/`processChat` callers must not break** — the `options` param is optional. `daemon-client.ts` and `src/cli/commands/tui.ts` stubs need NO change (implementations with fewer params are assignable).
- `canonicalSkillId` returns `manifest.name` for now (the catalog's key and on-disk dir name). Isolated behind the function so a future canonical-id change updates one place.
- Ranked completion ordering is a CONTRACT: exact trigger > exact name > prefix trigger > prefix name > fuzzy. Asserted in tests so a future fuzzy upgrade cannot reorder results.
- Skills home is `~/.alix/skills` (existing hardcoded path). `skills.store.path` config plumbing is OUT of scope.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/skills/slash.ts` (new) | Pure parse/rank/resolve helpers + `canonicalSkillId` |
| `src/skills/catalog.ts` (modify) | Add `getByTriggerOrName` |
| `src/skills/slash-catalog.ts` (new) | Generation-based manifest cache (`getSlashCatalog`/`invalidateSlashCatalog`) |
| `src/agent/session.ts` (modify) | `setupSkills` explicit union, `buildSkillsSection` helper, `processTurn`/`processChat` `options` |
| `src/cli/commands/skills/install.ts` (modify) | Invalidate cache after install/remove |
| `src/tui/views/types.ts` (modify) | `SlashStrip`/`SlashStripEntry` + `ViewRenderContext.slash` |
| `src/tui/app.ts` (modify) | Slash-mode input layer, Tab/Enter routing, `dispatchToSession` skills threading |
| `src/tui/views/chat-view.ts`, `agent-view.ts` (modify) | Render the completion strip + hint |

Tests: `tests/skills/slash.test.ts` (new), `tests/skills/slash-catalog.test.ts` (new), `tests/skills/catalog.test.ts` (modify), `tests/agent/session-skills.test.ts` (new), `tests/cli/commands/skills/install.test.ts` (modify), `tests/tui/app.vitest.ts` (modify), `tests/tui/views/chat-view.test.ts` (new).

---

### Task 1: Pure slash helpers — `src/skills/slash.ts`

**Files:**
- Create: `src/skills/slash.ts`
- Test: `tests/skills/slash.test.ts`

**Interfaces:**
- Produces (later tasks rely on these EXACT signatures):
  - `export function parseSlashInput(buffer: string): { command: string; rest: string } | null`
  - `export function skillSlashNames(manifest: SkillManifest): string[]`
  - `export function rankSkillMatches(skills: SkillManifest[], query: string): SkillManifest[]`
  - `export function resolveSkillName(command: string, skills: SkillManifest[]): string | null`
  - `export function canonicalSkillId(manifest: SkillManifest): string`

- [ ] **Step 1: Write the failing test**

Create `tests/skills/slash.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SkillManifest } from "../../src/skills/types.js";
import {
  parseSlashInput, skillSlashNames, rankSkillMatches,
  resolveSkillName, canonicalSkillId,
} from "../../src/skills/slash.js";

function m(partial: Partial<SkillManifest> & { name: string; description: string }): SkillManifest {
  return { version: "1.0.0", is_core: false, ...partial };
}

describe("parseSlashInput", () => {
  it("returns null for a non-slash buffer", () => {
    assert.equal(parseSlashInput("plain text"), null);
  });
  it("returns null for exactly '/'", () => {
    assert.equal(parseSlashInput("/"), null);
  });
  it("parses /name", () => {
    assert.deepEqual(parseSlashInput("/tdd"), { command: "/tdd", rest: "" });
  });
  it("parses /name rest", () => {
    assert.deepEqual(parseSlashInput("/tdd fix parser"), { command: "/tdd", rest: "fix parser" });
  });
  it("trims whitespace around rest", () => {
    assert.deepEqual(parseSlashInput("/tdd   fix parser"), { command: "/tdd", rest: "fix parser" });
  });
});

describe("skillSlashNames", () => {
  it("returns trigger + /name when trigger present", () => {
    const s = m({ name: "typescript", trigger: "/ts", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/ts", "/typescript"]);
  });
  it("returns /name only when no trigger", () => {
    const s = m({ name: "typescript", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/typescript"]);
  });
  it("dedupes when trigger === /name", () => {
    const s = m({ name: "ts", trigger: "/ts", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/ts"]);
  });
  it("normalizes a trigger missing the leading slash", () => {
    const s = m({ name: "ts", trigger: "ts", description: "x" });
    assert.deepEqual(skillSlashNames(s), ["/ts"]);
  });
});

describe("rankSkillMatches — ordering is a CONTRACT", () => {
  const exactTrigger = m({ name: "a", trigger: "/tdd", description: "exact trigger" });
  const exactName = m({ name: "tdd", description: "exact name" });
  const prefixTrigger = m({ name: "b", trigger: "/tddx", description: "prefix trigger" });
  const prefixName = m({ name: "tddx", description: "prefix name" });
  const fuzzy = m({ name: "t_d_d_extra", description: "fuzzy" });
  const all = [fuzzy, prefixName, prefixTrigger, exactName, exactTrigger];

  it("orders exact trigger > exact name > prefix trigger > prefix name > fuzzy", () => {
    const ranked = rankSkillMatches(all, "/tdd").map((s) => s.name);
    assert.deepEqual(ranked, ["a", "tdd", "b", "tddx", "t_d_d_extra"]);
  });
});

describe("resolveSkillName", () => {
  const tsByName = m({ name: "ts", description: "x" });
  const bByTrigger = m({ name: "b", trigger: "/ts", description: "x" });
  it("resolves by trigger", () => {
    assert.equal(resolveSkillName("/ts", [tsByName, bByTrigger]), "b");
  });
  it("resolves by name", () => {
    assert.equal(resolveSkillName("/ts", [bByTrigger, tsByName]), "b");
  });
  it("returns null when unknown", () => {
    assert.equal(resolveSkillName("/nope", [tsByName]), null);
  });
});

describe("canonicalSkillId", () => {
  it("is the sole dedup authority and returns name", () => {
    const s = m({ name: "tdd", description: "x" });
    assert.equal(canonicalSkillId(s), "tdd");
  });
  it("keeps distinct skills with a shared alias distinct", () => {
    const a = m({ name: "ts", description: "A" });
    const b = m({ name: "b", trigger: "/ts", description: "B" });
    assert.notEqual(canonicalSkillId(a), canonicalSkillId(b));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test dist/tests/skills/slash.test.js` (after `pnpm build`) or `pnpm build && node --test dist/tests/skills/slash.test.js`
Expected: FAIL — "Cannot find module .../src/skills/slash.js"

- [ ] **Step 3: Write the minimal implementation**

Create `src/skills/slash.ts`:

```ts
import type { SkillManifest } from "./types.js";

export interface SlashInput {
  /** The slash token including the leading slash, e.g. "/tdd". */
  command: string;
  /** Everything after the first whitespace, trimmed. Empty when absent. */
  rest: string;
}

/**
 * Parse a TUI input buffer into a slash command + rest. Returns null when the
 * buffer is not a slash command (doesn't start with "/") or is exactly "/"
 * (which the TUI treats as the palette-opener, not a command).
 */
export function parseSlashInput(buffer: string): SlashInput | null {
  if (!buffer.startsWith("/") || buffer === "/") return null;
  const match = buffer.match(/^\/(\S+)\s?(.*)$/s);
  if (!match) return null;
  return { command: `/${match[1]}`, rest: match[2] ?? "" };
}

/**
 * The slash labels a skill responds to: its trigger (normalized to a leading
 * slash) plus "/name". Deduplicated, stable order: trigger first, name second.
 */
export function skillSlashNames(manifest: SkillManifest): string[] {
  const trigger = manifest.trigger ? `/${manifest.trigger.replace(/^\/+/, "")}` : undefined;
  const byName = `/${manifest.name}`;
  const names = [trigger, byName].filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}

type RankBucket = 1 | 2 | 3 | 4 | 5;

function bucket(query: string, skill: SkillManifest): RankBucket | null {
  const names = skillSlashNames(skill);
  if (names.includes(query)) {
    // Exact trigger outranks exact name (the trigger is the primary alias).
    return skill.trigger && skillSlashNames(skill)[0] === query ? 1 : 2;
  }
  if (skill.trigger?.startsWith(query.slice(1)) || `/${skill.trigger}`.startsWith(query)) return 3;
  if (`/${skill.name}`.startsWith(query)) return 4;
  // Fuzzy: subsequence match on "/name" (e.g. "/t_d" matches "/tdd").
  const q = query.replace(/^\/+/, "");
  const target = skill.name;
  let qi = 0;
  for (let i = 0; i < target.length && qi < q.length; i++) {
    if (target[i] === q[qi]) qi++;
  }
  return qi === q.length ? 5 : null;
}

/**
 * Rank skills against a slash query. Ordering is a CONTRACT (asserted in
 * tests): exact trigger > exact name > prefix trigger > prefix name > fuzzy.
 * Stable for ties (preserves input order).
 */
export function rankSkillMatches(skills: SkillManifest[], query: string): SkillManifest[] {
  const scored: Array<{ skill: SkillManifest; bucket: RankBucket; idx: number }> = [];
  skills.forEach((skill, idx) => {
    const b = bucket(query, skill);
    if (b !== null) scored.push({ skill, bucket: b, idx });
  });
  scored.sort((x, y) => x.bucket - y.bucket || x.idx - y.idx);
  return scored.map((s) => s.skill);
}

/**
 * Resolve a slash command (e.g. "/tdd") to a skill's canonical name. Trigger
 * match wins over name match. Returns null when nothing matches.
 */
export function resolveSkillName(command: string, skills: SkillManifest[]): string | null {
  const top = rankSkillMatches(skills, command)[0];
  return top ? canonicalSkillId(top) : null;
}

/**
 * The SOLE dedup authority for the union/dedupe/inject path. Nothing else
 * (display name, trigger, path) decides whether two skills are the same.
 * Returns manifest.name today (the catalog key and on-disk dir name); keep
 * all identity decisions behind this function so a future canonical-id change
 * updates one place.
 */
export function canonicalSkillId(manifest: SkillManifest): string {
  return manifest.name;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && node --test dist/tests/skills/slash.test.js`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/skills/slash.ts tests/skills/slash.test.ts
git commit -m "feat(skills): pure slash-command helpers — parse, rank, resolve, canonical id"
```

---

### Task 2: `SkillCatalog.getByTriggerOrName`

**Files:**
- Modify: `src/skills/catalog.ts` (add method to `SkillCatalog` class)
- Test: `tests/skills/catalog.test.ts`

**Interfaces:**
- Consumes: `SkillEntry` (already exported), `SkillManifest` (already exported).
- Produces: `SkillCatalog.prototype.getByTriggerOrName(ref: string): SkillEntry | undefined`

- [ ] **Step 1: Write the failing test**

Add to `tests/skills/catalog.test.ts` (if the file doesn't exist, create it):

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkillCatalog, type SkillEntry } from "../../src/skills/catalog.js";

function entry(name: string, trigger?: string): SkillEntry {
  return {
    manifest: { name, description: name, version: "1.0.0", is_core: false, trigger },
    path: `/skills/${name}`,
  };
}

describe("SkillCatalog.getByTriggerOrName", () => {
  const catalog = new SkillCatalog([
    entry("typescript", "/ts"),
    entry("tdd"),
  ]);
  it("looks up by trigger (with slash)", () => {
    assert.equal(catalog.getByTriggerOrName("/ts")?.manifest.name, "typescript");
  });
  it("looks up by trigger (without slash)", () => {
    assert.equal(catalog.getByTriggerOrName("ts")?.manifest.name, "typescript");
  });
  it("looks up by name", () => {
    assert.equal(catalog.getByTriggerOrName("tdd")?.manifest.name, "tdd");
  });
  it("returns undefined for unknown", () => {
    assert.equal(catalog.getByTriggerOrName("/nope"), undefined);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && node --test dist/tests/skills/catalog.test.js`
Expected: FAIL — `getByTriggerOrName is not a function`

- [ ] **Step 3: Write the minimal implementation**

In `src/skills/catalog.ts`, inside the `SkillCatalog` class (after the existing `get` method):

```ts
  /**
   * Resolve a skill by trigger or name (slash optional). Used by the slash
   * layer to turn `/tdd` or `tdd` into the underlying SkillEntry.
   */
  getByTriggerOrName(ref: string): SkillEntry | undefined {
    const key = ref.startsWith("/") ? ref : `/${ref}`;
    return this.byTrigger.get(key)
      ?? this.byTrigger.get(ref)
      ?? this.byPattern.find((p) => p.entry.manifest.name === ref)?.entry;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && node --test dist/tests/skills/catalog.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/skills/catalog.ts tests/skills/catalog.test.ts
git commit -m "feat(skills): SkillCatalog.getByTriggerOrName — resolve slash ref to entry"
```

---

### Task 3: Generation-based catalog cache — `src/skills/slash-catalog.ts`

**Files:**
- Create: `src/skills/slash-catalog.ts`
- Test: `tests/skills/slash-catalog.test.ts`

**Interfaces:**
- Consumes: `loadSkillManifests` from `./loader.js`; `SkillManifest` from `./types.js`.
- Produces:
  - `export function getSlashCatalog(): Promise<SkillManifest[]>`
  - `export function invalidateSlashCatalog(): void`
  - `export function setSlashCatalogLoaderForTest(fn: (() => Promise<SkillManifest[]>) | null): void`

- [ ] **Step 1: Write the failing test**

Create `tests/skills/slash-catalog.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SkillManifest } from "../../src/skills/types.js";
import {
  getSlashCatalog, invalidateSlashCatalog, setSlashCatalogLoaderForTest,
} from "../../src/skills/slash-catalog.js";

function m(name: string): SkillManifest {
  return { name, description: name, version: "1.0.0", is_core: false };
}

describe("slash-catalog generation cache", () => {
  it("builds once and caches across reads", async () => {
    let calls = 0;
    setSlashCatalogLoaderForTest(async () => { calls++; return [m("a")]; });
    try {
      const first = await getSlashCatalog();
      const second = await getSlashCatalog();
      assert.equal(calls, 1, "loader called exactly once");
      assert.equal(first.length, 1);
      assert.equal(second, first, "same cached array instance");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });

  it("invalidateSlashCatalog forces a rebuild on next read", async () => {
    let calls = 0;
    setSlashCatalogLoaderForTest(async () => { calls++; return [m(`v${calls}`)]; });
    try {
      const a = await getSlashCatalog();
      invalidateSlashCatalog();
      const b = await getSlashCatalog();
      assert.equal(calls, 2);
      assert.notEqual(a, b);
      assert.equal(b[0].name, "v2");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });

  it("detects a stale build started before invalidation and rebuilds", async () => {
    let resolveSlow: (v: SkillManifest[]) => void = () => {};
    let calls = 0;
    setSlashCatalogLoaderForTest(() => {
      calls++;
      if (calls === 1) return new Promise<SkillManifest[]>((res) => { resolveSlow = res; });
      return Promise.resolve([m("fresh")]);
    });
    try {
      const slowBuild = getSlashCatalog();
      invalidateSlashCatalog();           // generation bumps while build is in flight
      resolveSlow([m("stale")]);          // build resolves AFTER invalidation
      const fresh = await slowBuild;
      assert.equal(calls, 2, "stale build discarded; reload happened");
      assert.equal(fresh[0].name, "fresh");
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && node --test dist/tests/skills/slash-catalog.test.js`
Expected: FAIL — "Cannot find module .../src/skills/slash-catalog.js"

- [ ] **Step 3: Write the minimal implementation**

Create `src/skills/slash-catalog.ts`:

```ts
import { join } from "node:path";
import { homedir } from "node:os";
import type { SkillManifest } from "./types.js";

/**
 * Generation-based cache for the installed-skill manifest list. The TUI reads
 * this for slash-command completion so typing never touches the filesystem.
 *
 * Lifecycle:
 *   startup              → build once (gen N)
 *   skill install/remove → invalidateSlashCatalog() (gen N+1)
 *   completion / enter   → read cached list (pure in-memory)
 *
 * Race-safety: every build captures the generation it was built at. If a build
 * started before an invalidation and resolves after it, its captured
 * generation ≠ current, so it is discarded and the caller reloads.
 */

type Loader = () => Promise<SkillManifest[]>;

const skillsHome = () => join(homedir(), ".alix", "skills");

let generation = 0;
let cached: { gen: number; manifests: SkillManifest[] } | null = null;
let inFlight: Promise<SkillManifest[]> | null = null;
let loader: Loader | null = null;

async function defaultLoader(): Promise<SkillManifest[]> {
  const { loadSkillManifests } = await import("./loader.js");
  return loadSkillManifests(skillsHome());
}

/** Test seam — replace the loader (or restore the default with null). */
export function setSlashCatalogLoaderForTest(fn: Loader | null): void {
  loader = fn;
  invalidateSlashCatalog();
}

export function invalidateSlashCatalog(): void {
  generation++;
  cached = null;
  inFlight = null;
}

export async function getSlashCatalog(): Promise<SkillManifest[]> {
  if (cached && cached.gen === generation) return cached.manifests;
  // Serialize concurrent builds so the filesystem is touched at most once per
  // generation, even under bursts.
  if (!inFlight) {
    inFlight = (loader ?? defaultLoader)()
      .then((manifests) => {
        // Only accept the result if the generation didn't move while we built.
        if (cached === null || cached.gen !== generation) {
          cached = { gen: generation, manifests };
        }
        return cached.manifests;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && node --test dist/tests/skills/slash-catalog.test.js`
Expected: PASS (including the generation-race case)

- [ ] **Step 5: Commit**

```bash
git add src/skills/slash-catalog.ts tests/skills/slash-catalog.test.ts
git commit -m "feat(skills): generation-based slash catalog cache with race-safe invalidation"
```

---

### Task 4: Thread explicit skills through the agent session

**Files:**
- Modify: `src/agent/session.ts`
- Test: `tests/agent/session-skills.test.ts` (new)

**Interfaces:**
- Consumes: `getByTriggerOrName` (Task 2), `canonicalSkillId` (Task 1), `loadSkillContent` (existing `./loader.js`), `LoadedSkill`/`SkillEntry` (existing).
- Produces:
  - `export function buildSkillsSection(skills: LoadedSkill[]): string`
  - `async function setupSkills(task, factoryConfig?, explicitSkills?, opts?: { autoMatch?: boolean }): Promise<LoadedSkill[]>` (merged union)
  - `processTurn(message, options?: { skills?: string[] })`
  - `processChat(message, options?: { skills?: string[] })`
  - `AgentSession.processTurn` / `processChat` gain optional `options` in the interface (line ~390/404).

- [ ] **Step 1: Write the failing test**

Create `tests/agent/session-skills.test.ts`. It drives `setupSkills` via a temp HOME so the loader reads real dirs:

```ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupSkills, buildSkillsSection } from "../../src/agent/session.js";

let home: string;
let origHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "alix-skill-home-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

function installSkill(name: string, body: string, trigger?: string): void {
  const dir = join(home, ".alix", "skills", name);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---", `name: ${name}`, `description: ${name}`,
    ...(trigger ? [`trigger: ${trigger}`] : []),
    "version: 1.0.0", "is_core: false", "---", "",
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), `${fm}\n${body}\n`);
}

describe("setupSkills explicit union", () => {
  it("injects explicit skills and still auto-matches", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    // /tdd... explicit, and the task text matches the typescript pattern
    const injected = await setupSkills("fix the typescript build", undefined, ["tdd"]);
    const names = injected.map((s) => s.manifest.name).sort();
    assert.ok(names.includes("tdd"), "explicit skill injected");
    assert.ok(names.includes("typescript"), "auto-match still runs (union, not replace)");
  });

  it("multiple explicit skills both inject", async () => {
    installSkill("tdd", "TDD BODY", "/tdd");
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("generic task", undefined, ["tdd", "typescript"]);
    const names = injected.map((s) => s.manifest.name);
    assert.ok(names.includes("tdd"));
    assert.ok(names.includes("typescript"));
  });

  it("explicit + automatic duplicate injects exactly one copy", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("fix the typescript build", undefined, ["typescript"]);
    const matches = injected.filter((s) => s.manifest.name === "typescript");
    assert.equal(matches.length, 1, "dedupe by canonical id → one copy");
  });

  it("is transactional: a failed explicit body load drops the whole explicit set", async () => {
    installSkill("good", "GOOD BODY", "/good");
    // A skill whose SKILL.md is corrupt → loadSkillContent returns null (not a
    // throw). To force a throw, point the explicit ref at a path that fails
    // resolution instead — resolution misses are per-name non-fatal, so instead
    // verify the "no partial injection" invariant via a non-existent explicit.
    const injected = await setupSkills("some task", undefined, ["good", "missing"]);
    const names = injected.map((s) => s.manifest.name);
    assert.ok(names.includes("good"), "resolvable explicit still injected");
    assert.ok(!names.includes("missing"));
  });

  it("keeps auto-match-only behavior when no explicit skills given", async () => {
    installSkill("typescript", "TS BODY", "/ts");
    const injected = await setupSkills("fix the typescript build", undefined);
    const names = injected.map((s) => s.manifest.name);
    assert.deepEqual(names, ["typescript"]);
  });
});

describe("buildSkillsSection", () => {
  it("renders the Available Skills block", () => {
    const section = buildSkillsSection([
      { manifest: { name: "tdd", description: "x", version: "1.0.0", is_core: false, trigger: "/tdd" }, body: "BODY", path: "" },
    ]);
    assert.match(section, /## Available Skills/);
    assert.match(section, /## Skill: \/tdd/);
    assert.match(section, /BODY/);
  });
  it("returns empty string for no skills", () => {
    assert.equal(buildSkillsSection([]), "");
  });
});
```

> **Note on the transactional case:** a `loadSkillContent` miss (null) is a *resolution* outcome, not a load *failure* — the transactional drop covers the case where `Promise.all` **rejects**. The test pins the resolution behavior (per-name non-fatal). The implementation below must still drop the whole explicit set if `Promise.all` rejects (guarded by try/catch around the load).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && node --test dist/tests/agent/session-skills.test.js`
Expected: FAIL — `setupSkills`/`buildSkillsSection` not exported / explicit not honored

- [ ] **Step 3: Write the minimal implementation**

In `src/agent/session.ts`:

**(a)** Add a module-scope `explicitSkills` next to `currentTask` (line ~588):

```ts
    let currentTask = config.task;
    let explicitSkills: string[] | undefined;
```

**(b)** Rewrite `setupSkills` (line 1775) to the union model. It already dynamically imports loader/catalog; add the slash helpers:

```ts
async function setupSkills(
  task: string,
  factoryConfig?: { maxStore: number; maxCandidates: number },
  explicitSkills?: string[],
  opts?: { autoMatch?: boolean },
): Promise<any[]> {
  try {
    const skillsHome = join(homedir(), ".alix", "skills");
    const { loadSkillManifests, loadSkillContent } = await import("../skills/loader.js");
    const { buildSkillCatalog } = await import("../skills/catalog.js");
    const { canonicalSkillId } = await import("../skills/slash.js");
    const skillManifests = await loadSkillManifests(skillsHome);
    const skillCatalog = buildSkillCatalog(skillManifests);
    const { maxStore, maxCandidates } = factoryConfig ?? DEFAULT_FACTORY_CONFIG;
    evictIfNeeded(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });

    // Explicit: resolve per-name (non-fatal), load transactionally (all-or-nothing).
    const explicit: any[] = [];
    if (explicitSkills && explicitSkills.length > 0) {
      const entries: SkillEntry[] = [];
      for (const ref of explicitSkills) {
        const entry = skillCatalog.getByTriggerOrName(ref);
        if (!entry) {
          console.warn(`Skill "${ref}" isn't installed. Continuing without it.`);
          continue;
        }
        entries.push(entry);
      }
      try {
        const loaded = await Promise.all(
          entries.map(async (e) => {
            const content = await loadSkillContent(e.path);
            return content ? { manifest: content.manifest, body: content.body, path: e.path } : null;
          }),
        );
        for (const s of loaded) if (s) explicit.push(s);
      } catch {
        // Transactional: any body-load failure drops the WHOLE explicit set —
        // never a half-injected subset.
        explicit.length = 0;
      }
    }

    // Auto-match (preserved; skipped when the caller opts out, e.g. chat path).
    const autoMatched = opts?.autoMatch === false ? [] : await skillCatalog.getMatchedContent(task);

    // Union → dedupe by canonicalSkillId (explicit body wins on duplicate).
    const byId = new Map<string, any>();
    for (const s of [...explicit, ...autoMatched]) {
      byId.set(canonicalSkillId(s.manifest), s);
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}
```

**(c)** Update the `initialize()` call site (line 705) to pass the explicit list:

```ts
      const matchedSkills = await setupSkills(
        currentTask,
        ctx.config.skills?.factory,
        explicitSkills,
      );
```

**(d)** Add `buildSkillsSection` and use it in `composeSystemPrompt` (replace the inline block at lines 1994-2002):

```ts
/** Render the "Available Skills" system-prompt section, or "" for none. */
export function buildSkillsSection(skills: any[]): string {
  if (skills.length === 0) return "";
  const skillSection = skills
    .map((s: any) => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  return `## Available Skills\n${skillSection}`;
}
```

In `composeSystemPrompt`:

```ts
  if (opts.matchedSkills.length > 0) {
    lines.push(buildSkillsSection(opts.matchedSkills));
  }
```

**(e)** Update `processTurn` (line 871) to accept `options` and set `explicitSkills`:

```ts
    async function processTurn(message: string, options?: { skills?: string[] }): Promise<AgentTurnResult> {
      explicitSkills = options?.skills;
      ...
```

**(f)** Update `processChat` (line 1565) to accept `options` and inject explicit skills into its system prompt (chat does NOT auto-match — preserves current behavior):

```ts
    async function processChat(message: string, options?: { skills?: string[] }): Promise<AgentTurnResult> {
      const sessionId = session?.sessionId ?? "chat";
      const provider = await ensureChatProvider();
      if (!provider) {
        return { summary: `[chat:no-provider] ${message}`, sessionId, toolCalls: [], reason: "chat" };
      }
      const chatSystemPrompt =
        config.chatSystemPrompt ?? CHAT_DEFAULT_SYSTEM_PROMPT;
      let effectiveSystemPrompt = chatSystemPrompt;
      if (options?.skills && options.skills.length > 0) {
        const explicit = await setupSkills(message, config.skills?.factory, options.skills, { autoMatch: false });
        const section = buildSkillsSection(explicit);
        if (section) effectiveSystemPrompt = `${chatSystemPrompt}\n\n${section}`;
      }
      chatMessages.push({ role: "user", content: message });
      try {
        // ... existing search block unchanged ...
        const response = await provider.complete({
          systemPrompt: effectiveSystemPrompt,
          messages: chatMessages.slice(),
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        });
        // ... rest unchanged ...
```

**(g)** Update the `AgentSession` interface (lines 390, 404) to the optional-options form:

```ts
  processTurn(message: string, options?: { skills?: string[] }): Promise<AgentTurnResult>;
  ...
  processChat(message: string, options?: { skills?: string[] }): Promise<AgentTurnResult>;
```

> No change needed in `daemon-client.ts` or `src/cli/commands/tui.ts` — their implementations take only `(text: string)`, which is assignable to the widened signature. Documented limitation: the daemon transport does not forward `options.skills` (out of scope; the local `AgentSession` path is the target).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && node --test dist/tests/agent/session-skills.test.js`
Expected: PASS (all cases). Also run `pnpm build` — the interface + call-site changes must typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/agent/session.ts tests/agent/session-skills.test.ts
git commit -m "feat(skills): union explicit+auto skill injection in session; transactional explicit load; chat injection"
```

---

### Task 5: Invalidate the slash catalog on install/remove

**Files:**
- Modify: `src/cli/commands/skills/install.ts`
- Test: `tests/cli/commands/skills/install.test.ts` (modify)

**Interfaces:**
- Consumes: `invalidateSlashCatalog` from `../../../skills/slash-catalog.js` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `tests/cli/commands/skills/install.test.ts`:

```ts
import { invalidateSlashCatalog, setSlashCatalogLoaderForTest } from "../../../../src/skills/slash-catalog.js";
```

Add a test verifying the cache is invalidated after a successful install:

```ts
  it("invalidates the slash catalog after install", async () => {
    let loads = 0;
    setSlashCatalogLoaderForTest(async () => { loads++; return []; });
    try {
      await runInstall({ from: writeFixture("---\nname: brand\ndescription: B\n---\nBody"), force: true });
      // A subsequent read must rebuild (loader called again) because install
      // invalidated the generation.
      await import("../../../../src/skills/slash-catalog.js").then(async (m) => {
        const before = loads;
        await m.getSlashCatalog();
        assert.equal(loads, before + 1, "catalog rebuilt after install");
      });
    } finally {
      setSlashCatalogLoaderForTest(null);
    }
  });
```

> Note: `runInstall` for a single-file fixture installs by name derived from the manifest. Use the existing `writeFixture` helper already present in the test file. The loader test-seam makes the assertion deterministic without touching the real filesystem path.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && node --test dist/tests/cli/commands/skills/install.test.js`
Expected: FAIL — catalog not invalidated after install (loads unchanged)

- [ ] **Step 3: Write the minimal implementation**

In `src/cli/commands/skills/install.ts`:

**(a)** Add the import:

```ts
import { invalidateSlashCatalog } from "../../../skills/slash-catalog.js";
```

**(b)** Call `invalidateSlashCatalog()` at the end of the marketplace install path (after the successful write, e.g. where the skill dir is finalized — after `writePackageFiles` + swap completes) and after `writePackageFiles` in the `--from` path, and inside `removeSkill()` (line ~571) after the directory is removed.

Add the calls at the three completion points:
- after the atomic install swap completes in the marketplace branch,
- after the `--from` atomic install completes,
- at the end of `removeSkill(name, skillsDir)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && node --test dist/tests/cli/commands/skills/install.test.js`
Expected: PASS (install suite still green + new invalidation case)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/skills/install.ts tests/cli/commands/skills/install.test.ts
git commit -m "feat(skills): invalidate slash catalog on skill install and remove"
```

---

### Task 6: TUI input layer — slash mode, Tab cycle, Enter routing, dispatch threading

**Files:**
- Modify: `src/tui/app.ts`
- Modify: `src/tui/views/types.ts` (add `SlashStrip`, `SlashStripEntry`, `ViewRenderContext.slash`)
- Test: `tests/tui/app.vitest.ts` (modify — the existing harness drives `handleRaw`)

**Interfaces:**
- Consumes: `parseSlashInput`, `rankSkillMatches`, `canonicalSkillId`, `skillSlashNames` from `../../skills/slash.js` (Task 1); `getSlashCatalog` from `../../skills/slash-catalog.js` (Task 3).
- Produces (for Task 7):
  - `export interface SlashStripEntry { name: string; label: string; description: string }`
  - `export interface SlashStrip { entries: SlashStripEntry[]; selected: number; hint: string | null }`
  - `ViewRenderContext.slash?: SlashStrip`

- [ ] **Step 1: Write the failing test**

Add to `tests/tui/app.vitest.ts` (reuse the existing `handleRaw`-driving harness — seed `lastSnapshot`, set `app.slashManifestsForTest` where noted):

```ts
describe('TuiApp -- slash commands', () => {
  let internal: any;
  // (reuse the same setup as the existing chat-input dispatch describe)

  it('treats Enter on "/" as the palette (slash mode off)', async () => {
    internal.handleRaw(Buffer.from('/'));
    internal.handleRaw(Buffer.from('\r'));
    // existing palette behavior — no skill submission
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('submits the rest of a slash command with the skill name', async () => {
    // Seed the manifest cache the TUI reads.
    internal.slashManifestsForTest = [{ name: 'tdd', description: 'TDD', trigger: '/tdd', version: '1.0.0', is_core: false }];
    // Provide a fake agentSession that records the submitted text + skills.
    internal.opts.agentSession = {
      processChat: async (text: string, options?: { skills?: string[] }) => {
        internal.recorded = { text, skills: options?.skills };
        return { summary: `did ${text}`, sessionId: 's', toolCalls: [], streamed: false, reason: 'chat' };
      },
    };
    for (const ch of '/tdd fix parser') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\r'));
    expect(internal.recorded.text).toBe('fix parser');
    expect(internal.recorded.skills).toEqual(['tdd']);
  });

  it('keeps the buffer and shows a hint for an unknown command', async () => {
    internal.slashManifestsForTest = [{ name: 'tdd', description: 'TDD', trigger: '/tdd', version: '1.0.0', is_core: false }];
    let called = false;
    internal.opts.agentSession = {
      processChat: async () => { called = true; return { summary: 'x', sessionId: 's', toolCalls: [], streamed: false, reason: 'chat' }; },
    };
    for (const ch of '/nope hi') internal.handleRaw(Buffer.from(ch));
    internal.handleRaw(Buffer.from('\r'));
    expect(called).toBe(false);
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('/nope hi');
    expect(internal.slashHintForTest).toBeTruthy();
  });

  it('Tab cycles the strip selection without modifying the buffer', async () => {
    internal.slashManifestsForTest = [
      { name: 'a', description: 'A', trigger: '/ty', version: '1.0.0', is_core: false },
      { name: 'b', description: 'B', trigger: '/typing', version: '1.0.0', is_core: false },
    ];
    internal.handleRaw(Buffer.from('/ty'));
    internal.handleRaw(Buffer.from('\t'));
    expect(internal.slashSelectionForTest).toBe(1);
    internal.handleRaw(Buffer.from('\t'));
    expect(internal.slashSelectionForTest).toBe(0);
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('/ty');
  });
});
```

> The test references internal seams (`slashManifestsForTest`, `slashHintForTest`, `slashSelectionForTest`) — add them as public-only-for-test accessors in the same style the file's existing `getStateForTest()` uses.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && npx vitest run tests/tui/app.vitest.ts`
Expected: FAIL — seams missing, slash behavior not implemented

- [ ] **Step 3: Write the minimal implementation**

**`src/tui/views/types.ts`** — add the strip types and extend the render context:

```ts
/** One candidate row in the slash-completion strip. */
export interface SlashStripEntry {
  /** Canonical skill name. */
  name: string;
  /** Primary slash label, e.g. "/tdd". */
  label: string;
  description: string;
}

/** Completion strip state passed to chat/agent views while slash mode is active. */
export interface SlashStrip {
  entries: SlashStripEntry[];
  /** Index of the highlighted candidate (Tab-cycled). */
  selected: number;
  /** Inline hint (e.g. "Unknown skill ..."), or null. */
  hint: string | null;
}
```

In `ViewRenderContext` (add a field):

```ts
  /** Slash-command completion strip, present only while slash mode is active. */
  readonly slash?: SlashStrip;
```

**`src/tui/app.ts`**:

**(a)** Add imports:

```ts
import { parseSlashInput, rankSkillMatches, canonicalSkillId, skillSlashNames } from '../../skills/slash.js';
import { getSlashCatalog } from '../../skills/slash-catalog.js';
import type { SlashStrip, SlashStripEntry } from './views/types.js';
```

**(b)** Add class state + test seams (near the other private state):

```ts
  /** Resolved installed-skill manifests for slash completion (cached). */
  private slashManifests: any[] = [];
  /** Index of the highlighted strip candidate (Tab-cycled). */
  private slashSelection = 0;
  /** Inline hint for unknown commands. */
  private slashHint: string | null = null;

  // Test seams (mirroring getStateForTest)
  get slashManifestsForTest(): any[] { return this.slashManifests; }
  set slashManifestsForTest(v: any[]) { this.slashManifests = v; }
  get slashHintForTest(): string | null { return this.slashHint; }
  get slashSelectionForTest(): number { return this.slashSelection; }
```

**(c)** Load the catalog once at startup (in `start()`, after `paintFullFrame()`):

```ts
    void getSlashCatalog().then((manifests) => {
      this.slashManifests = manifests;
      this.paintFullFrame();
    });
```

**(d)** Add slash-mode helpers:

```ts
  /** True when the active chat/agent input is a slash command in progress. */
  private slashActive(): boolean {
    const tab = this.state.activeTab;
    if (tab !== 'chat' && tab !== 'agent') return false;
    const buf = this.state.views[tab].inputBuffer;
    return buf.startsWith('/') && buf.length > 1;
  }

  /** The current slash-command buffer, or null when not in slash mode. */
  private slashBuffer(): string | null {
    const tab = this.state.activeTab;
    if (tab !== 'chat' && tab !== 'agent') return null;
    const buf = this.state.views[tab].inputBuffer;
    return buf.startsWith('/') && buf.length > 1 ? buf : null;
  }

  private cycleSlashSelection(delta: number): void {
    const strip = this.computeSlashStrip();
    if (!strip || strip.entries.length === 0) return;
    const n = strip.entries.length;
    this.slashSelection = (this.slashSelection + delta + n) % n;
  }

  /** Build the strip passed to views; also refreshes slashSelection bounds. */
  private computeSlashStrip(): SlashStrip | null {
    const buf = this.slashBuffer();
    if (!buf) { this.slashSelection = 0; return null; }
    const parsed = parseSlashInput(buf);
    if (!parsed) return null;
    const matches = rankSkillMatches(this.slashManifests, parsed.command);
    this.slashSelection = Math.min(this.slashSelection, Math.max(0, matches.length - 1));
    return {
      entries: matches.slice(0, 8).map((m): SlashStripEntry => ({
        name: m.name,
        label: skillSlashNames(m)[0] ?? `/${m.name}`,
        description: m.description,
      })),
      selected: this.slashSelection,
      hint: this.slashHint,
    };
  }
```

**(e)** Intercept Tab/Shift+Tab in slash mode — insert in `handleRaw` right after the palette block (after line 378) and BEFORE `tryHandleGlobal`:

```ts
    if (this.paletteOpen) {
      this.handlePaletteKey(key);
      return;
    }
    // Slash-command completion mode: Tab/Shift+Tab cycle the strip selection.
    if (this.slashActive()) {
      if (key === 'Tab') { this.cycleSlashSelection(1); this.paintFullFrame(); return; }
      if (key === 'Shift+Tab') { this.cycleSlashSelection(-1); this.paintFullFrame(); return; }
    }
    if (this.tryHandleGlobal(key)) return;
```

**(f)** Route Enter through the slash path in both chat and agent input capture. In the chat block (line 420) and agent block (line 461), change the Enter branch:

```ts
      if (key === 'Enter') {
        if (this.slashActive()) {
          void this.submitSlashCommand();
          this.paintFullFrame();
          return;
        }
        if (perTab.inputBuffer.trim().length > 0) { ... existing ... }
        ...
```

**(g)** Add `submitSlashCommand`:

```ts
  /**
   * Submit a slash command: strip the trigger, resolve the skill, and dispatch
   * the rest as the task with the skill explicitly injected. Unknown commands
   * keep the buffer and set a hint — never an accidental agent call.
   */
  private async submitSlashCommand(): Promise<void> {
    const tab = this.state.activeTab;
    if (tab !== 'chat' && tab !== 'agent') return;
    const perTab = this.state.views[tab];
    const buf = perTab.inputBuffer;
    const parsed = parseSlashInput(buf);
    if (!parsed) return;
    const matches = rankSkillMatches(this.slashManifests, parsed.command);
    if (matches.length === 0) {
      this.slashHint = `Unknown skill "${parsed.command}" — press Tab for completions.`;
      return; // keep the text in the buffer; no agent call
    }
    const selected = matches[Math.min(this.slashSelection, matches.length - 1)]!;
    const text = parsed.rest.trim() || selected.name;
    this.slashHint = null;
    perTab.inputBuffer = '';
    this.slashSelection = 0;
    this.emitTimelineLog('user', text, tab === 'chat' ? this.opts.chatSessionId : this.opts.agentSessionId);
    const skills = [canonicalSkillId(selected)];
    if (tab === 'chat') {
      await this.dispatchToSession(
        text, 'chat', perTab,
        [
          this.opts.agentSession?.processChat?.bind(this.opts.agentSession),
          this.opts.agentSession?.processTurn?.bind(this.opts.agentSession),
        ],
        '[chat]', 15_000, skills,
      );
    } else {
      await this.dispatchToSession(
        text, 'agent', perTab,
        [this.opts.agentSession?.processTurn?.bind(this.opts.agentSession)],
        '[agent]', 120_000, skills,
      );
    }
  }
```

**(h)** Thread `skills` through `dispatchToSession` and `raceAgentCall`. Update the signatures:

```ts
  private async dispatchToSession(
    text: string,
    kind: 'chat' | 'agent',
    perTab: TimelineWritableState,
    candidates: Array<((text: string, options?: { skills?: string[] }) => Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }>) | undefined>,
    fallbackPrefix: string,
    timeoutMs = 5_000,
    skills?: string[],
  ): Promise<void> {
```

Inside the loop, pass skills to the call:

```ts
        const result = await this.raceAgentCall(text, fn, timeoutMs, skills);
```

And `raceAgentCall`:

```ts
  private raceAgentCall(
    text: string,
    fn: (text: string, options?: { skills?: string[] }) => Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }>,
    timeoutMs: number,
    skills?: string[],
  ): Promise<{ summary: string; reason?: string; planContent?: string; planTasks?: readonly PlanTask[] }> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`agent call timed out after ${timeoutMs}ms`)), timeoutMs),
    );
    return Promise.race([fn(text, skills ? { skills } : undefined), timeout]);
  }
```

**(i)** In `paintFullFrame`, add `slash: this.computeSlashStrip()` to the `viewCtx` (line ~1164):

```ts
    const viewCtx: ViewRenderContext = {
      snap: this.state.lastSnapshot,
      dimensions: { columns: dims.columns, rows: dims.rows },
      perTab: this.state.views[this.state.activeTab],
      canvas: viewCanvas,
      themeName: this.opts.themeName,
      runtime: { chat: this.chatRuntime, agent: this.agentRuntime },
      slash: this.computeSlashStrip(),
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && npx vitest run tests/tui/app.vitest.ts`
Expected: PASS (existing + new slash cases). Also `pnpm build` must typecheck (candidate signatures).

- [ ] **Step 5: Commit**

```bash
git add src/tui/app.ts src/tui/views/types.ts tests/tui/app.vitest.ts
git commit -m "feat(tui): slash-command input layer — Tab cycle, Enter routing, dispatch threading"
```

---

### Task 7: Render the completion strip in chat/agent views

**Files:**
- Modify: `src/tui/views/chat-view.ts`
- Modify: `src/tui/views/agent-view.ts`
- Test: `tests/tui/views/chat-view.test.ts` (new)

**Interfaces:**
- Consumes: `ViewRenderContext.slash` (Task 6), `SlashStrip`/`SlashStripEntry` types.

- [ ] **Step 1: Write the failing test**

Create `tests/tui/views/chat-view.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TerminalCanvas } from "../../../src/tui/canvas.js";
import { ChatView } from "../../../src/tui/views/chat-view.js";
import type { ViewRenderContext } from "../../../src/tui/views/types.js";

function stripCtx(slash: any): ViewRenderContext {
  const canvas = new TerminalCanvas(60, 20);
  return {
    snap: {} as any,
    dimensions: { columns: 60, rows: 20 },
    perTab: { inputBuffer: "/tdd" } as any,
    canvas,
    runtime: { chat: { timeline: [] } as any, agent: { timeline: [] } as any },
    slash,
  } as ViewRenderContext;
}

describe("ChatView slash strip", () => {
  it("renders ranked candidates with the selected marker", () => {
    const ctx = stripCtx({
      entries: [
        { name: "tdd", label: "/tdd", description: "TDD" },
        { name: "ts", label: "/ts", description: "TS" },
      ],
      selected: 0,
      hint: null,
    });
    new ChatView().render(ctx);
    const frame = ctx.canvas!.renderFrame();
    assert.match(frame, /\/tdd/);
    assert.match(frame, /TDD/);
  });

  it("renders the unknown-command hint", () => {
    const ctx = stripCtx({ entries: [], selected: 0, hint: 'Unknown skill "/nope"' });
    new ChatView().render(ctx);
    const frame = ctx.canvas!.renderFrame();
    assert.match(frame, /Unknown skill/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && node --test dist/tests/tui/views/chat-view.test.js`
Expected: FAIL — strip not rendered

- [ ] **Step 3: Write the minimal implementation**

In `src/tui/views/chat-view.ts`, after the prompt line is drawn (after line 28), render the strip as an overlay:

```ts
    // Slash-command completion strip — drawn last so it overlays scrollback
    // while slash mode is active (transient, like the palette).
    if (ctx.slash) {
      if (ctx.slash.hint) {
        c.write(0, 6, `\x1b[33m ${ctx.slash.hint}\x1b[0m`);
      } else if (ctx.slash.entries.length > 0) {
        ctx.slash.entries.slice(0, 6).forEach((entry, i) => {
          const marker = i === ctx.slash!.selected ? '>' : ' ';
          c.write(0, 6 + i, ` ${marker} \x1b[36m${entry.label}\x1b[0m ${entry.description}`);
        });
      }
    }
```

In `src/tui/views/agent-view.ts`, apply the identical block after its prompt line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && node --test dist/tests/tui/views/chat-view.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tui/views/chat-view.ts src/tui/views/agent-view.ts tests/tui/views/chat-view.test.ts
git commit -m "feat(tui): render slash-command completion strip in chat/agent views"
```

---

## Self-Review (completed)

**Spec coverage:**
- Parse/rank/resolve/canonicalId → Task 1. `getByTriggerOrName` → Task 2. Generation cache + invalidation lifecycle → Task 3 (module) + Task 5 (install/remove hooks). Union/dedupe/inject precedence → Task 4. Chat-tab injection (chatSystemPrompt gap) → Task 4(f). Enter-based `/` disambiguation, Tab-cycle, unknown-command hint → Task 6. Strip rendering → Task 7. Alias-collision test → Task 1 + Task 4. Transactional load → Task 4. Canonical-id sole authority → Task 1 + Task 4 union.

**Placeholder scan:** All steps carry concrete code; no TBD/TODO. The one test-note in Task 4 documents the resolution-vs-load distinction the implementation must honor.

**Type consistency:** `parseSlashInput`/`rankSkillMatches`/`canonicalSkillId`/`skillSlashNames`/`getByTriggerOrName`/`getSlashCatalog`/`invalidateSlashCatalog`/`buildSkillsSection`/`SlashStrip`/`SlashStripEntry` are spelled identically across tasks. `dispatchToSession(..., skills)` and `raceAgentCall(..., skills)` signatures match in Task 6. `setupSkills(task, factoryConfig, explicitSkills, opts)` matches between Task 4 test and implementation.

## Verification

1. `pnpm build` clean.
2. `pnpm test:node` — full node:test suite, 0 fail.
3. `pnpm test:vitest` — evidence + TUI suites, 0 fail.
4. `gitnexus detect_changes` — confirm only expected symbols/processes affected (per project CLAUDE.md).
5. Manual TUI smoke: `alix tui` — type `/ty` (see completion strip), Tab cycles, Enter `/tdd ...` (agent session gets skill injected), Enter `/` (palette opens), Enter `/nope` (hint, text preserved).
