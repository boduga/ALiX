# M0.9 Model Routing Validation Spike

## Purpose

The local model defaults are plausible but not proven. M0.9 must validate whether the small local models can reliably perform their assigned roles before ALiX depends on them for the Agent OS runtime. This adopts the Odysseus lesson that local-first AI needs hardware-aware model onboarding and practical model-fit validation rather than blind defaults.

## Candidate Defaults

| Tier | Candidate Model | Task |
|---|---|---|
| fast | `qwen3:4b` | intent classification, routing, cheap JSON |
| thinking | `qwen3:8b` | planning, graph decomposition, risk reasoning |
| coding | `qwen2.5-coder:7b` | code repair, patch planning, test generation |
| critic | `qwen3:8b` | review, contradiction detection, acceptance checks |

## Test Suites

### 1. Intent Classification

- 100 curated prompts across coding, research, infra, docs, business, personal, unsafe/blocked.
- Required output: valid JSON with `domain`, `intent`, `risk`, `needs_graph`, `needs_approval`.
- Pass threshold: >= 90% correct domain/intent; >= 95% valid JSON.

### 2. Graph Planning

- 30 multi-step tasks.
- Required output: valid single/multi-node TaskGraph JSON.
- Pass threshold: >= 85% valid TaskGraph JSON; >= 80% appropriate decomposition.

### 3. Coding Repair

- 20 small curated TypeScript failures.
- Pass threshold: >= current baseline; no syntax-regressing patches.

### 4. Critic Verification

- 30 outputs with planted unsupported claims, stale claims, missing tests, or bad citations.
- Pass threshold: catches >= 80% of planted issues; false-positive rate <= 20%.

## Role-Specific Model Comparison

ALiX should adapt Odysseus-style model comparison into role-specific routing tests rather than generic chat comparisons.

```bash
alix eval compare-models --role fast-router
alix eval compare-models --role graph-planner
alix eval compare-models --role coding
alix eval compare-models --role critic
```

Each comparison report must include:

- pass/fail against threshold
- valid JSON rate where applicable
- latency
- cost estimate
- policy/risk mistakes
- recommended model-profile change

## Commands

```bash
alix eval run --suite model-routing --model-profile balanced-local
alix models benchmark --profile balanced-local
alix models doctor
alix models fit
alix eval compare-models --role fast-router
```

## Decision Rules

- If `qwen3:4b` fails classification thresholds, promote `qwen3:8b` to fast/thinking and keep `qwen3:4b` for cheap summaries only.
- If `qwen3:8b` fails graph planning, require cloud/thinking fallback or `power-local` for graph planning.
- If `qwen2.5-coder:7b` underperforms current coding baseline, keep current provider fallback for coding tasks.
- Results must be stored as `docs/evals/model_routing_results.md` before M0.9 exits.
