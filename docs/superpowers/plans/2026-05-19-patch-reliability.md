# Patch Reliability Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete PatchEngine with full validation, PreimageValidator, and FullFileRewriteGuard per research spec.

**Architecture:** Build on existing patch protocol. Add validation layer before applying patches. Add guard for full-file rewrites on existing files.

**Tech Stack:** TypeScript, existing patch engine, event log

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/patch/preimage-validator.ts` | Validate file state before applying patches |
| `src/patch/full-file-guard.ts` | Guard against full-file rewrites of existing files |
| `src/patch/checkpoint-manager.ts` | Create git/internal checkpoints before edits |
| `src/patch/rollback-manager.ts` | Restore files from checkpoints |
| `tests/patch/preimage-validator.test.ts` | Preimage validation tests |
| `tests/patch/full-file-guard.test.ts` | Full-file guard tests |

---

## Task 1: Add PreimageValidator

**Files:**
- Create: `src/patch/preimage-validator.ts`
- Test: `tests/patch/preimage-validator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { PreimageValidator } from "../../src/patch/preimage-validator.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("PreimageValidator", () => {
  const testDir = join(process.cwd(), ".test-preimage");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("validates matching preimage hash", async () => {
    const validator = new PreimageValidator();
    const filePath = join(testDir, "test.ts");
    const content = "export const x = 1;\n";
    await writeFile(filePath, content);

    const hash = hashContent(content);
    const result = await validator.validate(filePath, hash);
    assert.equal(result.valid, true);
  });

  it("rejects stale patch with mismatched hash", async () => {
    const validator = new PreimageValidator();
    const filePath = join(testDir, "test.ts");
    await writeFile(filePath, "export const x = 2;\n");

    const staleHash = hashContent("export const x = 1;\n");
    const result = await validator.validate(filePath, staleHash);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes("stale"));
  });

  it("rejects patch for non-existent file with preimage requirement", async () => {
    const validator = new PreimageValidator();
    const result = await validator.validate("/non/existent/file.ts", "somehash");
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes("not found"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/patch/preimage-validator.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement PreimageValidator**

```typescript
// src/patch/preimage-validator.ts

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

export type ValidationResult = {
  valid: boolean;
  reason?: string;
  actualHash?: string;
  expectedHash?: string;
};

export class PreimageValidator {
  async validate(filePath: string, expectedHash: string): Promise<ValidationResult> {
    if (!existsSync(filePath)) {
      return {
        valid: false,
        reason: `File not found: ${filePath}`,
        expectedHash,
      };
    }

    const content = await readFile(filePath, "utf8");
    const actualHash = this.hashContent(content);

    if (actualHash !== expectedHash) {
      return {
        valid: false,
        reason: "Stale patch: file has been modified since read",
        actualHash,
        expectedHash,
      };
    }

    return { valid: true };
  }

  hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  async generateCheckpoint(filePath: string): Promise<string> {
    const content = await readFile(filePath, "utf8");
    return this.hashContent(content);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/patch/preimage-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/preimage-validator.ts tests/patch/preimage-validator.test.ts
git commit -m "feat(patch): add PreimageValidator for stale patch detection"
```

---

## Task 2: Add FullFileRewriteGuard

**Files:**
- Create: `src/patch/full-file-guard.ts`
- Test: `tests/patch/full-file-guard.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { FullFileRewriteGuard, type RewriteDecision } from "../../src/patch/full-file-guard.js";

describe("FullFileRewriteGuard", () => {
  it("allows full-file for new files", async () => {
    const guard = new FullFileRewriteGuard();
    const decision = await guard.evaluate({
      path: "src/new-file.ts",
      isNewFile: true,
      sizeBytes: 500,
      isGenerated: false,
    });
    assert.equal(decision.allowed, true);
  });

  it("denies full-file rewrite for existing human-authored files", async () => {
    const guard = new FullFileRewriteGuard();
    const decision = await guard.evaluate({
      path: "src/existing.ts",
      isNewFile: false,
      sizeBytes: 2000,
      isGenerated: false,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason.includes("existing"));
  });

  it("allows full-file for generated files with approval", async () => {
    const guard = new FullFileRewriteGuard();
    const decision = await guard.evaluate({
      path: "dist/generated.js",
      isNewFile: false,
      sizeBytes: 5000,
      isGenerated: true,
      hasApproval: true,
    });
    assert.equal(decision.allowed, true);
  });

  it("requires approval for large files", async () => {
    const guard = new FullFileRewriteGuard({ largeFileThreshold: 1000 });
    const decision = await guard.evaluate({
      path: "src/large.ts",
      isNewFile: true,
      sizeBytes: 2000,
      isGenerated: false,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.requiredApproval, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/patch/full-file-guard.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement FullFileRewriteGuard**

```typescript
// src/patch/full-file-guard.ts

export type RewriteContext = {
  path: string;
  isNewFile: boolean;
  sizeBytes: number;
  isGenerated: boolean;
  hasApproval?: boolean;
};

export type RewriteDecision = {
  allowed: boolean;
  reason?: string;
  requiredApproval?: boolean;
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java"];
const GENERATED_PATTERNS = [/^dist\//, /^build\//, /_generated\./, /\.min\.(js|css)$/];

export class FullFileRewriteGuard {
  constructor(
    private options: {
      largeFileThreshold?: number;
      sourceExtensions?: string[];
    } = {}
  ) {}

  async evaluate(ctx: RewriteContext): Promise<RewriteDecision> {
    const { largeFileThreshold = 5000 } = this.options;

    // New files are generally allowed
    if (ctx.isNewFile) {
      if (ctx.sizeBytes > largeFileThreshold && !ctx.hasApproval) {
        return {
          allowed: false,
          requiredApproval: true,
          reason: "Large new file requires approval",
        };
      }
      return { allowed: true };
    }

    // Existing files need more scrutiny
    if (this.isGeneratedFile(ctx.path)) {
      if (ctx.hasApproval) {
        return { allowed: true };
      }
      return {
        allowed: false,
        requiredApproval: true,
        reason: "Generated file rewrite requires approval",
      };
    }

    if (this.isSourceFile(ctx.path)) {
      return {
        allowed: false,
        reason: "Full-file rewrite of existing source file denied. Use structured patch or search/replace.",
      };
    }

    // Non-source existing files
    if (ctx.hasApproval) {
      return { allowed: true };
    }

    return {
      allowed: false,
      requiredApproval: true,
      reason: "Full-file rewrite of existing file requires approval",
    };
  }

  private isSourceFile(path: string): boolean {
    const ext = path.substring(path.lastIndexOf("."));
    return SOURCE_EXTENSIONS.includes(ext);
  }

  private isGeneratedFile(path: string): boolean {
    return GENERATED_PATTERNS.some((p) => p.test(path));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/patch/full-file-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/full-file-guard.ts tests/patch/full-file-guard.test.ts
git commit -m "feat(patch): add FullFileRewriteGuard for rewrite protection"
```

---

## Task 3: Add CheckpointManager

**Files:**
- Create: `src/patch/checkpoint-manager.ts`
- Test: `tests/patch/checkpoint-manager.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { CheckpointManager } from "../../src/patch/checkpoint-manager.js";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("CheckpointManager", () => {
  const testDir = join(process.cwd(), ".test-checkpoints");
  let manager: CheckpointManager;

  beforeEach(async () => {
    manager = new CheckpointManager(testDir);
    await manager.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates checkpoint for file", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "original content");
    
    const checkpoint = await manager.createCheckpoint(filePath);
    assert.ok(checkpoint.id);
    assert.ok(checkpoint.path);
    
    // Modify file
    await writeFile(filePath, "modified content");
    
    // Restore
    await manager.restore(checkpoint.id);
    const restored = await readFile(filePath, "utf8");
    assert.equal(restored, "original content");
  });

  it("lists checkpoints for session", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "content");
    
    const checkpoint = await manager.createCheckpoint(filePath);
    const list = await manager.listCheckpoints();
    
    assert.ok(list.some(c => c.id === checkpoint.id));
  });

  it("deletes checkpoint", async () => {
    const filePath = join(testDir, "test.txt");
    await writeFile(filePath, "content");
    
    const checkpoint = await manager.createCheckpoint(filePath);
    await manager.deleteCheckpoint(checkpoint.id);
    
    const list = await manager.listCheckpoints();
    assert.ok(!list.some(c => c.id === checkpoint.id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/patch/checkpoint-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CheckpointManager**

```typescript
// src/patch/checkpoint-manager.ts

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export type Checkpoint = {
  id: string;
  path: string;
  originalPath: string;
  createdAt: string;
  sessionId: string;
};

export class CheckpointManager {
  private sessionId: string;
  private checkpointsDir: string;
  private checkpoints: Map<string, Checkpoint> = new Map();

  constructor(
    private baseDir: string,
    sessionId?: string
  ) {
    this.sessionId = sessionId ?? `session_${Date.now()}`;
    this.checkpointsDir = join(baseDir, ".alix", "checkpoints");
  }

  async init(): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
  }

  async createCheckpoint(filePath: string): Promise<Checkpoint> {
    if (!existsSync(filePath)) {
      throw new Error(`Cannot checkpoint non-existent file: ${filePath}`);
    }

    const content = await readFile(filePath);
    const id = randomUUID();
    const checkpointPath = join(this.checkpointsDir, `${id}.checkpoint`);

    await writeFile(checkpointPath, content);

    const checkpoint: Checkpoint = {
      id,
      path: checkpointPath,
      originalPath: filePath,
      createdAt: new Date().toISOString(),
      sessionId: this.sessionId,
    };

    this.checkpoints.set(id, checkpoint);
    return checkpoint;
  }

  async restore(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    const content = await readFile(checkpoint.path);
    await writeFile(checkpoint.originalPath, content);
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    this.checkpoints.delete(checkpointId);
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    return [...this.checkpoints.values()];
  }

  async cleanup(): Promise<void> {
    for (const checkpoint of this.checkpoints.values()) {
      await this.deleteCheckpoint(checkpoint.id);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/patch/checkpoint-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/patch/checkpoint-manager.ts tests/patch/checkpoint-manager.test.ts
git commit -m "feat(patch): add CheckpointManager for edit safety"
```

---

## Verification

```bash
npm test -- tests/patch/preimage-validator.test.ts tests/patch/full-file-guard.test.ts tests/patch/checkpoint-manager.test.ts
```

All tests should pass. Manual verification:
- [ ] PreimageValidator detects stale patches
- [ ] FullFileRewriteGuard blocks source file rewrites
- [ ] CheckpointManager creates and restores checkpoints
- [ ] Patch protocol includes validation step