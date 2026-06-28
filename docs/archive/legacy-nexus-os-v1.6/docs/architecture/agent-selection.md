# Agent Selection

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 22. Agent Selection Algorithm

### 22.1 Scoring Formula

```
agent_score =
    (capability_fit_score     * 0.30)
  + (policy_fit_score         * 0.25)
  + (relevance_score          * 0.20)
  + (historical_success_score * 0.15)
  + (availability_score       * 0.10)
  - (cost_penalty             * 0.05)
  - (risk_penalty             * 0.05)
  - (recent_failure_penalty   * dynamic)
```

All component scores are normalized to [0.0, 1.0].

### 22.2 Component Definitions

| Component | Definition |
|---|---|
| `relevance_score` | Cosine similarity between the task goal embedding and the agent's capability description embedding. |
| `capability_fit_score` | Ratio of required capabilities covered by the agent's declared capabilities: `required ∩ agent / required`. An agent missing a required capability scores 0.0 on this component. |
| `policy_fit_score` | 1.0 if the agent's declared capabilities are all permitted by the active policy; 0.0 if any declared capability is denied; proportional otherwise. |
| `historical_success_score` | Rolling weighted average of the agent's task success rate over the last N=50 tasks in the same domain. Decays toward 0.5 (neutral) when fewer than 5 historical tasks exist. |
| `availability_score` | 1.0 if the agent is idle; 0.5 if the agent is running but accepts queued tasks; 0.0 if the agent is at capacity. |
| `cost_penalty` | Normalized estimated cost of the agent's model tier relative to the graph budget. |
| `risk_penalty` | Normalized maximum risk tier of the agent's declared capabilities. |
| `recent_failure_penalty` | Applied additively. For each failure in the last 5 tasks in the same domain: `0.05 * exp(-hours_since_failure / 24)`. Decays to 0.0 after 72 hours. |

### 22.3 Tie-breaking

When two agents score within 0.02 of each other, select by:

1. Lower cost penalty (prefer cheaper).
2. Lower risk penalty (prefer safer).
3. Lower latency (prefer faster).
4. Alphabetical agent ID (deterministic fallback).

### 22.4 Selection Rules

Selection uses hard eligibility gates before weighted scoring:

1. Required capabilities must be satisfied.
2. Denied policy action means ineligible.
3. Required sandbox must be available.
4. Required model tier must be available or fallback must be approved.
5. Agent schema version must be compatible.

Additional rules:

- An agent with `capability_fit_score = 0.0` is ineligible regardless of other scores.
- For safety-critical nodes, partial capability fit is not permitted; all required capabilities must be covered.
- Policy fit is evaluated against required capabilities first. Declared-but-unused capabilities may lower trust score but should not automatically disqualify broad agents unless the active policy forbids them.
- If no eligible agent exists, the node enters `blocked` state and surfaces an `agent.unavailable` event.
- The selection result is persisted as an `agent.selected` event including all component scores and hard-gate outcomes.

---


## v1.5 Hardening Note

Capability and policy fit must be treated as hard pre-filters before ranking. The preferred implementation order is:

1. Required capabilities satisfied.
2. Policy allows required capabilities.
3. Required sandbox available.
4. Required model tier available.
5. Agent schema version compatible.
6. Score remaining eligible agents.

Recommended scoring for implementation:

```text
agent_score =
    capability_fit_score     * 0.30
  + policy_fit_score         * 0.25
  + relevance_score          * 0.20
  + historical_success_score * 0.15
  + availability_score       * 0.10
  - cost_penalty
  - risk_penalty
  - recent_failure_penalty
```
