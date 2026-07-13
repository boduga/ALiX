# ADR-0012: Patch and Mutation Architecture

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** File mutation, patch format, edit policy, preimage validation, rollback, checkpointing

---

## 1. Context

ALiX applies changes to its own codebase and configuration through governed mutations. Every mutation must be:

- **Verified before application:** The patch must match the expected preimage (what the file looked like before).
- **Auditable after application:** The mutation must produce evidence that can be traced back to the governing decision.
- **Revertible on failure:** If a mutation fails or produces unintended consequences, the system must be able to roll back the change.
- **Format-controlled:** Different file types (code, configuration, structured data) need different edit strategies.

The mutation subsystem operates at a different level than the A4 execution runtime. A4 executes high-level evolution steps (governance-approved plans). The patch engine applies the low-level file mutations that those steps produce. The two are complementary: A4 governs whether execution happens; the patch engine governs how the change is applied to the filesystem.

Key requirements:

- Support multiple patch formats (search/replace, structured edit, full file replacement)
- Validate preimage before applying (prevent applying a patch to a file that has changed since the patch was generated)
- Roll back failed mutations to the pre-patch state
- Checkpoint files before mutation for recovery

---

## 2. Decision

ALiX adopts a **preimage-validated patch engine** with format selection, file-level checkpointing, and rollback recovery.

### 2.1 Architecture

```
EditRequest (from agent tool call)
        │
        ▼
EditFormatPolicy ───► EditFormatSelector
        │                    │
        │                    ├── SearchReplace (for code)
        │                    ├── StructuredPatch (for structured data)
        │                    └── FullFile (for rewrites)
        │
        ▼
PreimageValidator
        │
        ├── Read current file content
        ├── Compare against expected preimage
        └── Fail on mismatch (concurrent modification detection)
        │
        ▼
FileCheckpoint
        │
        └── Copy file to .alix/checkpoints/<id>/
        │
        ▼
PatchApplier
        │
        ├── Apply patch (search/replace or structured)
        ├── FullFileGuard (verify full file replacement boundaries)
        └── Report success/failure
        │
        ▼
PatchResult
        │
        ├── success: boolean
        ├── filePath: string
        ├── diff?: string
        └── error?: string
```

### 2.2 Patch Formats

The `EditFormatSelector` routes each mutation to the appropriate format:

| Format | When Used | Description |
|--------|-----------|-------------|
| Search/Replace | Code files | Find exact `old_string` and replace with `new_string`. Requires exact preimage match. |
| Structured Patch | Configuration, JSON, YAML | Surgical edits at path locations within structured data. |
| Full File | Initial creation, rewrites | Complete file replacement with full content validation. |

The `EditFormatPolicy` (ADR-0004 protected types) blocks edits to protected type files unless they meet the allowed mutation taxonomy.

### 2.3 Preimage Validation

Before any patch is applied, the `PreimageValidator` reads the current file content and compares it against the expected preimage (the content the patch was generated against).

```typescript
validatePreimage(filePath: string, expectedPreimage: string): ValidationResult
```

If the file has changed since the patch was generated (e.g., by a concurrent agent or external edit), the patch is rejected with a preimage mismatch error. This prevents silent corruption from applying a patch to the wrong file version.

**Rationale:** Preimage validation is the primary defense against concurrent modification. Without it, search/replace could match the wrong content or apply in the wrong location if the file shifted between patch generation and application.

### 2.4 File-Level Checkpointing

Before mutation, the file is copied to `.alix/checkpoints/<checkpoint-id>/`:

```typescript
createFileCheckpoint(root, files): Checkpoint
restoreFileCheckpoint(checkpoint): void
```

Checkpoints are:
- **Per-file:** Each mutated file is checkpointed independently
- **Process-independent:** Checkpoints survive process termination
- **Named by UUID:** No collision risk across concurrent mutations
- **Self-cleaning:** Unchanged checkpoint directories are auto-removed

**Rationale:** Checkpoints provide rollback at the file level, distinct from A4's execution-level rollback (which operates on high-level steps, not individual file edits). File-level checkpoints are finer-grained and survive process crashes — a checkpoint can be restored even if the process that created it is gone.

### 2.5 Rollback Manager

The `RollbackManager` coordinates mutation reversals:

- If a step fails, roll back all files mutated by that step
- If an execution fails, roll back all files mutated across all completed steps
- Checkpoints are consumed (deleted) after successful rollback

Rollback is not always possible (e.g., if a file was created and then other files depended on it). The `patch-guard.ts` checks rollback feasibility before execution proceeds.

### 2.6 Full File Guard

The `FullFileGuard` enforces boundaries on full-file rewrites:

- Prevents overwriting files outside the owned path scope
- Validates that the replacement is structurally valid for the file type
- Rejects rewrites that would delete required file structure

### 2.7 Edit Format Policy and Protected Types

The `EditFormatPolicy` integrates with ADR-0004 protected type files:

- **Allowed edits:** Adding new types, adding optional fields, fixing imports
- **Forbidden edits:** Removing required fields, changing field types, removing types
- **Requires new ADR:** Structural changes that alter contract semantics

The policy is enforced at edit time, not at review time. A mutation that violates the policy is rejected before it touches the filesystem.

---

## 3. Architectural Invariants

1. **Every mutation is preimage-validated.** A patch is never applied to a file whose current content doesn't match the expected preimage.
2. **Every file edit is checkpointed before mutation.** Rollback is always possible at the file level.
3. **Patch format is determined by file type and edit nature.** Not all formats are valid for all files.
4. **Protected type files have structural edit policies.** The `EditFormatPolicy` enforces ADR-0004 at mutation time.
5. **Rollback is best-effort but checkpoints are reliable.** If a file was checkpointed, rollback can restore it. If the checkpoint itself failed, rollback is reported as unavailable.

---

## 4. Consequences

### 4.1 Positive

- **Safe concurrent edits:** Preimage validation catches stale-patch-before-apply, preventing silent corruption.
- **Granular rollback:** File-level checkpoints enable surgical reversal without reverting unrelated changes.
- **Format diversity:** Search/replace for code, structured patches for config, full-file for rewrites — each file type gets the safest edit mode.
- **Policy enforcement at edit time:** Protected type policies are enforced when the mutation is attempted, not after.

### 4.2 Negative

- **Preimage false positives:** A file reformatted by a linter between patch generation and application fails preimage validation, even though the logical content hasn't changed.
- **Checkpoint storage:** File checkpoints under `.alix/checkpoints/` accumulate over time and require cleanup.
- **Rollback gaps:** File creation has no preimage to roll back to. If a created file causes downstream failures, rollback deletes it (via `missingFiles` tracking in checkpoint restore) but cannot undo side effects.

---

## 5. Key References

- `src/patch/patch-engine.ts` — Central patch application orchestrator
- `src/patch/patch-guard.ts` — Patch feasibility validation
- `src/patch/patch-parser.ts` — Patch format parsing
- `src/patch/search-replace.ts` — Search/replace patch applier
- `src/patch/structured-patch.ts` — Structured data patch applier
- `src/patch/structured-patch-applier.ts` — Structured patch application logic
- `src/patch/preimage-validator.ts` — Preimage validation
- `src/patch/full-file-guard.ts` — Full-file rewrite boundaries
- `src/patch/diff-renderer.ts` — Diff output generation
- `src/patch/rollback-manager.ts` — Mutation rollback coordination
- `src/patch/checkpoint-manager.ts` — File-level checkpointing
- `src/patch/checkpoint.ts` — Checkpoint types
- `src/patch/edit-format-policy.ts` — Format selection + protected type enforcement
- `src/patch/edit-format-selector.ts` — Format router
- `src/patch/patch-paths.ts` — Path resolution and safety
- `docs/architecture/adrs/ADR-0004-protected-type-files.md` — Protected type file policy
