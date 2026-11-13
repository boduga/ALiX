# Patch Engine

## Overview

The write path for model-proposed edits. It accepts a patch in one of three executable formats (`search_replace`, `structured_patch`, `unified_diff`), parses and validates it, applies a workspace-containment and safety guard, optionally checkpoints the preimage, then writes the affected files and emits lifecycle events.

The engine is deliberately strict about parse failures: a payload that parses to zero hunks is a retryable rejection carrying syntax guidance, never a silent "valid empty patch" followed by a bare write error.

## Interface

- `applyPatch(root, format, patchText, options?)` — main entry; returns `{ status, changedFiles, proposalId, checkpointId }` [patch-engine.ts:applyPatch]
- `PatchApplyResult` — applied/invalid result shape [patch-engine.ts:PatchApplyResult]
- `PatchRejectedError` — rejection carrying a `retryable` flag (default `true`) [patch-engine.ts:PatchRejectedError]
- `PatchEngineOptions` — optional `eventLog`, `sessionId`, `checkpointManager` [patch-engine.ts:PatchEngineOptions]
- `rollbackPatch(proposalId, checkpointId, eventLog?, sessionId?, checkpointManager?)` — restores a checkpoint and emits `patch.rolled_back` [patch-engine.ts:rollbackPatch]
- `sha256(content)` — SHA-256 hex helper used for preimage comparison [patch-engine.ts:sha256]
- `StructuredPatch` / `StructuredPatchFile` — version-1 JSON patch shape with per-file operation and optional `preimageHash` [structured-patch.ts:StructuredPatch]
- `parseStructuredPatch(input)` — rejects non-version-1 payloads and missing `files` [structured-patch.ts:parseStructuredPatch]
- `parseSearchReplace(input)` / `applySearchReplace(content, block)` / `validateSearchReplace(content, block)` — Aider-style block parsing, single-match application, and uniqueness validation [search-replace.ts:parseSearchReplace] [search-replace.ts:applySearchReplace] [search-replace.ts:validateSearchReplace]
- `SearchReplaceBlock` — `path`, `search`, `replace` [search-replace.ts:SearchReplaceBlock]
- `EditFormat` / `ExecutableFormat` / `EditFormatPolicy` — format vocabulary and per-provider policy [edit-format-policy.ts:EditFormat] [edit-format-policy.ts:ExecutableFormat] [edit-format-policy.ts:EditFormatPolicy]
- `defaultEditFormatForProvider(provider)` / `buildEditFormatPolicy(input)` — provider-default and policy construction [edit-format-policy.ts:defaultEditFormatForProvider] [edit-format-policy.ts:buildEditFormatPolicy]
- `PatchParser` — unified/context parsing, Aider normalization, and serialization [patch-parser.ts:PatchParser]
- `normalizeAiderFormat(patch)` — converts `*** Begin/Update/Add/Delete` framing to unified headers [patch-parser.ts:normalizeAiderFormat]
- `ParsedPatch` / `ParsedFile` / `ParsedHunk` — parse output shapes; `ParsedPatch.normalized` records whether the input was rewritten [patch-parser.ts:ParsedPatch]
- `StructuredPatchApplier` — applies parsed hunks to original content with strict/lenient conflict handling [structured-patch-applier.ts:StructuredPatchApplier]
- `ApplyResult` — success, content, hunk counts, conflicts, error [structured-patch-applier.ts:ApplyResult]
- `validatePatchOperations(ops, config)` — path-safety, protected-path, and size validation [patch-guard.ts:validatePatchOperations]
- `isPathSafe(path)` / `isProtectedPath(patterns, path)` — individual guard predicates [patch-guard.ts:isPathSafe] [patch-guard.ts:isProtectedPath]
- `DEFAULT_PATCH_GUARD_CONFIG` — protected `.git/**`, `.env`, `.env.*`, `secrets/**`; 10 MiB content cap [patch-guard.ts:DEFAULT_PATCH_GUARD_CONFIG]
- `PreimageValidator` — `validate`, `hashContent`, `generateCheckpoint` for stale-patch detection [preimage-validator.ts:PreimageValidator]
- `FullFileRewriteGuard` — approval requirements for full-file rewrites [full-file-guard.ts:FullFileRewriteGuard]
- `EditFormatSelector` — heuristic unified/context/structured/search_replace selection [edit-format-selector.ts:EditFormatSelector]
- `CheckpointManager` — creates, restores, lists, and deletes on-disk checkpoints [checkpoint.ts:CheckpointManager]
- `Checkpoint` — id, patch id, file list, creation timestamp [checkpoint.ts:Checkpoint]
- `RollbackManager` — in-memory bounded snapshot history per file [rollback-manager.ts:RollbackManager]
- `DiffRenderer` — unified, side-by-side, and raw diff rendering [diff-renderer.ts:DiffRenderer]

## Invariants

- Only `search_replace`, `structured_patch`, and `unified_diff` are executable; any other format throws `Unsupported edit format` before parsing [patch-engine.ts:applyPatch]
- A parse that yields zero hunks is a validation failure that throws a retryable `PatchRejectedError` and emits `patch.rejected`; it never reports `validated: true` [patch-engine.ts:applyPatch]
- `patch.proposed` and `patch.parsed` are emitted before validation completes, so a rejected patch still has a durable proposal and parse record [patch-engine.ts:applyPatch]
- Events are emitted only when both `eventLog` and `sessionId` are supplied [patch-engine.ts:applyPatch]
- A checkpoint is created only when a `checkpointManager` is available and at least one path was extracted; checkpoint failure logs a warning and the patch continues without one [patch-engine.ts:applyPatch]
- `rollbackPatch` throws `No checkpoint manager configured` when none is supplied [patch-engine.ts:rollbackPatch]
- Every patch path is resolved against the workspace root and rejected with `Patch path is outside workspace` when outside, using both a relative check and the canonical workspace resolver [patch-engine.ts:resolvePatchPath]
- The safety guard runs before any write and blocks the whole patch when any operation fails path safety, protected-path, or size validation [patch-engine.ts:applyPatch]
- `isPathSafe` rejects paths starting with `..`, `/`, `~`, or `$`, and any path containing `../` [patch-guard.ts:isPathSafe]
- `isProtectedPath` supports exact, `prefix/**`, and `prefix.*` patterns [patch-guard.ts:isProtectedPath]
- `search_replace` blocks require an unambiguous single match: zero matches and multiple matches both fail with distinct errors [search-replace.ts:validateSearchReplace]
- `search_replace` computes every planned write before performing any, so a validation failure leaves no file partially rewritten [patch-engine.ts:applyPatchBody]
- `structured_patch` `modify` requires a `preimageHash` that matches the current content; a literal `<sha256>` placeholder never validates [patch-engine.ts:applyPatchBody]
- `structured_patch` `delete` checks the preimage only when a hash is supplied; `create` requires none [patch-engine.ts:applyPatchBody]
- `parseStructuredPatch` accepts only `version: 1` and requires `files` to be an array [structured-patch.ts:parseStructuredPatch]
- `buildEditFormatPolicy` always sets `fullFileRewrite: "deny"`, and `full_file` preferred input is normalized to `search_replace` [edit-format-policy.ts:buildEditFormatPolicy]
- `google` provider input is always normalized to `search_replace`, regardless of the requested preference [edit-format-policy.ts:normalizePreferredFormat]
- Policy `allowed` is the preferred format, its alternate, and every executable format, deduplicated [edit-format-policy.ts:buildEditFormatPolicy]
- `PatchParser.parse` normalizes CRLF and CR to LF and only applies Aider normalization when a `*** Begin Patch` line is present [patch-parser.ts:PatchParser]
- Aider `*** Add File` maps to `--- /dev/null`, and `*** Delete File` maps to `+++ /dev/null` [patch-parser.ts:normalizeAiderFormat]
- `StructuredPatchApplier` is strict by default; a conflicting hunk fails the patch with `Patch conflicts detected` and reports the conflict line and expected/actual text [structured-patch-applier.ts:StructuredPatchApplier]
- A hunk with no leading context falls back to its declared `oldStart` position rather than scanning [structured-patch-applier.ts:applyHunk]
- `FullFileRewriteGuard` always allows new files; existing source and generated files require explicit approval; other files require approval only above the large-file threshold (default 5000 bytes) [full-file-guard.ts:FullFileRewriteGuard]
- `CheckpointManager.create` best-effort copies each file, ignoring copy errors, and always writes `metadata.json` [checkpoint.ts:CheckpointManager]
- `RollbackManager` caps retained snapshots per file (default 10), dropping the oldest first [rollback-manager.ts:RollbackManager]
- Snapshot ids encode file, per-file counter, and timestamp; `rollback(file, steps)` returns content and never mutates the store [rollback-manager.ts:RollbackManager]
- `PreimageValidator.validate` returns `valid: false` with `stale patch` on hash mismatch and also on read failure, never throwing [preimage-validator.ts:PreimageValidator]

## Side Effects

- Writes, creates directories for, and deletes workspace files according to the patch [patch-engine.ts:applyPatchBody]
- Appends `patch.proposed`, `patch.parsed`, `patch.rejected`, `patch.checkpoint_created`, `patch.applied`, and `patch.rolled_back` events to the session event log [patch-engine.ts:applyPatch] [patch-engine.ts:rollbackPatch]
- `CheckpointManager` creates directories under its checkpoint root and copies file contents into them [checkpoint.ts:CheckpointManager]
- `rollbackPatch` restores files from the checkpoint directory, overwriting current content [checkpoint.ts:CheckpointManager]
- `PreimageValidator` and `CheckpointManager.create` read file contents from disk [preimage-validator.ts:PreimageValidator] [checkpoint.ts:CheckpointManager]
- `RollbackManager` retains file contents in process memory only [rollback-manager.ts:RollbackManager]
- `PatchParser`, `search-replace`, `structured-patch`, `patch-guard`, `edit-format-policy`, `edit-format-selector`, `full-file-guard`, and `diff-renderer` are pure and perform no I/O [search-replace.ts:parseSearchReplace] [diff-renderer.ts:DiffRenderer]

## Verification

- Run: `pnpm test`
