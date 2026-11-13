# Verification Planning and Execution

## Overview
Builds change-aware verification plans, discovers package.json check scripts, maps changed source files to tests, and executes checks against the current working tree. It also provides dependency-graph reachability, risk summaries, and an optional failure-history scorer backed by the embedder package.

## Interface
- `requiresRepositoryVerification(changedFiles, force)` and `discoverVerification(root)` [verifier.ts:requiresRepositoryVerification], [verifier.ts:discoverVerification].
- `runVerification(root, check)` and `shouldRunVerification(sessionMode, scopeApproved)` [verifier.ts:runVerification], [verifier.ts:shouldRunVerification].
- `VerificationCheck`, `VerificationResult`, and `VerificationPolicy` contracts [verifier.ts:VerificationCheck], [verifier.ts:VerificationResult], [verifier.ts:VerificationPolicy].
- `classifyChanges(files)` and `getSuggestedChecks(classification)` [change-classifier.ts:classifyChanges], [change-classifier.ts:getSuggestedChecks].
- `DependencyGraph`, `buildDepGraphFromImports(root, filePaths)`, `depsOf`, `dependentsOf`, and `findAffectedTests` [dep-graph.ts:DependencyGraph], [dep-graph.ts:buildDepGraphFromImports].
- `mapFilesToTests(root, changedFiles)` [test-mapper.ts:mapFilesToTests].
- `TestPlanner`, `createTestPlan(root, changedFiles)`, and `TestPlan` [test-planner.ts:TestPlanner], [test-planner.ts:createTestPlan], [test-planner.ts:TestPlan].
- `buildVerificationPlan(checks)` and `addSkippedCheck(plan, command, reason)` plus their plan contracts [planner.ts:buildVerificationPlan], [planner.ts:addSkippedCheck].
- `buildRiskReport(allChecks, results)` and `formatVerificationSummary(allChecks, results)` [risk-report.ts:buildRiskReport], [risk-report.ts:formatVerificationSummary].
- `EnhancedVerifier`, `EnhancedVerifierOptions`, `VerificationWithScore`, and `FixSuggestion` [enhanced-verifier.ts:EnhancedVerifier], [enhanced-verifier.ts:EnhancedVerifierOptions].
- Child contract: [Embedder](./embedder/README.md) provides the failure store, exemplar matcher, and embedding scorer.

## Invariants
- Repository verification is required when `force` is true or any changed file has an extension outside the documentation-only set [verifier.ts:requiresRepositoryVerification].
- Discovery admits only package scripts named exactly for test, build/compile, or typecheck/type-check/lint, then orders them typecheck, build, test [verifier.ts:discoverVerification].
- Execution reports `not_run` when the isolation runner throws and carries the observed `isolated` state on every completed result [verifier.ts:runVerification].
- Ask mode without approved scope returns the skip reason `ask mode: waiting for scope approval` [verifier.ts:shouldRunVerification].
- Change classification is precedence-ordered; multiple distinct types produce `primary: "mixed"` with the remaining types as secondary [change-classifier.ts:classifyChanges].
- Suggested checks add `typecheck` and `test` for code/test/mixed changes, and `build` only for config/dependency changes [change-classifier.ts:getSuggestedChecks].
- Dependency traversal walks reverse imports transitively, records only `.test.ts` and `.spec.ts` dependents as affected tests, and avoids revisits [dep-graph.ts:findAffectedTests].
- Relative import resolution normalizes `..` segments and rewrites a trailing `.js` to `.ts`; non-relative imports are retained verbatim [dep-graph.ts:resolveImport].
- Test mapping returns specific `npx vitest run "<path>"` checks when any candidate exists, otherwise one `npm test` fallback [test-mapper.ts:mapFilesToTests].
- `TestPlanner` costs typecheck/build/test as 1/3/10, orders cheapest first, and marks a changed file verified only when its mapped reason names that file [test-planner.ts:TestPlanner], [test-planner.ts:plan].
- `createTestPlan` auto-detects only typecheck/type-check/lint and build package scripts, selects `targeted` for non-empty changes and `minimal` otherwise, and warns rather than throws on an unreadable package.json [test-planner.ts:createTestPlan].
- `maxCost` is accepted by `TestPlanner.plan` but is not applied to filtering or totals [test-planner.ts:plan].
- Plan ordering is cost first and required first within equal cost; a new plan has an empty `changedFiles` list and a timestamped id [planner.ts:buildVerificationPlan].
- Risk reporting lists missing checks as `[NOT RUN]`, failed checks with at most ten output lines, and omits passed checks [risk-report.ts:buildRiskReport].
- Summary counts include passed and failed results, while skipped is the difference between all checks and reported results [risk-report.ts:formatVerificationSummary].
- `EnhancedVerifier` returns score `1.0` and `existingChecks: false` when discovery finds no checks [enhanced-verifier.ts:verifyAndScore].
- Confidence is clamped to 0..1 and combines pass rate (0.6), check coverage (0.2), and history (0.2 when failures exist, otherwise 0.1) [enhanced-verifier.ts:calculateConfidenceScore], [enhanced-verifier.ts:getHistoryScore].

## Side Effects
- `buildDepGraphFromImports` reads each existing input file from disk through `readFile` [dep-graph.ts:buildDepGraphFromImports].
- `runVerification` executes the selected package command through `runWithIsolation` with a 120000 ms limit [verifier.ts:runVerification].
- `TestPlanner` reads and parses `package.json` and warns to the console on parse or read failure [test-planner.ts:createTestPlan].
- `EnhancedVerifier.init` opens the failure database; `verifyAndScore` executes every discovered check; `recordFailure` writes a failure record; `close` releases the database [enhanced-verifier.ts:init], [enhanced-verifier.ts:verifyAndScore], [enhanced-verifier.ts:recordFailure], [enhanced-verifier.ts:close].
- `recordFailure` derives failure and session ids from `Date.now()` and persists a verification embedding id [enhanced-verifier.ts:recordFailure].

## Verification
- Run: `pnpm test`
