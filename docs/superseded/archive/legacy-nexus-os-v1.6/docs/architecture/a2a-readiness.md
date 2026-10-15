# A2A Readiness

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 37. A2A Readiness Gate

A2A integration must not ship until all of the following criteria are met. This gate exists because premature A2A exposure risks auth, identity, and lifecycle bugs across frameworks.

### 37.1 Gate Criteria

| Criterion | Verification |
|---|---|
| Agent Registry is stable for at least one full milestone with no breaking Agent Card schema changes | Schema version has not changed for >= 60 days and >= 2 milestones |
| Agent lifecycle (spawn, delegate, complete, fail, cancel) emits correct events in all code paths | Lifecycle eval suite passes with 0 failures |
| Agent Card `capabilities` field is validated against the Capability Taxonomy before any agent is registered | Taxonomy validation runs in CI |
| PolicyDecision is evaluated before every agent spawn and delegation | Policy eval suite for agent actions passes |
| At least one external A2A-compatible agent has been imported and successfully executed under ALiX's policy model in a test environment | A2A interop test in eval suite |
| Security review of the A2A gateway is complete | Sign-off documented in `docs/security/a2a_review.md` |
| `alix agent list` exposes a `--a2a-compat` filter showing which agents have stable enough cards to export | Command works in CI |

### 37.2 A2A Gate Command

```
alix a2a readiness
```

This command checks each gate criterion and prints a pass/fail table. A2A features are locked behind a feature flag until all criteria pass.

---


## v1.5 Hardening Note: Policy-Boundary Test Suite

A2A readiness must include tests where remote agents attempt undeclared capabilities, ask ALiX to execute unsafe local actions, exceed delegated scope, attempt recursive delegation, or mislabel unsafe artifacts. All tests must pass before A2A can be enabled.
