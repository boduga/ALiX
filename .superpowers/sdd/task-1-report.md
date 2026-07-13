Status: DONE
Commits: bbbabdd0
Test results:
```
▶ GovernanceDecisionKind
  ✔ has exactly 4 decision kinds (fewer than A2.5's 5 recommendation kinds)
  ✔ includes APPROVE
  ✔ includes REJECT
  ✔ includes MONITOR
  ✔ includes REQUEST_MORE_EVIDENCE (not REQUEST_ADDITIONAL_EVIDENCE, unlike A2.5)
  ✔ does NOT include ESCALATE (A3 uses decision paths, not ESCALATE as a kind)
✔ GovernanceDecisionKind (1.329952ms)
▶ isValidGovernanceDecisionKind
  ✔ returns true for APPROVE
  ✔ returns true for REQUEST_MORE_EVIDENCE
  ✔ returns false for an invalid kind
  ✔ returns false for empty string
  ✔ returns false for ESCALATE (A2.5 concept, not A3)
✔ isValidGovernanceDecisionKind (0.570224ms)
▶ DEFAULT_GOVERNANCE_POLICY
  ✔ has conservative defaults
  ✔ has ordered thresholds: reject < monitor < approve
  ✔ validates successfully against validateGovernancePolicyConfig
✔ DEFAULT_GOVERNANCE_POLICY (0.289668ms)
▶ validateGovernancePolicyConfig
  ✔ accepts a fully specified config
  ✔ rejects null input
  ✔ rejects missing policyName
  ✔ rejects invalid minApproveConfidence
  ✔ rejects invalid escalateBehavior
  ✔ rejects negative maxAllowedRegressions
  ✔ rejects non-boolean failClosedOnExpiredEvidence
✔ validateGovernancePolicyConfig (0.324957ms)
▶ validateGovernanceDecision
  ✔ accepts a valid decision
  ✔ accepts a valid REJECT decision
  ✔ accepts a valid MONITOR decision
  ✔ accepts a valid REQUEST_MORE_EVIDENCE decision
  ✔ accepts a decision with optional fields (recommendationId, overrideReason)
  ✔ rejects null input
  ✔ rejects missing decisionId
  ✔ rejects missing proposalId
  ✔ rejects missing evolutionId
  ✔ rejects invalid kind
  ✔ rejects invalid confidence range (above 1)
  ✔ rejects invalid confidence range (negative)
  ✔ rejects NaN confidence
  ✔ rejects missing reasoning
  ✔ rejects missing risks array
  ✔ rejects missing evidenceId
  ✔ rejects invalid targetState
  ✔ rejects invalid decidedBy
  ✔ rejects missing decidedAt
  ✔ rejects missing policySnapshot
  ✔ rejects policySnapshot with invalid policyName
  ✔ rejects non-boolean recommendationAvailable
  ✔ rejects non-boolean followedRecommendation
✔ validateGovernanceDecision (1.150579ms)
ℹ tests 44
ℹ suites 5
ℹ pass 44
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 126.511131
```
tsc --noEmit: clean
Concerns: None.
