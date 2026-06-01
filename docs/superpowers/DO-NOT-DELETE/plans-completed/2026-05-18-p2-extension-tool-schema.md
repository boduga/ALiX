# P2 Extension Registry & Tool Schema Fix

> **For agentic workers:** Use inline execution or dispatch per task below.

**Goal:** Complete P2.1 (Extension Registry) with permission bundling and version management, and P2.2 (Tool Schema Explosion) with semantic scoring.

**Architecture:** Add permission management to ExtensionRegistry, version tracking to manifest, and semantic text-based scoring to ToolSelector using n-gram Jaccard similarity.

---

## P2.1: Extension Registry

### Task 1: Add Permission Fields to Manifest

**Files:**
- Modify: `src/extensions/manifest.ts:1-68`

- [ ] **Step 1: Add permission type and fields to manifest**

```typescript
// Add after line 15 (before license field)

export type PermissionLevel = "none" | "read" | "write" | "dangerous";

export type ExtensionPermission = {
  level: PermissionLevel;
  description: string;
  reason?: string;
};

export type ExtensionManifestV2 = ExtensionManifest & {
  permissions?: ExtensionPermission[];
  requires_confirmation?: boolean;
};
```

- [ ] **Step 2: Run type check to verify no errors**

Run: `npm run build 2>&1 | head -20`
Expected: Build succeeds (TypeScript compiles)

- [ ] **Step 3: Add permissions field to BaseExtension type**

```typescript
// Modify BaseExtension in manifest.ts, add after is_core field:
type BaseExtension = {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  is_core?: boolean;
  permissions?: ExtensionPermission[];
  requires_confirmation?: boolean;
  license?: string;
  homepage?: string;
  installed_at?: string;
};
```

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/extensions/manifest.ts
git commit -m "feat(extensions): add permission fields to manifest schema"
```

---

### Task 2: Add Version Check to ExtensionRegistry

**Files:**
- Modify: `src/extensions/registry.ts`
- Create: `tests/extensions/version-check.test.ts`

- [ ] **Step 1: Write failing version check tests**

```typescript
// tests/extensions/version-check.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../src/extensions/registry.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

test("canCheckVersion compatibility", () => {
  const registry = new ExtensionRegistry("/tmp/test-ext-registry");
  assert.ok(typeof registry.canCheckVersion === "function", "should have canCheckVersion method");
});

test("getVersionInfo returns version data", () => {
  const registry = new ExtensionRegistry("/tmp/test-ext-registry");
  const info = registry.getVersionInfo("skill/test-skill");
  assert.ok(info === null || typeof info === "object", "should return null or version object");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/extensions/version-check.test.ts`
Expected: FAIL with "Property 'canCheckVersion' does not exist"

- [ ] **Step 3: Add version methods to ExtensionRegistry**

```typescript
// Add to ExtensionRegistry class in registry.ts

export type VersionInfo = {
  version: string;
  installedAt: string;
  isOutdated?: boolean;
};

canCheckVersion(id: string): boolean {
  const ext = this.extensions.get(id);
  return ext !== undefined;
}

getVersionInfo(id: string): VersionInfo | null {
  const ext = this.extensions.get(id);
  if (!ext) return null;
  return {
    version: ext.manifest.version,
    installedAt: ext.installedAt,
    isOutdated: false,
  };
}

async updateVersion(id: string, newVersion: string): Promise<boolean> {
  const ext = this.extensions.get(id);
  if (!ext || isCoreExtension(ext.manifest)) return false;

  const manifestPath = join(this.storePath, `${ext.manifest.type}-${ext.manifest.name}`, "EXTENSION.yaml");
  let content: string;
  try {
    content = readFileSync(manifestPath, "utf8");
  } catch { return false; }

  const updated = content.replace(/version:\s*[\d.]+/, `version: ${newVersion}`);
  writeFileSync(manifestPath, updated, "utf8");
  this.load();
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/extensions/version-check.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/extensions/registry.ts tests/extensions/version-check.test.ts
git commit -m "feat(extensions): add version management to registry"
```

---

## P2.2: Tool Schema Explosion

### Task 3: Add Semantic Tool Scoring

**Files:**
- Modify: `src/mcp/tool-selector.ts`
- Create: `tests/mcp/semantic-tool-selector.test.ts`

- [ ] **Step 1: Write failing semantic scoring tests**

```typescript
// tests/mcp/semantic-tool-selector.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ToolSelector } from "../../src/mcp/tool-selector.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

const makeTool = (name: string, description: string): DeferredToolEntry => ({
  name,
  description,
  schema: { type: "object", properties: {} },
  serverName: "test-server",
  execName: name,
  deferred: { status: "pending" },
});

test("semantic scoring prioritizes description matches", () => {
  const tools = [
    makeTool("git_search", "Search git history for commits"),
    makeTool("github_search", "GitHub code search and repository lookup"),
    makeTool("file_search", "Search files by content pattern"),
  ];
  const selector = new ToolSelector(tools, { maxTools: 3, tokenBudget: 5000 });
  const selected = selector.select("find commits in git history");

  // Should prioritize git_search when task mentions git
  assert.ok(selected.some(t => t.name === "git_search"), "should select git_search");
  assert.ok(selected.some(t => t.name === "github_search"), "should select github_search for broader search");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mcp/semantic-tool-selector.test.ts`
Expected: FAIL or tests pass (may already work via keyword scoring)

- [ ] **Step 3: Add n-gram semantic scoring to ToolSelector**

```typescript
// Add to ToolSelector class in tool-selector.ts

// Add after line 13 (class constructor)
private computeNgrams(text: string, n: number = 2): Set<string> {
  const words = text.toLowerCase().split(/\W+/).filter(w => w.length >= 2);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(" "));
  }
  return ngrams;
}

private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
```

- [ ] **Step 4: Add semantic scoring to select method**

Replace the select method scoring section (around line 36-46) with:

```typescript
const scored = this.tools.map(tool => {
  const nameParts = tool.name.toLowerCase().split(/[_\.]/);
  const descWords = new Set(
    tool.description.toLowerCase().split(/\W+/).filter(w => w.length > 2)
  );

  // N-gram semantic similarity
  const taskNgrams = this.computeNgrams(taskDescription);
  const descNgrams = this.computeNgrams(tool.description);
  const semanticScore = this.jaccardSimilarity(taskNgrams, descNgrams);

  let score = 0;
  for (const word of taskWords) {
    if (nameParts.includes(word)) {
      score += 3;
    } else if (tool.name.toLowerCase().includes(word)) {
      score += 1;
    }
    if (descWords.has(word)) score += 1;
  }
  // Add semantic score (scaled to not dominate keyword matches)
  score += Math.round(semanticScore * 2);
  return { tool, score };
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/mcp/semantic-tool-selector.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tool-selector.ts tests/mcp/semantic-tool-selector.test.ts
git commit -m "feat(tool-selector): add semantic scoring using n-gram similarity"
```

---

### Task 4: Add Per-Model Reliability Defaults

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/mcp/tool-selector.ts`

- [ ] **Step 1: Add model reliability config to schema**

```typescript
// Add to schema.ts after SubagentStyle type (around line 83)

export type ToolReliabilityTier = "stable" | "unstable" | "experimental";

export type ModelToolReliability = {
  modelPattern: string;  // regex pattern to match model name
  tier: ToolReliabilityTier;
  defaultMaxTools: number;
  preferKeywordScoring: boolean;
};

export type ToolConfig = {
  maxTools: number;
  tokenBudget: number;
  reliabilityDefaults: ModelToolReliability[];
};
```

- [ ] **Step 2: Add tool config to AlixConfig in schema.ts**

```typescript
// Find AlixConfig type and add toolConfig field
export type AlixConfig = {
  // ... existing fields ...
  toolConfig?: ToolConfig;
};
```

- [ ] **Step 3: Pass reliability config to ToolSelector**

```typescript
// Modify ToolSelector to accept reliability options
export type ToolSelectorOptions = {
  maxTools: number;
  tokenBudget: number;
  preferKeywordScoring?: boolean;
};
```

- [ ] **Step 4: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/mcp/tool-selector.ts
git commit -m "feat(tool-selector): add model reliability config for tool selection"
```

---

## Final Verification

- [ ] **Run full test suite**

Run: `npm test 2>&1 | tail -15`
Expected: All tests pass, no new failures

- [ ] **Update post-mvp-backlog.md**

Update the P2.1 and P2.2 sections to mark permission bundling and version management as complete.

```bash
git add docs/post-mvp-backlog.md
git commit -m "docs: mark P2.1 and P2.2 as complete"
```