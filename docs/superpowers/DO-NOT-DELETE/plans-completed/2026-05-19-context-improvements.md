# Context Improvements Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or execute inline.

**Goal:** Improve context selection with Tree-sitter parsing, semantic search, and per-model reliability tracking.

**Tech Stack:** TypeScript, Tree-sitter, embedding-based search

---

## Task 1: Tree-sitter Symbol Extraction

**Files:**
- Modify: `src/repomap/symbol-extractor.ts`

### Steps

1. Install tree-sitter packages:
```bash
npm install tree-sitter tree-sitter-types
```

2. Add TreeSitter parser integration to `symbol-extractor.ts`:
```typescript
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";

const parser = new Parser();
parser.setLanguage(TypeScript);
```

3. Replace regex-based extraction with tree-sitter for:
   - Function definitions
   - Class definitions
   - Interface definitions
   - Type aliases
   - Method signatures

4. Extract source locations and ranges for precise context

**Commit:** `git add src/repomap/symbol-extractor.ts package.json && git commit -m "feat: add tree-sitter parsing for precise symbol extraction"`

---

## Task 2: Semantic Search Integration

**Files:**
- Modify: `src/repomap/context-compiler.ts`
- Create: `src/repomap/embedding-cache.ts`

### Steps

1. Add lightweight embedding support:
```bash
npm install @xenova/transformers
```

2. Create embedding cache:
```typescript
// Cache embeddings in .alix/embeddings/
export class EmbeddingCache {
  async getEmbedding(text: string): Promise<number[]>
  async search(query: string, topK: number): Promise<SearchResult[]>
}
```

3. Integrate into ContextCompiler:
   - Build embeddings for source files on warm()
   - Search by semantic similarity when ranking context

**Commit:** `git add src/repomap/embedding-cache.ts src/repomap/context-compiler.ts && git commit -m "feat: add semantic search via embeddings"`

---

## Task 3: Per-Model Reliability Matrix

**Files:**
- Create: `src/config/reliability-matrix.ts`
- Modify: `src/config/schema.ts`

### Steps

1. Define reliability data structure:
```typescript
export type ReliabilityEntry = {
  model: string;
  provider: string;
  editFormats: Record<string, number>; // success rate
  toolCalls: Record<string, number>;
  avgLatencyMs: number;
};
```

2. Create JSON matrix in `config/reliability-matrix.json`

3. Wire into ToolSelector for model-aware tool selection

**Commit:** `git add src/config/reliability-matrix.ts src/config/reliability-matrix.json && git commit -m "feat: add per-model reliability tracking"`

---

## Verification

```bash
npm test
```

Manual checks:
- [ ] Tree-sitter extracts symbols from TypeScript files
- [ ] Semantic search returns relevant results
- [ ] ToolSelector uses reliability data