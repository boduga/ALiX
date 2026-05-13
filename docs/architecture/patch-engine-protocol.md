# Patch Engine Protocol

## Purpose

The patch engine is the safety boundary between model output and the filesystem. Models may suggest edits, but only the patch engine parses, validates, checkpoints, applies, diffs, verifies, and rolls back changes.

## Non-Negotiable Invariants

- No file write happens without policy approval.
- No modification applies without preimage validation.
- Full-file rewrites are guarded even for long-context providers.
- Provider edit preference affects prompting, not safety.
- Every applied patch creates a checkpoint first.
- Every applied patch emits a diff artifact.
- Failed partial application rolls back to the checkpoint.

## Patch Lifecycle

```text
select_edit_format
  -> request_model_patch
  -> parse_patch
  -> validate_patch_shape
  -> policy_check
  -> create_checkpoint
  -> validate_preimage
  -> apply_patch
  -> render_diff
  -> run_verifier
  -> keep_or_rollback
```

## Edit Formats

### Structured Patch

ALiX-native format. Preferred when a provider reliably follows schemas.

```ts
type StructuredPatch = {
  version: 1;
  files: StructuredPatchFile[];
};

type StructuredPatchFile = {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  preimageHash?: string;
  newPath?: string;
  hunks: StructuredPatchHunk[];
};

type StructuredPatchHunk = {
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  beforeContext: string[];
  remove: string[];
  add: string[];
  afterContext: string[];
};
```

Validation:

- `path` must be inside workspace unless policy explicitly allows otherwise.
- `modify`, `delete`, and `rename` require `preimageHash`.
- Context lines must match current file content.
- Delete operations require explicit approval unless generated-file policy allows them.

### Unified Diff

Standard udiff. Useful for models and external tools that produce diffs well.

Validation:

- Parse with a strict diff parser.
- Require file paths.
- Reject ambiguous or binary patches.
- Require current content to match hunk context.

### Search/Replace

Exact replacement blocks. Useful for Gemini and local models that are less reliable at diffs.

```text
<<<<<<< SEARCH path=src/example.ts
exact old text
=======
exact new text
>>>>>>> REPLACE
```

Validation:

- Search block must match exactly once unless `occurrence` is specified.
- Whitespace is significant.
- Empty search is allowed only for file creation.
- Multiple replacements in one file apply from bottom to top by offset.

### Full File

Full replacement content.

Allowed for:

- New files.
- Generated files.
- Tiny files under a configured line threshold.
- Explicit approval through `FullFileRewriteGuard`.

Denied by default for existing human-authored source files.

## Provider Edit Format Policy

```ts
type EditFormatPolicy = {
  provider: string;
  modelPattern?: string;
  preferred: EditFormat;
  allowed: EditFormat[];
  fullFileRewrite: "deny" | "ask" | "allow_for_new_or_generated";
};

type EditFormat = "structured_patch" | "unified_diff" | "search_replace" | "full_file";
```

Initial defaults:

```json
[
  {
    "provider": "anthropic",
    "preferred": "structured_patch",
    "allowed": ["structured_patch", "unified_diff", "search_replace"],
    "fullFileRewrite": "ask"
  },
  {
    "provider": "openai",
    "preferred": "structured_patch",
    "allowed": ["structured_patch", "unified_diff", "search_replace"],
    "fullFileRewrite": "ask"
  },
  {
    "provider": "google",
    "preferred": "search_replace",
    "allowed": ["search_replace", "structured_patch", "unified_diff"],
    "fullFileRewrite": "ask"
  },
  {
    "provider": "local",
    "preferred": "search_replace",
    "allowed": ["search_replace"],
    "fullFileRewrite": "deny"
  }
]
```

## Preimage Hashing

```ts
type Preimage = {
  path: string;
  hashAlgorithm: "sha256";
  hash: string;
  sizeBytes: number;
  mtimeMs?: number;
};
```

Rules:

- Hash current file content before giving it to the model.
- Require the same hash before applying modifications.
- If the hash differs, reject and ask the agent to reread the file.
- For generated files, policy may allow relaxed validation only when configured.

## Checkpoints

Checkpoint strategy:

1. Prefer git worktree state when inside a git repo.
2. If not in git, copy modified files into `.alix/checkpoints/<checkpoint-id>/`.
3. Store checkpoint metadata in the event log.

```ts
type Checkpoint = {
  id: string;
  createdAt: string;
  strategy: "git" | "file_copy";
  files: string[];
};
```

## Rollback

Rollback is required when:

- Patch application partially fails.
- Verification fails and user chooses rollback.
- User explicitly requests rollback.

Rollback emits:

- `patch.rollback_started`
- `patch.rolled_back`
- `patch.rollback_failed`

## Patch Events

The patch engine must emit:

- `patch.format_selected`
- `patch.proposed`
- `patch.parsed`
- `patch.policy_checked`
- `patch.checkpoint_created`
- `patch.preimage_validated`
- `patch.applied`
- `patch.rejected`
- `patch.rolled_back`

## MVP Acceptance Tests

- Structured patch with exact context applies cleanly.
- Search/replace block with two matches is rejected as ambiguous.
- Search/replace block with one match applies cleanly.
- Full-file rewrite of an existing source file is blocked without explicit approval.
- File modified after context read causes preimage validation failure.
- Failed second hunk rolls back the first hunk.
- Gemini provider selects `search_replace` by default.
- OpenAI provider selects `structured_patch` by default.
