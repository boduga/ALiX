# ADR-0003: balanced-local Model Profile Decision

**Date:** 2026-06-08
**Status:** Accepted

## Context

The M0.9 model-routing validation spike tested qwen3:4b and qwen3:8b against 15 curated classification prompts. The full 45-case × 3-tier run requires GPU hardware; the CPU-only environment confirmed structured JSON output at 100% valid rate for both models.

## Decision

qwen3:4b remains the default `fast` tier for M0.10. Rationale:

1. **100% valid JSON rate** — both models consistently produce structured output
2. **Classification accuracy requires GPU to complete** — cannot justify a downgrade without full evidence
3. **qwen3:8b remains available** as `thinking` and `critic` tier fallback

## Implications

- M0.10 starts with `balanced-local` unchanged
- Full eval should run on GPU before M0.10 ships
- If qwen3:4b fails the 90% domain accuracy threshold, default fast tier bumps to qwen3:8b
