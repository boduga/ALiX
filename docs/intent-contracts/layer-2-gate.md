# Layer-1 → Layer-2 gate — audit (T25 #403)

**Status**: Active (T25 on wayfinder map #399).
**Owner**: Layer 2 (LLM fallback).
**Test**: `tests/runtime/task-router.test.ts → describe("taskRouter — Layer-1→Layer-2 gate closed-world (T25 #403)")`.

## The gate

`src/runtime/task-router.ts:445-447`:

```ts
if (
  opts?.classifierProvider &&
  (classification.intent === "ambiguous" || classification.confidence < CONFIDENCE_THRESHOLD)
) {
  const modelResult = await modelClassifyAction(task, opts.classifierProvider);
  // T24 (#402): trust model label only when intent !== ambiguous AND
  // confidence >= MODEL_CONFIDENCE_THRESHOLD.
  ...
}
```

The model fallback (Layer 2) runs only when **both** hold:
1. A `classifierProvider` is configured (`opts?.classifierProvider`).
2. The Layer-1 deterministic result is `ambiguous` **or** scored below `CONFIDENCE_THRESHOLD` (0.7).

## Audit findings

### Finding A — the `confidence < CONFIDENCE_THRESHOLD` arm is currently dead

`confidenceForIntent` (`src/runtime/action-classifier.ts:691`) assigns every
non-ambiguous intent a **fixed** confidence ≥ 0.75:

| Intent | Fixed confidence |
|---|---|
| `arithmetic` | 1.0 |
| `workspace_action` | 0.95 |
| `workspace_mutation` | 0.95 |
| `shell_execution` | 0.9 |
| `generation` | 0.85 |
| `read_only_analysis` | 0.85 |
| `planning` | 0.85 |
| `external_retrieval` | 0.75 |
| `ambiguous` | 0.5 |

Since every non-ambiguous intent ≥ 0.75 and `CONFIDENCE_THRESHOLD = 0.7`, no
prompt classifies to a non-ambiguous intent below the threshold. The effective
gate today is `intent === "ambiguous"`.

**Disposition**: **Keep** the second arm. It is a future-proofing safety net —
if a future confidence-tuning change drops any intent below 0.7, the gate
starts routing those prompts to the model without a code change. A closed-world
test pins the current invariant (every non-ambiguous intent ≥ threshold) so
such a change is caught and reviewed.

### Finding B — the Layer-1 gate and Layer-2 floor are independent and both enforced

- **Layer-1 gate** (`CONFIDENCE_THRESHOLD = 0.7`): decides whether the model is
  *invoked* (only for prompts Layer 1 is unsure about).
- **Layer-2 floor** (`MODEL_CONFIDENCE_THRESHOLD = 0.7`, T24 #402): decides
  whether the model's *output* is *trusted* for routing.

Both are exported constants in `src/runtime/action-classifier.ts` and tune
independently. A model label below the Layer-2 floor (or with a missing
confidence, which T23 defaults to 0) is treated as `ambiguous` and falls
through to the safe default route — never a high-risk path.

### Finding C — no provider → legacy path, never the model

When no `classifierProvider` is configured, `opts?.classifierProvider` is
falsy and the gate short-circuits. The prompt falls through to the legacy
`classifyTask` planning-lens path (`task-router.ts:496`). The model is never
invoked. Pinned by closed-world test #3.

## Closed-world gate matrix

| Layer-1 result | Provider configured? | Model invoked? | Route source |
|---|---|---|---|
| high-confidence non-ambiguous (≥ 0.7) | yes | **no** | Layer 1 (early step) |
| `ambiguous` | yes | **yes** | Layer 2 (if trusted) else safe default |
| `ambiguous` | no | **no** | legacy `classifyTask` |
| low-confidence non-ambiguous (< 0.7) | yes | **yes** | *unreachable today* (Finding A) |

## Config surface

- `taskRouter(task, opts)` — `opts.classifierProvider?: ModelAdapter`. When set,
  the gate is armed. When omitted, Layer 2 is disabled and the legacy path is
  used. Session wiring: `src/agent/session.ts` resolves `classifierModel` /
  `chatModel` into the provider passed to `taskRouter`.
