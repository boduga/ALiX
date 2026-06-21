# P6.5b — Live Governance Lens Agents

> **Status:** Spec
> **Slice:** P6.5b lens execution in `alix decision review` only. No queue `--with-reviews`. No persistence.
> **Builds on:** P6.5a (LensAgent interface, GovernanceReviewCouncil, governance-review-types, sentinels)
> **Risk level:** MEDIUM — LLM critique introduces non-deterministic signal, but the review is advisory and never mutates state
> **Core invariant:** GovernanceReview ≠ Decision. Lens failure ≠ silent pass. Provider unavailable ≠ fake review.

## Core Framing

**Core question:** Can ALiX run the four governance lenses and produce an honest GovernanceReview artifact?

P6.5a shipped the deterministic framework: types, LensAgent interface, council aggregation, queue sort integration, sentinels. The `alix decision review` command is still a stub printing "unavailable." P6.5b replaces the stub with live LLM execution through a provider-isolated adapter, strict JSON parsing, and honest failure handling.

**This is not P6.5c.** P6.5b is lens execution only. Queue `--with-reviews`, review persistence, review-triggered actions, and historical review analysis are deferred.

## Architecture

```
LLMAdapter  (interface — completes a prompt, returns raw text)
  │
  └─ ProviderCatalogAdapter  (concrete — wraps src/providers/catalog.ts)
       └─ complete(input, options?) → Promise<string>

LLMLensAgent implements LensAgent  (one instance per lens)
  │
  ├─ takes LLMAdapter + LensName in constructor
  ├─ run(GovernanceReviewInput) → LensScore
  │    ├─ builds prompt from LENS_PROMPTS[lens] + input context
  │    ├─ sends to adapter
  │    ├─ parses strict JSON: { recommendedVerdict, confidence, rationale }
  │    └─ on any failure → insufficient_information, 0 confidence
  └─ validates output for authority language → insufficient_information

GovernanceReviewCouncil (unchanged from P6.5a)
  │
  └─ deterministic aggregation of LensScore[] → GovernanceReview
       └─ handles < 4 scores (partial review)

CLI: alix decision review <id>
  ├─ builds context → risk → recommendation (deterministic preconditions)
  ├─ runs all 4 lenses (or 1 with --lens)
  ├─ aggregates via council
  └─ renders terminal output or JSON
```

## LLMAdapter

```typescript
// src/adaptation/llm-adapter.ts

export interface LLMCompletion {
  content: string;
  provider?: string;
  model?: string;
}

export interface LLMAdapter {
  /** Send a prompt and return the response.
   *  Throws on timeout, network error, or empty response.
   *  Caller owns retry/fallback logic. */
  complete(
    input: { system: string; user: string },
    options?: { timeoutMs?: number },
  ): Promise<LLMCompletion>;
}
```

## ProviderCatalogAdapter

```typescript
// src/adaptation/provider-catalog-adapter.ts

export class ProviderCatalogAdapter implements LLMAdapter {
  constructor(private catalog: ProviderCatalog) {}

  async complete(
    input: { system: string; user: string },
    options?: { timeoutMs?: number },
  ): Promise<LLMCompletion> {
    const result = await this.catalog.complete({
      system: input.system,
      messages: [{ role: "user", content: input.user }],
      maxTokens: 512,
      temperature: 0,
      timeoutMs: options?.timeoutMs ?? 30000,
    });
    if (!result.content) throw new Error("Empty response from provider");
    return {
      content: result.content,
      provider: result.provider,
      model: result.model,
    };
  }
}
```

Note: The exact `ProviderCatalog.complete()` signature must be verified against the repo before implementation. Adapt the wrapper, not the interface.

## LLMLensAgent

```typescript
// src/adaptation/llm-lens-agent.ts

export class LLMLensAgent implements LensAgent {
  constructor(
    private adapter: LLMAdapter,
    private lens: LensName,
  ) {}

  async run(input: GovernanceReviewInput): Promise<LensScore> {
    const prompt = LENS_PROMPTS[this.lens];
    const context = this.#buildContext(input);

    try {
      const completion = await this.adapter.complete(
        { system: `${prompt}\n\n${LENS_JSON_SUFFIX}`, user: context },
        { timeoutMs: 30000 },
      );
      return this.#parseScore(completion);
    } catch {
      return this.#fallback("Lens agent failed to produce a result.");
    }
  }

  #buildContext(input: GovernanceReviewInput): string {
    const rec = input.recommendation;
    const ctx = input.decisionContext;
    return [
      `Recommendation: ${rec.recommendation} (confidence: ${(rec.confidence * 100).toFixed(0)}%)`,
      `Action: ${ctx.proposalAction}`,
      `Status: ${ctx.proposalStatus}`,
      `Age: ${ctx.ageDays} days`,
      `Lineage: ${ctx.lineageCompleteness}`,
      ctx.effectivenessTrend
        ? `Effectiveness keep rate: ${(ctx.effectivenessTrend.keepRate * 100).toFixed(0)}% (n=${ctx.effectivenessTrend.sampleSize})`
        : "Effectiveness: no data",
      ctx.warnings?.length ? `Warnings: ${ctx.warnings.map(w => w.message).join("; ")}` : "",
    ].filter(Boolean).join("\n");
  }

  #fallback(rationale: string): LensScore {
    return { lens: this.lens, recommendedVerdict: "insufficient_information", confidence: 0, rationale };
  }
}
```

### Model metadata (JSON output only)

The `LensScore` interface gains an optional `provider` and `model` field for JSON consumers. Terminal output omits these to reduce noise.

```typescript
export interface LensScore {
  lens: LensName;
  recommendedVerdict: GovernanceVerdict;
  confidence: number;
  rationale: string;
  /** Provider name used to generate this score (JSON only). */
  provider?: string;
  /** Model name used to generate this score (JSON only). */
  model?: string;
}
```

The `ProviderCatalogAdapter` captures `provider` and `model` from the catalog response and passes them through to `LLMLensAgent`, which sets them on the returned `LensScore`. This enables provenance tracking across model changes without adding persistence.

### Strict JSON parsing

```typescript
interface LensScoreJson {
  recommendedVerdict: "agree" | "agree_with_concerns" | "challenge" | "insufficient_information";
  confidence: number;
  rationale: string;
}

#parseScore(completion: LLMCompletion): LensScore {
  const cleaned = completion.content.replace(/```(?:json)?\s*/g, "").trim();

  let parsed: LensScoreJson;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Failed to parse lens output");
  }

  const validVerdicts: GovernanceVerdict[] = ["agree", "agree_with_concerns", "challenge", "insufficient_information"];
  if (!validVerdicts.includes(parsed.recommendedVerdict)) throw new Error("Invalid verdict");
  if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 1)
    throw new Error("Invalid confidence");
  if (typeof parsed.rationale !== "string" || parsed.rationale.length === 0)
    throw new Error("Missing or empty rationale");

  // Authority language check — scan entire parsed payload, not just rationale
  const forbidden = ["i approve", "i reject", "apply this", "execute this", "final decision", "must approve", "must reject"];
  const payload = JSON.stringify(parsed).toLowerCase();
  if (forbidden.some(phrase => payload.includes(phrase))) throw new Error("Authority language detected");

  return {
    lens: this.lens,
    recommendedVerdict: parsed.recommendedVerdict,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    provider: completion.provider,
    model: completion.model,
  };
}
```

### Error handling chart

| Failure mode | Result |
|---|---|
| Network error / timeout | `insufficient_information`, confidence 0, rationale "Provider timeout after 30000ms" |
| JSON parse failure | `insufficient_information`, confidence 0, rationale "Failed to parse lens output" |
| Invalid verdict in response | `insufficient_information`, confidence 0, rationale "Invalid verdict in lens output" |
| Authority language detected | `insufficient_information`, confidence 0, rationale "Lens output contained authority language and was discarded" |
| All 4 lenses fail | Council verdict: `insufficient_information`, confidence 0 |

## Prompt Execution

Each lens prompt composes `LENS_PROMPTS[lens]` from P6.5a with a centralized JSON-only suffix:

```typescript
export const LENS_JSON_SUFFIX =
  "Return ONLY valid JSON. Do not include markdown, prose, or code fences.\n" +
  "Do not approve, reject, apply, execute, or make a final decision.";

// In LLMLensAgent:
const system = `${LENS_PROMPTS[this.lens]}\n\n${LENS_JSON_SUFFIX}`;
```

This keeps the suffix in one place for sentinel testing, avoids duplicating text across 4 prompt entries, and makes it trivial to verify the suffix is present in every lens invocation.

The `#buildContext` method assembles a user message from `GovernanceReviewInput` fields.

## CLI Shape

```bash
alix decision review <proposal-id>                    # Run all 4 lenses, show terminal output
alix decision review <proposal-id> --json             # Full GovernanceReview as JSON
alix decision review <proposal-id> --lens historian   # Run a single lens only
```

### CLI flow

```
1. Parse args: <id>, --json, --lens <name>
2. If --lens is specified, validate against accepted names:
   red_team | historian | policy_auditor | confidence_critic
   → invalid lens exits non-zero before any provider call
3. Verify LLM provider is configured → if not, error + exit non-zero
3. Build context → risk → recommendation (fail fast — deterministic preconditions)
4. Assemble GovernanceReviewInput
5. For each lens (or single lens if --lens):
   a. Run all lenses in parallel: `Promise.all(lenses.map(l => l.run(input)))`
   b. On individual lens failure → catch → insufficient_information
6. GovernanceReviewCouncil.aggregate(...) → GovernanceReview
7. Render terminal output or JSON

All lenses run in parallel via `Promise.all`. Worst-case latency = `max(single lens timeout)` not `sum(all lens timeouts)`. For a 30s timeout, a 4-lens review completes in ~30s worst case, not ~120s.
```

### Terminal output

```
alix decision review prop-2026-06-21-042
═══════════════════════════════════════
Governance Review: prop-2026-06-21-042

Red Team:         agree (0.85)                     — No failure scenarios found
Historian:        agree_with_concerns (0.72)       — Similar action had 22% revert rate
Policy Auditor:   agree (0.90)                     — All governance rules satisfied
Confidence Critic: insufficient_information (0.00) — Sample size insufficient

Council verdict: agree_with_concerns
Council vote:    agree=2, concerns=1, challenge=0, insufficient=1
Confidence:      0.68

⚠ Historian: Similar action type show_health had 22% revert rate in last 90 days
```

### JSON output

Full `GovernanceReview` as JSON. Includes raw `lensScores[]` with their rationales (including failure rationales).

## File Structure

**Create:**
- `src/adaptation/llm-adapter.ts` — `LLMAdapter` interface
- `src/adaptation/provider-catalog-adapter.ts` — `ProviderCatalogAdapter implements LLMAdapter`
- `src/adaptation/llm-lens-agent.ts` — `LLMLensAgent implements LensAgent`
- `tests/adaptation/llm-adapter.vitest.ts` — adapter contract tests
- `tests/adaptation/llm-lens-agent.vitest.ts` — JSON parsing, authority detection, fallback, error handling
- `tests/adaptation/governance-review-sentinels.vitest.ts` — update sentinels for P6.5b

**Modify:**
- `src/cli/commands/decision.ts` — Replace `case "review"` stub with live execution, add `runReview`
- `src/adaptation/lens-agent.ts` — Append JSON-only suffix to all `LENS_PROMPTS` entries

**No new stores. No new evidence types. No queue changes. No persistence.**

## Sentinels (P6.5b additions)

Add to existing `governance-review-sentinels.vitest.ts`:
1. **LLMLensAgent must not import provider** — uses `LLMAdapter`, not `provider-catalog` or `ProviderCatalog` directly
2. **LLMAdapter interface has `complete()` method** — interface contract test
3. **ProviderCatalogAdapter does not strip authority checks** — authority detection is in LLMLensAgent, not the adapter
4. **JSON-only suffix present** — each `LENS_PROMPTS` entry ends with the JSON-only instruction

## Acceptance Criteria

1. `alix decision review <id>` runs all 4 lenses and renders terminal output
2. `alix decision review <id> --json` outputs full `GovernanceReview` as JSON
3. `alix decision review <id> --lens historian` runs a single lens only
4. All 4 lenses failing produces `verdict: insufficient_information`, not a crash
5. Individual lens failure → `insufficient_information` with rationale in `lensScores`
6. Authority language in lens output → `insufficient_information`, discarded
7. No provider configured → error message, exit non-zero
8. Council handles <4 scores without error
9. `ProviderCatalogAdapter` wraps provider; `LLMLensAgent` does not import provider directly
10. All existing P6.5a tests pass (no regressions), including council tests after widening `LensScore` with optional `provider`/`model`
11. `--lens` with invalid value exits non-zero before any provider call

## Explicitly Out of Scope (P6.5b)

| Feature | Destination | Reason |
|---------|-------------|--------|
| `--with-reviews` queue flag | P6.5c | Requires proven reviews first |
| Review persistence (GovernanceReviewStore) | P6.5c+ | Reviews remain ephemeral |
| Review history / trend analysis | Future | Requires persistence |
| Auto-trigger actions from reviews | Future | Reviews are advisory only |
| Batch review | Future | Single-proposal only |
| Provider selection per lens | Future | Uses catalog default |
