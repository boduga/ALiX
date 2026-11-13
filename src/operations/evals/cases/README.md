# Behavioral Eval Cases

## Overview
Static, deterministic case definitions for ALiX's behavioral eval suite. Each case pairs a scripted scenario with an evaluator-owned objective and an honest-status contract, so scoring compares observable filesystem state against what the runtime reported. The directory also holds the CPU-only labelling guard for stratum 9, which is an environment qualification rather than a behavioral case.

## Interface
- `BEHAVIORAL_CASES` — live suite aggregating EVAL-001..007 plus strata 2, 4, 5, and 10 cases [index.ts:BEHAVIORAL_CASES]
- `SYNTHETIC_CASES` — evaluator self-test fixtures that assert dishonest status reports are detected [index.ts:SYNTHETIC_CASES]
- EVAL-001..007 definitions: write, patch, block replacement, read-only, zero-attempt, forbidden-path, and partial-objective cases [behavioral.ts:EVAL_001_WRITE_FILE] [behavioral.ts:EVAL_007_PARTIAL]
- `STRATUM_2_AND_4_CASES` — navigation, complete multi-file repair, and partial multi-file repair [strata-2-4.ts:STRATUM_2_AND_4_CASES]
- `STRATUM_5_AND_10_CASES` — verification/repair and tool-failure/malformed-call cases [strata-5-10.ts:STRATUM_5_AND_10_CASES]
- `CPU_ONLY_ENVIRONMENT`, `isLocalProvider`, `canLabelCpuOnly`, `observedProviders`, and `classifyCpuOnlyRun` — stratum 9 qualification guard [stratum-9-local.ts:classifyCpuOnlyRun]

## Invariants
- Every behavioral case declares a driver, objective, expected objective landing, and allowed honest statuses [behavioral.ts:EVAL_001_WRITE_FILE] [index.ts:BEHAVIORAL_CASES]
- Synthetic cases set `syntheticStatus` and are not driven through a runtime [index.ts:SYNTHETIC_FALSE_SUCCESS]
- Read-only objectives require both unchanged source content and a distinctive reported answer, not mere file existence [behavioral.ts:EVAL_004_READ_ONLY]
- Cases marked `scriptedExpectationOnly` are authored to fail and cannot be satisfied by a real model completing the task correctly [behavioral.ts:EVAL_005_ZERO_ATTEMPTS]
- Composite multi-file objectives require every listed file to match; one-file repair does not land [strata-2-4.ts:STRATUM4_MULTI_FILE_FIX]
- The forbidden-path case's task text must itself name an escaping `../` path and declares only the in-workspace objective path as owned [behavioral.ts:EVAL_006_FORBIDDEN_PATH]
- CPU-only labelling accepts only `ollama` and `local-llama`; no observed provider or any remote provider fails the guard [stratum-9-local.ts:canLabelCpuOnly]
- Unattributable providers are recorded as `unknown` and treated as non-local, so the guard fails closed [stratum-9-local.ts:observedProviders]

## Side Effects
- None

## Verification
- Run: `pnpm test`
