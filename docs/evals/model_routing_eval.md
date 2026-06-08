# Model Routing Validation — M0.9 Baseline

**Date:** 2026-06-08
**Status:** Partial (CPU-only environment, GPU required for full validation)

## Summary

The model routing validation spike script exists at `scripts/validate-model-routing.ts` with 15 curated test cases across 6 domains (coding, research, infra, docs, business, unsafe). The `summarizeRoutingResults()` scoring function and unit tests (3 tests, passing) are complete.

## Environment Limitation

This environment runs Ollama on CPU only (no GPU). qwen3:4b takes >120 seconds per inference. Full validation (15 cases × 3 tiers = 45 inferences) would require ~90+ minutes wall-clock time.

## What's Tested

- Scoring logic: `summarizeRoutingResults()` — 3 unit tests pass
- Validation cases: 15 curated prompts across 6 domains — syntactically valid
- Threshold constants: defined and type-checked

## What Requires GPU Hardware

Tier | Model | Cases | Purpose
-----|-------|-------|--------
fast | qwen3:4b | 15 | Classification accuracy ≥ 90%
thinking | qwen3:8b | 15 | Planning/critic quality ≥ 95%
coding | qwen2.5-coder:7b | 15 | Coding task routing ≥ 90%

## How to Run

```bash
# Ensure models are pulled
ollama pull qwen3:4b
ollama pull qwen3:8b
ollama pull qwen2.5-coder:7b

# Run validation
npx tsx scripts/validate-model-routing.ts
```

## M0.10 Recommendation

Default `balanced-local` model profile remains unchanged. The validation spike should be run on a GPU-equipped machine before M0.10 ships. If qwen3:4b fails the 90% domain accuracy threshold, bump the default fast tier to qwen3:8b.
