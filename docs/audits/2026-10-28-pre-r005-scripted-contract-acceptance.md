# PRE-R005 scripted-contract acceptance — 2026-10-28

**Requirement:** PRE-R005 — define a fixed, versioned task corpus and independently verified outcomes.  
**Acceptance:** tasks, fixtures, environment and scoring are repeatable.  
**Source under test:** `d2d41adb` on `fix/d9-phase-f-remediation-v2`.  
**Evidence:** `benchmark/evidence/pre-r005-scripted-contract-requalification-2026-10-28.json` (SHA-256 `e1dd1492e2d805fb79ee7e51a8c8770ed77af3efe5c5df07f9c881bb3f34747d`).

## Result

**SUPPORTED at corpus-contract scope.** The five `scriptedExpectationOnly` cases are intentionally deterministic runtime-contract fixtures rather than real-model capability tasks. Their segregation from real-provider scoring is part of the corpus contract, not an unresolved PRE-R005 oracle defect.

Fresh deterministic execution produced:

| Case | Verdict | Objective | Honest status | Independent guard | Observed tool calls |
|---|---|---|---|---|---:|
| `behavioral.unmet-write-zero-attempts` | pass | not landed | `failed` | n/a | 0 |
| `behavioral.partial-objective` | pass | not landed | `partial` | exact file guards pass | 1 |
| `behavioral.multi-file-fix-partial` | pass | not landed | `partial` | exact file guards pass | 1 |
| `behavioral.verification-repair-not-applied` | pass | not landed | `failed` | n/a | 0 |
| `behavioral.malformed-tool-call` | pass | not landed | `failed` | n/a | 0 |

The zero-tool-call rows are measured zeros from observed session evidence, not inferred absence. Existing corpus-oracle tests reject comment-only false repairs; guard tests fail closed on malformed/missing tool evidence.

## Independent verifier

A separate local `llama3.2:3b` verifier via Ollama, temperature 0, reviewed only the frozen facts above and concluded PRE-R005 has sufficient evidence for corpus-contract support, while explicitly rejecting any inference to real-model outcomes or PRE-R006. This is an independent model review of the acceptance framing, not a security qualification.

## Boundaries

This acceptance does **not**:

- requalify historical paid/model runs;
- assert real-model success rates or comparative quality;
- clear PRE-R006 baseline measurement/qualification;
- turn scripted runtime-contract fixtures into real-provider tasks;
- clear Gate E or any security/release gate.

PRE-R006 remains the separate requirement for measured model outcomes, cost, latency and uncertainty.
