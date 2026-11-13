# Workflow Agents

## Overview

The five governance agents that drive an issue from GitHub intake to a draft pull request. Each agent owns one stage and is deliberately narrow: intake, planning, review, and PR generation perform read-only analysis plus an explicit state transition, while `ExecutionAgent` is the only component that crosses the trust boundary into repository modification. Execution is guarded by a permit, a protected-path list, a test gate, and stop-on-first-failure semantics with no auto-repair (`execution-agent.ts:ExecutionAgent.execute`).

The stage sequence is `NEW → SELECTED → PLANNED → UNDER_REVIEW → EXECUTING → UNDER_REVIEW → PR_READY → AWAITING_HUMAN`, with each agent recording evidence before or alongside its transition.

## Interface

- `ExecutionAgent`, `ExecutionAgentOptions`, `ExecuteResult`, `SubtaskResult`, `TestResult`, `ExecutionErrorCode` — executes an approved `ExecutionPlan` subtask by subtask (`execution-agent.ts:ExecutionAgent`, `execution-agent.ts:ExecutionAgentOptions`).
- `ExecutionAgent.execute(plan, coordinator, writer, permit)` — validates the permit, transitions to `EXECUTING`, runs every subtask in order, and transitions to `UNDER_REVIEW` on success (`execution-agent.ts:ExecutionAgent.execute`).
- `ExecutionAgentOptions.writeFile`, `.runTests`, `.gitCommit` — injectable seams for filesystem writes, test execution, and commits (`execution-agent.ts:ExecutionAgentOptions`).
- `PROTECTED_PATHS` — directory/file prefixes execution and review refuse to touch (`execution-agent.ts:PROTECTED_PATHS`).
- `IssueIntakeAgent`, `GhIssueData`, `IntakeResult`, `SelectResult`, `RejectionCode` — reads and validates GitHub issues into a `WorkPackage` (`issue-intake-agent.ts:IssueIntakeAgent`).
- `IssueIntakeAgent.intake(issueNumber, issueData?)` — accepts pre-fetched issue data for tests; otherwise reads via `gh` (`issue-intake-agent.ts:IssueIntakeAgent.intake`).
- `IssueIntakeAgent.select(...)` — intake plus `NEW → SELECTED` transition and `issue_selected` evidence (`issue-intake-agent.ts:IssueIntakeAgent.select`).
- `REJECTION_LABELS` — labels that disqualify an issue (`issue-intake-agent.ts:REJECTION_LABELS`).
- `PlanningAgent`, `PlanResult`, `PlanRejectionCode` — turns a `WorkPackage` into an `ExecutionPlan` (`planning-agent.ts:PlanningAgent`).
- `PlanningAgent.plan(workPackage)` and `PlanningAgent.execute(workPackage, coordinator, writer)` — read-only planning and the `SELECTED → PLANNED` transition (`planning-agent.ts:PlanningAgent.plan`, `planning-agent.ts:PlanningAgent.execute`).
- `PlanningAgentOptions.branchNameFn` / `.fileExistsFn` — injectable branch naming and filesystem existence checks (`planning-agent.ts:PlanningAgent` constructor).
- `ReviewAgent`, `ReviewReport`, `ReviewResult`, `ReviewRejectionCode` — independent plan review (`review-agent.ts:ReviewAgent`).
- `ReviewAgent.review(executionPlan)` and `ReviewAgent.execute(...)` — read-only verdict and the `PLANNED → UNDER_REVIEW` transition with started/completed evidence (`review-agent.ts:ReviewAgent.review`, `review-agent.ts:ReviewAgent.execute`).
- `PRAgent`, `PrepareResult`, `CreateResult`, `PRRejectionCode` — formats and creates draft PRs (`pr-agent.ts:PRAgent`).
- `PRAgent.prepare(executionPlan, reviewReport?, evidenceFingerprints?)` — builds a `PullRequestArtifact` without calling GitHub (`pr-agent.ts:PRAgent.prepare`).
- `PRAgent.create(...)` — creates the draft PR, records `pr_created`, and transitions `PR_READY → AWAITING_HUMAN` (`pr-agent.ts:PRAgent.create`).

## Invariants

- Execution requires a non-null `ExecutionPermit` whose `issueNumber` equals the plan's `workPackage.issueNumber`; otherwise it returns `no_permit` or `permit_mismatch` before any write (`execution-agent.ts:ExecutionAgent.execute`).
- Every subtask file must appear in `permit.allowedFiles` and must not start with any `PROTECTED_PATHS` entry (`execution-agent.ts:ExecutionAgent.executeSubtask`).
- Subtasks execute sequentially and the first failure aborts the run with its `ExecutionErrorCode`; there is no retry or repair loop (`execution-agent.ts:ExecutionAgent.executeSubtask`).
- Tests run before the commit for any subtask with `testFiles`; a failure records `test_failed` and returns `tests_failed` without committing (`execution-agent.ts:ExecutionAgent.executeSubtask`).
- Execution can only start from `APPROVED_FOR_EXECUTION`; a failed transition returns `invalid_plan` (`execution-agent.ts:ExecutionAgent.execute`).
- Intake rejects any issue that is not `OPEN`, is closed, lacks `ready-for-agent`, or carries a `REJECTION_LABELS` entry (`issue-intake-agent.ts:IssueIntakeAgent.intake`).
- Intake label checks are case-insensitive, and explicit `priority:*` / `complexity:*` labels outrank heuristic estimates (`issue-intake-agent.ts:IssueIntakeAgent.estimatePriority`, `issue-intake-agent.ts:IssueIntakeAgent.estimateComplexity`).
- Dependency detection deduplicates and sorts issue numbers ascending (`issue-intake-agent.ts:IssueIntakeAgent.detectDependencies`).
- Planning requires a valid issue number, a non-empty title, and at least one acceptance criterion (`planning-agent.ts:PlanningAgent.validate`).
- Planning emits one subtask per acceptance criterion plus an optional `step-0` setup subtask, distributes files round-robin, and chains each subtask to its predecessor (`planning-agent.ts:PlanningAgent.buildSubtasks`).
- Every generated plan sets `approvalRequired: true` and `estimatedCommits = subtasks.length + 1` (`planning-agent.ts:PlanningAgent.plan`).
- Derived test paths use the R6 subsystem map (`src/coordination/...`, `src/governance/...`, `src/agents/...`) rather than inventing a mirrored tree; already-test paths yield `null` (`planning-agent.ts:PlanningAgent.deriveTestFile`).
- Review rejects any plan whose `approvalRequired` is false or whose files touch `PROTECTED_PATHS` (critical finding) (`review-agent.ts:ReviewAgent.review`).
- Review verdict is `reject` for any critical finding, `changes_requested` for any major finding, otherwise `approve`; minor and nit findings alone do not block (`review-agent.ts:ReviewAgent.review`).
- Review treats `step-0` as exempt from the acceptance-criteria count and the test-coverage nit (`review-agent.ts:ReviewAgent.review`).
- Plan review uses the literal commit reference `"plan"` because no code exists yet (`review-agent.ts:ReviewAgent.review`).
- The PR agent has no decision authority: it only formats artifacts and invokes `gh pr create --draft --base main`, never merges (`pr-agent.ts:PRAgent.create`, `pr-agent.ts:PRAgent.createDraftPR`).
- PR titles strip leading non-alphanumeric decoration and truncate to 72 characters with an ellipsis (`pr-agent.ts:PRAgent.buildTitle`).
- A PR artifact always sets `draft: true` (`pr-agent.ts:PRAgent.prepare`).

## Side Effects

- Transitions the workflow state machine via `WorkflowCoordinator.transition` (`execution-agent.ts:ExecutionAgent.execute`, `issue-intake-agent.ts:IssueIntakeAgent.select`, `planning-agent.ts:PlanningAgent.execute`, `review-agent.ts:ReviewAgent.execute`, `pr-agent.ts:PRAgent.create`).
- Records evidence events: `subtask_started`, `test_failed`/`test_passed`, `commit_created`, `subtask_completed`, `execution_completed` (`execution-agent.ts:ExecutionAgent.executeSubtask`).
- Runs `execSync("gh issue view ... --json ...")` with a 15-second timeout to read issues (`issue-intake-agent.ts:IssueIntakeAgent.readIssue`).
- Writes files, creating parent directories recursively, through `defaultWriteFile` (`execution-agent.ts:defaultWriteFile`).
- Spawns `npx vitest run <files> --config vitest.config.mts` with a 60-second timeout and piped stdio (`execution-agent.ts:defaultRunTests`).
- Runs `git add -- <files>`, `git commit -m <message>`, and `git rev-parse HEAD` per successful subtask (`execution-agent.ts:defaultGitCommit`).
- Creates a temporary `/tmp/alix-pr-body-<timestamp>-<random>.md` file and deletes it in a `finally` block (`pr-agent.ts:PRAgent.createDraftPR`).
- Executes `gh pr create --draft --title ... --body-file ... --base main` and parses `/pull/<n>` from the resulting URL (`pr-agent.ts:PRAgent.createDraftPR`, `pr-agent.ts:PRAgent.parsePRNumber`).
- Uses `Date.now()` and `Math.random()` for the temporary PR body filename (`pr-agent.ts:PRAgent.createDraftPR`).
- Reads file existence through `existsSync` by default during planning (`planning-agent.ts:PlanningAgent` constructor).

## Verification

- Run: `pnpm test`
