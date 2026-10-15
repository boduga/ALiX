## 35. Evaluation Harness Specification

Evaluation is required before public Agent OS demos. It must test task success, graph replay, policy enforcement, model routing, memory behavior, and SOP quality.

### 35.1 Eval Case Format

```yaml
id: research_source_grounding_001
suite: research
prompt: "Research whether LanceDB is suitable as a local vector backend."
expected_artifacts:
  - final_report.md
  - sources.json
  - claims.json
assertions:
  - type: artifact_exists
    artifact: final_report.md
  - type: min_sources
    count: 5
  - type: every_claim_has_source
  - type: critic_passed
  - type: budget_not_exceeded
budget:
  max_cost_usd: 2.00
  max_wall_clock_ms: 900000
```

### 35.2 LLMJudgeRubric Schema

When LLM-as-judge is used, a rubric must be defined and stored:

```typescript
type LLMJudgeRubric = {
  id: string;
  evalId: string;
  dimensions: {
    name: string;
    description: string;
    weight: number;     // 0.0–1.0; all weights must sum to 1.0
    passingScore: number;  // 0.0–1.0
  }[];
  overallPassingScore: number;  // weighted average required to pass
  judgeModel: string;           // model ID used for judging
  judgePrompt: string;          // full system prompt for the judge
};
```

Rules for LLM-as-judge:
- Deterministic checks are preferred over LLM-as-judge.
- LLM-as-judge is only permitted when a `LLMJudgeRubric` is defined and stored.
- The rubric, judge model, and judge prompt must be logged in the eval run record.
- Judge scores and reasoning must be stored as eval artifacts.

### 35.3 Required Eval Suites

```
evals/coding/basic_patch
evals/coding/issue_to_pr
evals/coding/test_repair
evals/research/source_grounding
evals/memory/retrieval_scope
evals/memory/conflict_resolution
evals/policy/unsafe_tool_call
evals/policy/budget_exhaustion
evals/graph/replay_recovery
evals/graph/node_cancellation
evals/sop/research_deep_report
evals/sidecar/stdio_protocol
evals/sidecar/cancellation
```

### 35.4 Eval Commands

```
alix eval run
alix eval run --suite research --model-profile balanced-local
alix eval compare --before baseline.json --after current.json
alix eval report --format markdown
alix eval baseline create --suite research --name M1.1-research
alix eval baseline promote <run-id>
alix eval compare --baseline M1.1-research
```

### 35.5 Evaluation Rules

- Deterministic checks are preferred over LLM-as-judge.
- LLM-as-judge may only be used with a stored `LLMJudgeRubric`.
- Every public showcase must have a passing eval suite.
- Eval output must include cost, token, latency, tool failure, repair loop, approval, and artifact metrics.
- A milestone is not shippable if any eval in the milestone's required suite is failing.
- Deterministic eval pass rate may not regress below the promoted baseline.
- Cost may not increase by more than 25% over baseline without explicit milestone approval.
- Latency may not increase by more than 30% over baseline without explicit milestone approval.
- Policy and security evals have zero-regression tolerance.

---

## v1.5 Baseline Policy

A milestone cannot ship if deterministic eval pass rate drops below previous baseline, policy/security evals regress, cost increases more than 25% without approval, or latency increases more than 30% without approval.
