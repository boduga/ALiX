# DOX — Prompt Registry

**Purpose:** Owns the central registry of static model-facing prompts — ids, versions, token accounting, snapshot hashes.

**Ownership:**
- `registry.ts` — `PROMPT_REGISTRY`: 14 static prompts (agent base/supplements, subagent roles, planner, retrieval); bump `version` on any text change.

**Local Contracts:**
- Registry covers static templates only; per-turn assembly (tool manifests, memory blocks, digests) stays with its builder.
- Snapshot test fails on unversioned text edits: update hash + version together.
- Token counts use `cl100k_base` as a relative size signal, never billing.

**Work Guidance:**
- Editing any registered prompt text? Update `registry.ts` version + `tests/prompts/registry.test.ts` hashes in the same commit.
- Per-tier model variants (flash needs explicit schemas/few-shots) go here as new ids, not inline branches.

**Verification:**
- `tests/prompts/registry.test.ts` — ids/versions, non-empty text, token bounds, snapshot hashes.

**Child DOX Index:**

None — `src/prompts/` is a leaf subsystem with no child AGENTS.md.
