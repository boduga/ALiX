# Sub-Project #5: Self-Extensibility Improvements

**Date:** 2026-05-31
**Status:** Draft
**Parent Project:** What ALiX Can Learn From Pi Agent
**Source:** [earendil-works/pi](https://github.com/earendil-works/pi) "self-extensible" agent design

## Motivation

Pi Agent is described as **"self-extensible"** — the agent can be customized and extended from within itself. ALiX already has a robust extension system (`src/extensions/`, `src/skills/`), but the agent cannot:

1. **Author new skills at runtime** — no tool for "create a new skill"
2. **Inspect existing extensions** — no `list_extensions` or `inspect_extension` tool
3. **Register extensions in-process** — must write manifest files first, then restart
4. **Modify its own behavior** — once running, configuration is locked

These gaps mean the agent operates on a fixed configuration — it can use what exists but cannot grow new capabilities mid-run.

## Goals

1. **Add `create_skill` tool** — agent can author a new skill at runtime and have it loaded immediately
2. **Add `list_extensions` tool** — agent can introspect what's available
3. **Add `inspect_extension` tool** — agent can see what an extension does
4. **In-process extension registration** — new skills/hooks become active without restart
5. **Preserve existing API** — zero changes for current consumers

## Non-Goals

- Replacing the existing extension system
- Adding `create_recipe` or `create_subagent` tools (out of scope; skills is the entry point)
- Hot-reloading of file-based extensions (only new in-process ones)
- Cross-session persistence of in-process extensions

## Architecture

### Current State
```
src/extensions/        (file-based registry, manifest, hooks, skill-loader)
src/skills/           (catalog, dispatcher, factory, loader, promotion)
```
Extensions are loaded at startup from `~/.alix/extensions/`. To add a new one, you write a manifest file + handler.

### Target State
```
src/extensions/       (existing — unchanged)
src/skills/          (existing — extended with in-process registration)
src/self-extend/     (NEW: tools for runtime extension)
  ├── create-skill.ts       (create_skill tool)
  ├── list-extensions.ts    (list_extensions tool)
  ├── inspect-extension.ts  (inspect_extension tool)
  └── registry.ts           (in-process extension registry)
```

### New Tools

**1. `create_skill` tool**

Creates a new skill in-process and registers it for immediate use.

```typescript
// Arguments:
{
  name: string;        // Unique skill name
  description: string; // What the skill does
  trigger: string;     // Pattern that activates it
  body: string;        // Skill body (markdown)
  isCore?: boolean;    // Protected from eviction
}

// Behavior:
// - Validates name uniqueness
// - Registers skill in catalog
// - Returns skill ID
```

**2. `list_extensions` tool**

Returns metadata about all loaded extensions.

```typescript
// Arguments: none
// Returns:
{
  skills: Array<{ name: string; description: string; trigger: string; isCore: boolean }>;
  hooks: Array<{ name: string; trigger: string }>;
  mcp: Array<{ name: string }>;
  recipes: Array<{ name: string }>;
  subagents: Array<{ name: string }>;
}
```

**3. `inspect_extension` tool**

Returns detailed info about a specific extension.

```typescript
// Arguments:
{
  type: "skill" | "hook" | "mcp" | "recipe" | "subagent";
  name: string;
}

// Returns:
{
  manifest: ExtensionManifest;
  metadata: { loadTime: number; source: "file" | "in-process"; }
}
```

### In-Process Registry

`src/self-extend/registry.ts` — Singleton registry that holds in-process extensions and exposes registration APIs:

```typescript
export type InProcessExtension = {
  type: "skill" | "hook" | "mcp" | "recipe" | "subagent";
  name: string;
  manifest: ExtensionManifest;
  registeredAt: number;
};

const inProcessExtensions = new Map<string, InProcessExtension>();

export function registerInProcess(ext: InProcessExtension): void {
  // Validate uniqueness
  // Add to map
  // Trigger subscribers
}

export function unregisterInProcess(type: string, name: string): void {
  // Remove from map
}

export function listInProcess(): InProcessExtension[] {
  return Array.from(inProcessExtensions.values());
}
```

The `list_extensions` and `inspect_extension` tools query both the file-based registry AND the in-process registry, merging results.

## Data Flow

```
Agent decides "I need a skill for X"
  ↓
Calls create_skill tool
  ↓
create-skill.ts calls registerInProcess()
  ↓
In-process registry stores + notifies subscribers
  ↓
Skill catalog picks up the new skill
  ↓
Subsequent skill dispatches can use the new skill
```

## Error Handling

- Duplicate name → throw `Error("Extension already exists: <name>")`
- Invalid manifest → throw `Error("Invalid manifest: <reason>")`
- Permission denied (e.g., trying to override core) → throw `Error("Cannot override core extension")`

## Testing Strategy

### Unit tests (TDD)
```
tests/self-extend/
├── create-skill.test.ts
├── list-extensions.test.ts
├── inspect-extension.test.ts
└── registry.test.ts
```

### Integration tests
```
tests/self-extend/integration.test.ts
- "create_skill then list_extensions shows the new skill"
- "create_skill then dispatch finds and runs the new skill"
- "inspect_extension returns metadata for file-based skills"
```

## Files Affected

| Action | File | Reason |
|--------|------|--------|
| ➕ New | `src/self-extend/registry.ts` | In-process registry |
| ➕ New | `src/self-extend/create-skill.ts` | `create_skill` tool |
| ➕ New | `src/self-extend/list-extensions.ts` | `list_extensions` tool |
| ➕ New | `src/self-extend/inspect-extension.ts` | `inspect_extension` tool |
| ➕ New | `tests/self-extend/registry.test.ts` | Registry tests |
| ➕ New | `tests/self-extend/create-skill.test.ts` | Tool tests |
| ➕ New | `tests/self-extend/list-extensions.test.ts` | Tool tests |
| ➕ New | `tests/self-extend/inspect-extension.test.ts` | Tool tests |
| ➕ New | `tests/self-extend/integration.test.ts` | End-to-end |
| ✏️ Modify | `src/tools/tool-router.ts` | Register new tools (one line) |

## Migration Strategy

1. **Create `registry.ts` first** (TDD) — pure in-memory map
2. **Create `create-skill.ts`** that uses the registry
3. **Create `list-extensions.ts`** and `inspect-extension.ts`
4. **Register tools with the tool-router** — one line addition
5. **Integration test** — verify the full flow works

## Success Criteria

- [ ] 3 new tools: `create_skill`, `list_extensions`, `inspect_extension`
- [ ] In-process registry works
- [ ] Created skills are immediately dispatchable
- [ ] All existing tests pass (1175+ pass, 0 fail)
- [ ] New tests for all 3 tools + registry + integration

## Out of Scope (Other Sub-Projects)

- Sub-project #6: Public session sharing
