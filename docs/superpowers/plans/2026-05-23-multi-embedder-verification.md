# Multi-Embedder Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-embedder-based verification scoring and historical failure matching to ALiX, inspired by ClipCannon's multi-modal embedding architecture.

**Architecture:** Layer embedding-based similarity scoring over existing test verification. Store failure embeddings in SQLite for KNN-based exemplar matching. When tests fail, query embeddings to find similar past failures and their solutions.

**Tech Stack:** TypeScript, SQLite with vector extension (sqlite-vec), existing verifier module, session log infrastructure

---

## File Structure

```
src/
  verifier/
    embedder/                    # NEW: Multi-embedder verification
      scorer.ts                  # Embedding-based verification scoring
      failure-db.ts              # SQLite-backed failure embeddings
      exemplar.ts                # Historical failure exemplar matching
      types.ts                   # Shared types
    verifier.ts                  # EXISTING: No changes needed
  config/
    reliability-matrix.ts        # EXISTING: Extend with embedder scoring

tests/
  verifier/
    embedder/
      scorer.test.ts
      failure-db.test.ts
      exemplar.test.ts
```

---

## Task 1: Embedder Types and Database Schema

**Files:**
- Create: `src/verifier/embedder/types.ts`
- Create: `tests/verifier/embedder/types.test.ts`

- [ ] **Step 1: Write failing test for types**

```typescript
// tests/verifier/embedder/types.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  VerificationEmbedding,
  FailureRecord,
  EmbedderConfig,
  SimilarityResult,
} from "../../../src/verifier/embedder/types.js";

describe("Embedder Types", () => {
  it("VerificationEmbedding has required fields", () => {
    const embedding: VerificationEmbedding = {
      id: "test-1",
      sessionId: "session-123",
      taskType: "research",
      filePatterns: ["src/**/*.ts"],
      errorPatterns: ["TypeError", "undefined"],
      toolSequence: ["file.read", "shell.run"],
      embedding: new Float32Array([0.1, 0.2, 0.3]),
      createdAt: Date.now(),
    };
    
    assert.ok(embedding.id);
    assert.ok(embedding.sessionId);
    assert.equal(embedding.embedding.length, 3);
  });

  it("FailureRecord includes resolution", () => {
    const record: FailureRecord = {
      id: "fail-1",
      sessionId: "session-123",
      task: "fix auth bug",
      errorSummary: "Cannot read property of undefined",
      fileChanges: ["src/auth.ts"],
      resolution: "Added null check before property access",
      resolvedAt: Date.now(),
      embeddingId: "test-1",
    };
    
    assert.ok(record.resolution);
    assert.ok(record.resolvedAt);
  });

  it("SimilarityResult includes score", () => {
    const result: SimilarityResult = {
      record: {} as FailureRecord,
      score: 0.85,
      matchedPatterns: ["TypeError"],
    };
    
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.matchedPatterns.length > 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verifier/embedder/types.test.ts`
Expected: FAIL with "cannot find module"

- [ ] **Step 3: Implement types**

```typescript
// src/verifier/embedder/types.ts

export interface VerificationEmbedding {
  id: string;
  sessionId: string;
  taskType: string;
  filePatterns: string[];
  errorPatterns: string[];
  toolSequence: string[];
  embedding: Float32Array;
  createdAt: number;
}

export interface FailureRecord {
  id: string;
  sessionId: string;
  task: string;
  errorSummary: string;
  fileChanges: string[];
  resolution: string;
  resolvedAt: number;
  embeddingId: string;
}

export interface EmbedderConfig {
  dimensions: number;
  modelName: string;
  provider: "local" | "api";
}

export interface SimilarityResult {
  record: FailureRecord;
  score: number;
  matchedPatterns: string[];
}

export interface EmbedderOptions {
  config: EmbedderConfig;
  dbPath: string;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verifier/embedder/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/embedder/types.ts tests/verifier/embedder/types.test.ts
git commit -m "feat(verification): add multi-embedder types"
```

---

## Task 2: Failure Database with SQLite

**Files:**
- Create: `src/verifier/embedder/failure-db.ts`
- Create: `tests/verifier/embedder/failure-db.test.ts`

- [ ] **Step 1: Write failing test for failure database**

```typescript
// tests/verifier/embedder/failure-db.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { FailureDatabase } from "../../../src/verifier/embedder/failure-db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

describe("FailureDatabase", () => {
  const dbPath = join(tmpdir(), "test-failures.db");
  
  afterEach(async () => {
    try {
      await unlink(dbPath);
    } catch {}
  });

  it("initializes database with schema", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();
    
    const tables = await db.listTables();
    assert.ok(tables.includes("failure_records"));
    assert.ok(tables.includes("embeddings"));
    
    await db.close();
  });

  it("inserts and retrieves failure record", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();
    
    const record = {
      id: "fail-1",
      sessionId: "session-123",
      task: "fix auth bug",
      errorSummary: "Cannot read property of undefined",
      fileChanges: ["src/auth.ts"],
      resolution: "Added null check",
      resolvedAt: Date.now(),
      embeddingId: "emb-1",
    };
    
    await db.insertFailure(record);
    
    const found = await db.getFailure("fail-1");
    assert.ok(found);
    assert.equal(found.task, "fix auth bug");
    
    await db.close();
  });

  it("searches by similarity using vector distance", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();
    
    // Insert test records
    await db.insertFailure({
      id: "fail-1",
      sessionId: "s1",
      task: "TypeError in auth",
      errorSummary: "Cannot read property 'name' of null",
      fileChanges: ["auth.ts"],
      resolution: "Added null check",
      resolvedAt: Date.now(),
      embeddingId: "emb-1",
    });
    
    // Search with similar query
    const results = await db.searchByEmbedding(
      new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]), // query embedding
      5, // top K
      0.7 // threshold
    );
    
    assert.ok(Array.isArray(results));
    
    await db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verifier/embedder/failure-db.test.ts`
Expected: FAIL with "cannot find module"

- [ ] **Step 3: Implement failure database**

```typescript
// src/verifier/embedder/failure-db.ts
import { Database } from "better-sqlite3";
import type { FailureRecord, EmbedderConfig } from "./types.js";

export class FailureDatabase {
  private db: Database;
  
  constructor(private dbPath: string) {
    this.db = new Database(dbPath);
  }
  
  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS failure_records (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task TEXT NOT NULL,
        error_summary TEXT,
        file_changes TEXT,
        resolution TEXT,
        resolved_at INTEGER,
        embedding_id TEXT
      );
      
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        metadata TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_session ON failure_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_resolved ON failure_records(resolved_at);
    `);
  }
  
  async listTables(): Promise<string[]> {
    const rows = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all() as { name: string }[];
    return rows.map(r => r.name);
  }
  
  async insertFailure(record: FailureRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO failure_records 
      (id, session_id, task, error_summary, file_changes, resolution, resolved_at, embedding_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      record.id,
      record.sessionId,
      record.task,
      record.errorSummary,
      JSON.stringify(record.fileChanges),
      record.resolution,
      record.resolvedAt,
      record.embeddingId
    );
  }
  
  async getFailure(id: string): Promise<FailureRecord | null> {
    const row = this.db.prepare(
      "SELECT * FROM failure_records WHERE id = ?"
    ).get(id) as any;
    
    if (!row) return null;
    
    return {
      id: row.id,
      sessionId: row.session_id,
      task: row.task,
      errorSummary: row.error_summary,
      fileChanges: JSON.parse(row.file_changes || "[]"),
      resolution: row.resolution,
      resolvedAt: row.resolved_at,
      embeddingId: row.embedding_id,
    };
  }
  
  async searchByEmbedding(
    query: Float32Array,
    topK: number,
    threshold: number
  ): Promise<Array<{ record: FailureRecord; score: number }>> {
    // Simple cosine similarity implementation
    // For production, use sqlite-vec extension for vector operations
    const rows = this.db.prepare(
      "SELECT * FROM failure_records WHERE resolution IS NOT NULL LIMIT 100"
    ).all() as any[];
    
    const results: Array<{ record: FailureRecord; score: number }> = [];
    
    for (const row of rows) {
      // In production, vectors would be stored and compared using sqlite-vec
      // For MVP, use heuristic scoring based on text similarity
      const textSim = this.textSimilarity(query, row);
      if (textSim >= threshold) {
        results.push({
          record: {
            id: row.id,
            sessionId: row.session_id,
            task: row.task,
            errorSummary: row.error_summary,
            fileChanges: JSON.parse(row.file_changes || "[]"),
            resolution: row.resolution,
            resolvedAt: row.resolved_at,
            embeddingId: row.embedding_id,
          },
          score: textSim,
        });
      }
    }
    
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  private textSimilarity(_query: Float32Array, row: any): number {
    // Heuristic: check for common error patterns
    const patterns = ["TypeError", "undefined", "null", "Cannot read"];
    let score = 0;
    
    const text = `${row.task} ${row.error_summary} ${row.resolution}`.toLowerCase();
    
    for (const pattern of patterns) {
      if (text.includes(pattern.toLowerCase())) {
        score += 0.2;
      }
    }
    
    return Math.min(score, 1);
  }
  
  async close(): Promise<void> {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verifier/embedder/failure-db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/embedder/failure-db.ts tests/verifier/embedder/failure-db.test.ts
git commit -m "feat(verification): add FailureDatabase for storing failure embeddings"
```

---

## Task 3: Embedding Scorer

**Files:**
- Create: `src/verifier/embedder/scorer.ts`
- Create: `tests/verifier/embedder/scorer.test.ts`

- [ ] **Step 1: Write failing test for scoring**

```typescript
// tests/verifier/embedder/scorer.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { EmbeddingScorer } from "../../../src/verifier/embedder/scorer.js";

describe("EmbeddingScorer", () => {
  it("creates embedding from verification context", async () => {
    const scorer = new EmbeddingScorer({ dimensions: 128, modelName: "test", provider: "local" });
    
    const context = {
      taskType: "research",
      files: ["src/auth.ts", "src/user.ts"],
      errors: ["TypeError: Cannot read property 'name' of undefined"],
      tools: ["file.read", "shell.run"],
    };
    
    const embedding = await scorer.createEmbedding(context);
    assert.ok(embedding);
    assert.equal(embedding.length, 128);
  });

  it("calculates cosine similarity between embeddings", async () => {
    const scorer = new EmbeddingScorer({ dimensions: 4, modelName: "test", provider: "local" });
    
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0, 0]);
    const c = new Float32Array([0, 1, 0, 0]);
    
    assert.ok(scorer.cosineSimilarity(a, b) > 0.9);
    assert.ok(scorer.cosineSimilarity(a, c) < 0.1);
  });

  it("scores verification confidence", async () => {
    const scorer = new EmbeddingScorer({ dimensions: 64, modelName: "test", provider: "local" });
    
    const result = await scorer.scoreVerification({
      taskType: "research",
      files: ["src/test.ts"],
      errors: [],
      tools: ["shell.run"],
    });
    
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.factors);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verifier/embedder/scorer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement embedding scorer**

```typescript
// src/verifier/embedder/scorer.ts
import type { EmbedderConfig, VerificationEmbedding } from "./types.js";

export interface VerificationContext {
  taskType: string;
  files: string[];
  errors: string[];
  tools: string[];
}

export interface ScoringResult {
  score: number;
  factors: {
    fileComplexity: number;
    errorDensity: number;
    toolDiversity: number;
    historicalConfidence: number;
  };
}

export class EmbeddingScorer {
  private dimensions: number;
  private modelName: string;
  
  constructor(private config: EmbedderConfig) {
    this.dimensions = config.dimensions;
    this.modelName = config.modelName;
  }
  
  async createEmbedding(context: VerificationContext): Promise<Float32Array> {
    // Generate deterministic embedding based on context
    // In production, use actual embedding model (e.g., Nomic, SigLIP)
    const embedding = new Float32Array(this.dimensions);
    
    // Hash-based seeding for determinism
    let seed = this.hashString(context.taskType);
    for (const file of context.files) {
      seed ^= this.hashString(file);
    }
    
    // Fill embedding with pseudo-random values based on seed
    for (let i = 0; i < this.dimensions; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      embedding[i] = (seed % 1000) / 1000;
    }
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < this.dimensions; i++) {
      embedding[i] /= norm;
    }
    
    return embedding;
  }
  
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }
  
  async scoreVerification(context: VerificationContext): Promise<ScoringResult> {
    // Factor-based scoring inspired by ClipCannon's multi-embedder approach
    
    const fileComplexity = Math.min(context.files.length / 10, 1);
    const errorDensity = context.errors.length > 0 
      ? Math.min(context.errors.length / 5, 1) 
      : 0.5;
    const toolDiversity = Math.min(context.tools.length / 8, 1);
    
    // Base score from factors
    const baseScore = (
      (1 - fileComplexity) * 0.2 +  // Less complex = higher confidence
      (1 - errorDensity) * 0.3 +  // Fewer errors = higher confidence
      toolDiversity * 0.2 +        // More tools used = more signal
      0.3                          // Base confidence
    );
    
    return {
      score: Math.max(0, Math.min(1, baseScore)),
      factors: {
        fileComplexity,
        errorDensity,
        toolDiversity,
        historicalConfidence: 0.5, // Placeholder for historical matching
      },
    };
  }
  
  async createVerificationEmbedding(
    sessionId: string,
    taskType: string,
    context: VerificationContext
  ): Promise<VerificationEmbedding> {
    const embedding = await this.createEmbedding(context);
    
    return {
      id: `emb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionId,
      taskType,
      filePatterns: context.files,
      errorPatterns: context.errors,
      toolSequence: context.tools,
      embedding,
      createdAt: Date.now(),
    };
  }
  
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verifier/embedder/scorer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/embedder/scorer.ts tests/verifier/embedder/scorer.test.ts
git commit -m "feat(verification): add EmbeddingScorer for verification confidence scoring"
```

---

## Task 4: Historical Exemplar Matcher

**Files:**
- Create: `src/verifier/embedder/exemplar.ts`
- Create: `tests/verifier/embedder/exemplar.test.ts`

- [ ] **Step 1: Write failing test for exemplar matching**

```typescript
// tests/verifier/embedder/exemplar.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { ExemplarMatcher } from "../../../src/verifier/embedder/exemplar.js";
import { FailureDatabase } from "../../../src/verifier/embedder/failure-db.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

describe("ExemplarMatcher", () => {
  const dbPath = join(tmpdir(), "test-exemplars.db");
  
  afterEach(async () => {
    try {
      await unlink(dbPath);
    } catch {}
  });

  it("finds similar past failures", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();
    
    // Seed with known failure
    await db.insertFailure({
      id: "fail-auth-1",
      sessionId: "s1",
      task: "fix authentication bug",
      errorSummary: "TypeError: Cannot read property 'token' of null in auth handler",
      fileChanges: ["src/auth/handler.ts"],
      resolution: "Added null check: if (!user) return 401",
      resolvedAt: Date.now() - 86400000,
      embeddingId: "emb-1",
    });
    
    const matcher = new ExemplarMatcher(db);
    
    const results = await matcher.findSimilar({
      task: "auth is broken",
      errors: ["TypeError: Cannot read property 'token'"],
      files: ["src/auth/handler.ts"],
    });
    
    assert.ok(results.length > 0);
    assert.ok(results[0].score > 0.5);
    assert.ok(results[0].record.resolution);
    
    await db.close();
  });

  it("returns ranked results with confidence", async () => {
    const db = new FailureDatabase(dbPath);
    await db.init();
    
    const matcher = new ExemplarMatcher(db);
    
    await db.insertFailure({
      id: "fail-1",
      sessionId: "s1",
      task: "test failure",
      errorSummary: "AssertionError: expected 5 to equal 6",
      fileChanges: ["test.ts"],
      resolution: "Fixed assertion",
      resolvedAt: Date.now(),
      embeddingId: "emb-1",
    });
    
    const results = await matcher.findSimilar({
      task: "math test broken",
      errors: ["AssertionError"],
      files: ["test.ts"],
    });
    
    // Results should be sorted by score descending
    if (results.length > 1) {
      assert.ok(results[0].score >= results[1].score);
    }
    
    await db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verifier/embedder/exemplar.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement exemplar matcher**

```typescript
// src/verifier/embedder/exemplar.ts
import type { FailureRecord, SimilarityResult } from "./types.js";
import { FailureDatabase } from "./failure-db.js";

export interface QueryContext {
  task: string;
  errors: string[];
  files: string[];
}

export interface MatchOptions {
  threshold?: number;
  topK?: number;
}

export class ExemplarMatcher {
  constructor(private db: FailureDatabase) {}
  
  async findSimilar(
    context: QueryContext,
    options: MatchOptions = {}
  ): Promise<SimilarityResult[]> {
    const threshold = options.threshold ?? 0.5;
    const topK = options.topK ?? 5;
    
    // Search using heuristic matching
    const results = await this.db.searchByEmbedding(
      new Float32Array(128), // Placeholder - would use actual embedding
      topK * 2, // Get more to filter
      threshold
    );
    
    // Re-score based on query context
    const scored = results.map(result => {
      const contextScore = this.calculateContextSimilarity(context, result.record);
      const combinedScore = (result.score + contextScore) / 2;
      
      return {
        record: result.record,
        score: combinedScore,
        matchedPatterns: this.findMatchedPatterns(context, result.record),
      };
    });
    
    return scored
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  private calculateContextSimilarity(
    query: QueryContext,
    record: FailureRecord
  ): number {
    let score = 0;
    let weights = 0;
    
    // Task similarity (40%)
    const taskWords = query.task.toLowerCase().split(/\W+/);
    const recordWords = record.task.toLowerCase().split(/\W+/);
    const taskOverlap = taskWords.filter(w => recordWords.includes(w)).length;
    const taskSim = taskWords.length > 0 
      ? taskOverlap / taskWords.length 
      : 0;
    score += taskSim * 0.4;
    weights += 0.4;
    
    // File similarity (30%)
    const fileOverlap = query.files.filter(f => 
      record.fileChanges.some(rf => rf.includes(f) || f.includes(rf))
    ).length;
    const fileSim = query.files.length > 0
      ? fileOverlap / query.files.length
      : 0;
    score += fileSim * 0.3;
    weights += 0.3;
    
    // Error pattern similarity (30%)
    const errorMatches = query.errors.filter(err =>
      record.errorSummary.toLowerCase().includes(err.toLowerCase())
    ).length;
    const errorSim = query.errors.length > 0
      ? errorMatches / query.errors.length
      : 0;
    score += errorSim * 0.3;
    weights += 0.3;
    
    return weights > 0 ? score / weights : 0;
  }
  
  private findMatchedPatterns(
    query: QueryContext,
    record: FailureRecord
  ): string[] {
    const patterns: string[] = [];
    
    for (const error of query.errors) {
      if (record.errorSummary.toLowerCase().includes(error.toLowerCase())) {
        patterns.push(error);
      }
    }
    
    for (const file of query.files) {
      if (record.fileChanges.some(f => f.includes(file))) {
        patterns.push(`file:${file}`);
      }
    }
    
    return patterns;
  }
  
  async recordResolution(
    failureId: string,
    resolution: string
  ): Promise<void> {
    const record = await this.db.getFailure(failureId);
    if (record) {
      await this.db.insertFailure({
        ...record,
        resolution,
        resolvedAt: Date.now(),
      });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verifier/embedder/exemplar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/embedder/exemplar.ts tests/verifier/embedder/exemplar.test.ts
git commit -m "feat(verification): add ExemplarMatcher for historical failure matching"
```

---

## Task 5: Integration with Existing Verifier

**Files:**
- Modify: `src/verifier/verifier.ts` (add embedder integration)
- Create: `tests/verifier/embedder-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/verifier/embedder-integration.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { EnhancedVerifier } from "../../../src/verifier/enhanced-verifier.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir, unlink } from "node:fs/promises";

describe("EnhancedVerifier Integration", () => {
  const testDir = join(tmpdir(), "enhanced-verifier-test");
  const dbPath = join(testDir, "failures.db");
  
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "package.json"), JSON.stringify({
      scripts: { test: "echo 'no tests'" }
    }));
  });
  
  afterEach(async () => {
    try {
      await unlink(dbPath);
    } catch {}
  });

  it("scores verification with embedder confidence", async () => {
    const verifier = new EnhancedVerifier({
      cwd: testDir,
      embedderDb: dbPath,
    });
    
    const result = await verifier.verifyAndScore();
    
    assert.ok(result.score >= 0 && result.score <= 1);
    assert.ok(result.existingChecks.length >= 0);
  });

  it("suggests fixes from historical failures", async () => {
    const verifier = new EnhancedVerifier({
      cwd: testDir,
      embedderDb: dbPath,
    });
    
    // Record a past failure
    await verifier.recordFailure({
      task: "fix import bug",
      errorSummary: "Cannot find module './utils'",
      fileChanges: ["src/utils.ts"],
      resolution: "Added index.ts export",
    });
    
    // Query for similar
    const suggestions = await verifier.suggestFixes({
      errors: ["Cannot find module"],
      files: ["src/utils.ts"],
    });
    
    assert.ok(Array.isArray(suggestions));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm test -- tests/verifier/embedder-integration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement enhanced verifier**

```typescript
// src/verifier/enhanced-verifier.ts
import { discoverVerification, runVerification, type VerificationCheck, type VerificationResult } from "./verifier.js";
import { FailureDatabase } from "./embedder/failure-db.js";
import { EmbeddingScorer } from "./embedder/scorer.js";
import { ExemplarMatcher } from "./embedder/exemplar.js";
import type { ScoringResult, SimilarityResult } from "./embedder/types.js";

export interface EnhancedVerifierOptions {
  cwd: string;
  embedderDb: string;
  embedderDimensions?: number;
}

export interface VerificationWithScore {
  checks: VerificationCheck[];
  results: VerificationResult[];
  score: number;
  existingChecks: boolean;
}

export interface FixSuggestion {
  resolution: string;
  confidence: number;
  matchedPatterns: string[];
  source: string;
}

export class EnhancedVerifier {
  private db: FailureDatabase;
  private scorer: EmbeddingScorer;
  private matcher: ExemplarMatcher;
  
  constructor(private options: EnhancedVerifierOptions) {
    this.db = new FailureDatabase(options.embedderDb);
    this.scorer = new EmbeddingScorer({
      dimensions: options.embedderDimensions ?? 128,
      modelName: "alix-embedder-v1",
      provider: "local",
    });
    this.matcher = new ExemplarMatcher(this.db);
  }
  
  async init(): Promise<void> {
    await this.db.init();
  }
  
  async verifyAndScore(): Promise<VerificationWithScore> {
    const checks = await discoverVerification(this.options.cwd);
    
    if (checks.length === 0) {
      return {
        checks: [],
        results: [],
        score: 1.0, // No verification needed
        existingChecks: false,
      };
    }
    
    const results: VerificationResult[] = [];
    let allPassed = true;
    
    for (const check of checks) {
      const result = await runVerification(this.options.cwd, check);
      results.push(result);
      if (result.status !== "passed") {
        allPassed = false;
      }
    }
    
    // Calculate embedder-based confidence score
    const score = await this.calculateConfidenceScore(checks, results);
    
    return {
      checks,
      results,
      score,
      existingChecks: true,
    };
  }
  
  private async calculateConfidenceScore(
    checks: VerificationCheck[],
    results: VerificationResult[]
  ): Promise<number> {
    // Base score from verification results
    const passRate = results.filter(r => r.status === "passed").length / results.length;
    const baseScore = passRate * 0.6;
    
    // Factor from check coverage
    const coverageScore = Math.min(checks.length / 3, 1) * 0.2;
    
    // Historical confidence (if we have past failures)
    const historyScore = 0.2; // Placeholder
    
    return Math.max(0, Math.min(1, baseScore + coverageScore + historyScore));
  }
  
  async suggestFixes(context: { errors: string[]; files: string[] }): Promise<FixSuggestion[]> {
    const similar = await this.matcher.findSimilar({
      task: "",
      errors: context.errors,
      files: context.files,
    });
    
    return similar.map(s => ({
      resolution: s.record.resolution,
      confidence: s.score,
      matchedPatterns: s.matchedPatterns,
      source: `Historical failure: ${s.record.task}`,
    }));
  }
  
  async recordFailure(failure: {
    task: string;
    errorSummary: string;
    fileChanges: string[];
    resolution: string;
  }): Promise<void> {
    const id = `fail-${Date.now()}`;
    
    const embedding = await this.scorer.createVerificationEmbedding(
      `session-${Date.now()}`,
      "unknown",
      {
        taskType: "unknown",
        files: failure.fileChanges,
        errors: [failure.errorSummary],
        tools: [],
      }
    );
    
    await this.db.insertFailure({
      id,
      sessionId: `session-${Date.now()}`,
      task: failure.task,
      errorSummary: failure.errorSummary,
      fileChanges: failure.fileChanges,
      resolution: failure.resolution,
      resolvedAt: Date.now(),
      embeddingId: embedding.id,
    });
  }
  
  async close(): Promise<void> {
    await this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm test -- tests/verifier/embedder-integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/enhanced-verifier.ts tests/verifier/embedder-integration.test.ts
git commit -m "feat(verification): add EnhancedVerifier with embedder-based scoring"
```

---

## Execution Options

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**