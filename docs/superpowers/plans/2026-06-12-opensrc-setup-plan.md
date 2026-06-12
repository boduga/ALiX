# opensrc Setup — Source Code Context for AI Agents

**Goal:** Give Claude Code/Codex CLI the actual source code of your key dependencies so they never hallucinate APIs from stale training data.

**Tool:** [opensrc](https://github.com/vercel-labs/opensrc) — fetches NPM package source or GitHub repos into a local cache that agents can read as context.

---

### Step 1: Fetch key packages

```bash
cd ~/Projects/Monolith

# Core runtime deps
npx opensrc fetch microsoft/typescript
npx opensrc fetch definitelytyped/DefinitelyTyped  # @types/*

# Frontend if applicable
npx opensrc fetch facebook/react
npx opensrc fetch vercel/next.js

# Utility packages you use
npx opensrc fetch lukeed/ms
```

All source lands in `~/.opensrc/repos/github.com/<org>/<repo>/<ref>/`

### Step 2: Add to CLAUDE.md

Append to `~/Projects/Monolith/CLAUDE.md`:

```markdown
## opensrc — Source Code Context

Key dependency source code is cached locally via opensrc and available as context.

Use `npx opensrc path <org/repo>` to get the absolute path, or reference opensrc
by name when asking about implementation details — the source code is available
locally and provides the ground truth for any API or framework.
```

### Step 3: Test it works

```bash
cd ~/Projects/Monolith
npx opensrc path microsoft/typescript
# → /home/babasola/.opensrc/repos/github.com/microsoft/typescript/master
```

### Step 4: Use it

When prompting Claude, include:

```markdown
Look at the opensrc cache for TypeScript source at ~/.opensrc/repos/github.com/microsoft/typescript/master
to understand how [specific feature] is implemented.
```
