# Memory Kernel

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 12. Memory Kernel Requirements

| Memory Type | Purpose | Default Scope |
|---|---|---|
| Episodic | What happened in a run/session | session/project |
| Semantic | Facts, concepts, source chunks, extracted knowledge | project/global |
| Project | Repo-specific architecture, conventions, decisions | project |
| Skill | Reusable executable procedures and hooks | project/global |
| Reflection | Lessons from failures and successes | project/user |
| Workflow | Which SOPs and graph patterns worked | project/global |
| Preference | Stable user choices and defaults | user |
| Safety | Known risky actions, denials, and incidents | project/user |

- Default persistence backend: SQLite for relational state plus LanceDB for vector retrieval.
- Fallback vector backend: simple local index for zero-dependency installs and tests.
- Optional scale-out vector backend: Qdrant for larger deployments or distributed worker environments.
- SQLite vector extensions may be evaluated later, but should not be the default until packaging and migration behavior are stable.
- Memory scopes: `session`, `project`, `user`, `global`, `sensitive`, `temporary`.
- All memory writes are evented and visible in Inspector.
- Sensitive or user-level memories require explicit approval before persistence.
- Memory retrieval must return source, scope, confidence, age, and last-used metadata.
- Memory conflict resolution rules are defined in §23.

### 12.1 Default Storage Configuration

```yaml
storage:
  relational_backend: sqlite
  vector_backend: lancedb
  vector_fallback: simple
  optional_vector_backends:
    - qdrant
    - sqlite-vector
    - sqlite-vec
paths:
  sqlite_db: ~/.alix/alix.db
  lancedb_dir: ~/.alix/vector/lancedb
  artifact_dir: ~/.alix/artifacts
```

**Storage rules:**

- SQLite owns durable workflow state: sessions, events, task graphs, agents, tools, policies, approvals, artifacts, costs, and evaluations.
- LanceDB owns semantic retrieval: memory chunks, skill embeddings, source chunks, project knowledge, agent/tool retrieval vectors, and workflow trace embeddings.
- The simple vector backend exists for tests, first-run bootstrap, and environments where native dependencies fail.
- Qdrant is recommended only when ALiX moves to multi-node, high-volume, or service-backed deployments.

---

## 23. Memory Conflict and Staleness Rules

### 23.1 Conflict Detection

A memory conflict occurs when two memory records share the same semantic topic and scope, but their content or conclusions contradict each other. Conflict is flagged when the cosine distance between two record embeddings is less than `0.15` (near-duplicate) but their content diverges by more than a configurable threshold.

The `memory.curator` agent is responsible for conflict detection and resolution.

```typescript
type MemoryConflict = {
  id: string;
  recordAId: string;
  recordBId: string;
  scope: string;
  detectedAt: string;
  resolution: "merged" | "superseded" | "flagged" | "pending";
  resolvedBy?: string;        // agent ID or "user"
  resolvedAt?: string;
  notes?: string;
};
```

### 23.1.1 Conflict Detection Methods

Embedding similarity is only one conflict signal. The memory curator must combine at least three methods:

| Method | Trigger | Example |
|---|---|---|
| Entity/key conflict | Same subject + same attribute + different value | `default_vector_backend = LanceDB` conflicts with `default_vector_backend = Qdrant` |
| Decision conflict | Same decision area + different selected option | `sidecar_transport = stdio` conflicts with `sidecar_transport = HTTP` |
| Temporal supersession | Newer record explicitly supersedes an older record | `PRD v1.4 supersedes PRD v1.3` |

Recommended optional fields for structured memories:

```typescript
type StructuredMemoryFields = {
  subject?: string;
  predicate?: string;
  object?: string;
  decisionArea?: string;
  supersedes?: string[];
  validFrom?: string;
  validUntil?: string;
  sourceConfidence?: number;
};
```

### 23.2 Resolution Rules

| Conflict Type | Resolution |
|---|---|
| Same source, newer record | Supersede older record; emit `memory.superseded`. |
| Different sources, same recency | Flag as conflict; surface to user if scope is `user` or `global`. Auto-merge for `session`. |
| One record is marked `sensitive` | Require user approval before merging or superseding. |
| Both records are from verified sources with contradicting claims | Write a `reflection` memory noting the contradiction; retain both. |

### 23.3 Staleness Rules

A memory record becomes stale when:

- Its `last_used_at` timestamp is older than the scope's staleness threshold.
- Its source has been marked outdated by a `research.source_verifier` run.
- A newer record explicitly supersedes it.

| Scope | Staleness Threshold |
|---|---|
| session | End of session |
| project | 90 days unused |
| user | 365 days unused |
| global | 180 days unused |
| skill | No automatic staleness; requires explicit deprecation or score decay |

**Staleness actions:**

- Stale records are demoted in retrieval ranking but not deleted.
- Records older than 2x the staleness threshold are flagged for pruning.
- `alix memory prune --dry-run` shows candidates; `--apply` executes with event emission.
- Pruning `user` or `global` scope records requires explicit approval.

### 23.4 Confidence Decay

Every semantic memory record carries a `confidence` score (0.0–1.0). Confidence decays linearly:

```
current_confidence = initial_confidence * max(0.1, 1.0 - (days_since_verified / decay_days))
```

Default `decay_days` by scope: `project=180`, `global=90`, `user=365`. Retrieval results include the current confidence value.

---
