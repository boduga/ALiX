# Hybrid Deterministic + Model Prompt Classifier

**Date:** 2026-07-25
**Status:** Draft
**Supersedes:** Deterministic-only classifier in `src/runtime/action-classifier.ts`

## Problem

The deterministic action classifier (`classifyAction`) is brittle against
natural-language prompts that resemble file operations. For example:

```
add a test for the login function to test_auth.py
```

matches `FILE_APPEND_PATTERN` (`add...to`) and would execute a garbage
shell command (`printf '%s\n' 'a test for the login function' >> file`)
instead of routing to the agent to write a real test function.

The classifier has no fallback — every prompt is decided by regex alone.
There is no notion of confidence or uncertainty.

## Solution

Add one new `ModelTier` — `"classifier"` — and use it as a model-based
fallback when the deterministic classifier's confidence is low.

### Architecture (unchanged)

```
user prompt
     │
     ▼
classifyAction(input) ─── confident? ──→ route directly
     │   (ambiguous / low confidence
     │    and classifier model configured)
     ▼
modelClassifyAction(input, provider)
     │
     ▼
  route based on model result
```

## Change 1 — New ModelTier

**File:** `src/config/profile-types.ts`

Add `"classifier"` to the `ModelTier` union:

```typescript
export type ModelTier =
  | "default"
  | "planner"
  | "researcher"
  | "coder"
  | "critic"
  | "embeddings"
  | "classifier";
```

Update `VALID_TIERS` set accordingly.

Config example (same structure as every other tier):

```json
{
  "modelTiers": {
    "classifier": { "provider": "ollama", "name": "llama3" }
  }
}
```

When omitted, the classifier resolves from the `"default"` tier (which
is always configured). This means the model fallback works out of the
box for every user — no extra config required. Users who want zero
model calls for classification can explicitly set the tier to `null`.

## Change 2 — Confidence Threshold

**File:** `src/runtime/action-classifier.ts`

Add a `classifyActionWithConfidence(input): { intent, reason, confidence, arithmeticAnswer }`
variant that returns a `confidence: number` (0.0–1.0) alongside the
existing classification.

Confidence mapping for existing intents:

| Classification | Confidence | Rationale |
|---|---|---|
| `arithmetic` | 1.0 | Deterministic parser, perfect precision |
| `workspace_action` | 0.95 | Strong anchor patterns, rare false positives |
| `standalone_generation` | 0.85 | Generation signals can overlap with general chat |
| `external_retrieval` | 0.75 | Retrieval signals like "current", "latest" can be ambiguous |
| `ambiguous` | 0.0 — 0.5 | No dominant signal; varies by prompt length/specificity |

## Change 3 — Model Fallback Function

**File:** `src/runtime/action-classifier.ts`

New pure-adjacent function:

```typescript
export async function modelClassifyAction(
  input: string,
  provider: ModelAdapter,
): Promise<ActionClassification>
```

System prompt (~80 tokens):

```
You are a prompt router. Given a user request, classify it as exactly
one of these labels:

arithmetic
workspace_action
standalone_generation
external_retrieval
ambiguous

Reply with ONLY the label. No explanation. No punctuation.
```

One provider call: ~50 input tokens, ~5 output tokens.

On provider error (timeout, connection refused, etc.): caller catches
and falls back to the deterministic result — model failure must never
block routing.

## Change 4 — Router Integration

**File:** `src/runtime/task-router.ts`

`taskRouter` gains an optional second parameter and becomes async:

```typescript
export async function taskRouter(
  task: string,
  opts?: { classifierProvider?: ModelAdapter },
): Promise<TaskRoute>
```

The function always returns a Promise. Fast-path cases (confident deterministic)
resolve immediately — no provider call, no await delay.

Logic flow (replaces the current synchronous `taskRouter`):

1. Run deterministic `classifyActionWithConfidence(input)` (unchanged
   classification logic, new confidence score).
2. If intent is **not** `ambiguous` and confidence ≥ `CONFIDENCE_THRESHOLD`
   (0.7, hardcoded constant) → return resolved Promise immediately.
3. If ambiguous AND `opts.classifierProvider` is set → call
   `modelClassifyAction(input, provider)`. Use model result as the
   primary classification, keep deterministic reason as fallback text.
4. If ambiguous AND no provider → fall through to legacy
   `classifyTask`/`isGroundedChatTask` path (unchanged today).

The natural-language file operation patterns still fire BEFORE the model
call — `ls -la`, `write X to Y`, and other clearly-matched patterns
resolve synchronously and never hit the provider. Only ambiguous / low-confidence
prompts that happen to match a file pattern (like "add a test for X to Y")
reach the model step.

## Change 5 — Wiring

Three call sites pass `opts.classifierProvider`:

| Caller | Location |
|--------|----------|
| `AgentSession.processTurn()` | `src/agent/session.ts:726` |
| `daemon-server.ts` (run) | `src/daemon/daemon-server.ts:137` |
| `daemon-server.ts` (direct) | `src/daemon/daemon-server.ts:189` |
| `daemon-server.ts` (backward) | `src/daemon/daemon-server.ts:468` |

Provider resolution (same pattern as `processChat`'s `ensureChatProvider`):

```
config.modelTiers?.classifier
  ?? createProvider({ provider: ..., model: ... }) from that tier
  ?? null  → pure deterministic, no change
```

## Backwards Compatibility

- `taskRouter` signature changes from sync to async — ALL existing
  callers must be updated to `await` (or the non-opts path must wrap
  in `Promise.resolve`). This is the biggest migration surface.
- When the `classifier` tier is explicitly null: zero behavioral change.
  Zero provider calls for the fallback path. Deterministic-only.
- When the tier is omitted (resolves from `"default"`): the main model
  handles a tiny additional load (~50 tok in, ~5 tok out, only for
  ambiguous prompts). This is the default behavior — no config change
  needed.
- When the tier is configured to a cheap model (recommended): dedicated
  model for classification, main model untouched.
- When the classifier provider is down: deterministic fallback, no crash.

## Test Plan

| Test | What it verifies |
|------|-----------------|
| Deterministic path unchanged | `classifyAction` returns same results as before |
| Model override on ambiguous | `modelClassifyAction` result wins when provider set |
| Model failure = deterministic fallback | Provider throws → deterministic result used |
| No provider configured = pure deterministic | `taskRouter` without opts is unchanged |
| File operations bypass model | `ls`, `write X to Y` don't call provider |
| Tier config propagation | `classifier` tier in modelTiers reaches router |
