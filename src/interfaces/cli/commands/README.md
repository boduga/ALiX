# CLI Command Handlers

## Overview

Entry points for every `alix <command>` surface, loaded lazily by the root
dispatcher's `COMMAND_ROUTER` or by explicit `command ===` branches in
`src/cli.ts`. Individual modules own argument parsing, terminal rendering, and
exit codes for one command family; they delegate policy, storage, and execution
to the owning subsystems rather than re-implementing them. Six child directories
own the larger command families and are re-exported through thin barrels
(`adaptation.ts`, `decision.ts`, `governance.ts`, `jev.ts`, `security.ts`) so
public import paths stay stable.

## Interface

- `handler(args)` for `alix run`: parses `RunArgs`, matches a discovered skill, runs a headless agent session, and maps terminal reasons to exit codes [run.ts:handler]
- `handleCoordination(args)` dispatches `run|tick|resume|status|results|cancel|reconcile|list|inspect|watch|workers|approvals|ownership|events|conflicts|conflict-resolve|conflict-dismiss|conflict-accept-divergence` [coordination.ts:handleCoordination]
- `buildCoordinationPolicyGate(cwd, config)` builds the gate on the project-scoped approval store [coordination.ts:buildCoordinationPolicyGate]
- `resumeCoordinationExecution(scheduler, runId)` reconciles a persisted run, then runs until idle [coordination.ts:resumeCoordinationExecution]
- `readFlag(args, flag)` accepts both `--flag value` and `--flag=value` [coordination.ts:readFlag]
- `runTui(opts)` and `TuiOptions` (session name/mode, daemon mode, theme, `RendererId`) [tui.ts:runTui] [tui.ts:TuiOptions]
- `runInit(cwd, argv, deps)` and `InitDependencies` for `alix init` [init.ts:runInit] [init.ts:InitDependencies]
- Config lifecycle: `handleConfigSetKey`, `handleConfigGet`, `handleConfigSet`, `handleConfigDelete`, `handleConfigHistory`, `handleConfigProvenance`, `handleConfigRollback`, `handleConfigShow` [config.ts:handleConfigRollback] [config.ts:handleConfigShow]
- Effects journal: `parseEffectsArgs`, `handleEffectsList`, `handleEffectsRequest`, `handleEffectsReconcile`, `handleEffectsRoot` [effects.ts:parseEffectsArgs] [effects.ts:handleEffectsRoot]
- Evals: `handleEvalsCommand`, `handleEvalsRun`, `handleEvalsRunDataset`, `shellQuote` [evals.ts:handleEvalsCommand] [evals.ts:shellQuote]
- Approvals: `handleApproval` with `list|show|approve|deny|revoke|expire|project` [approval.ts:handleApproval]
- Run ledger: `handleRunsCommand` with `list|show|append` [runs.ts:handleRunsCommand]
- Scheduled jobs: `handleSchedule` with `list|show|run-now|revoke` [schedule.ts:handleSchedule]
- Plan lifecycle: `runPlan`, `handler`, `listPlans` [plan.ts:runPlan] [plan.ts:listPlans]; `runApply`, `handler` [apply.ts:runApply]; `runReview`, `handler` [review.ts:runReview]
- Recovery: `cmdScan`, `cmdInspect`, `cmdRepair`, `cmdVerify` [recover.ts:cmdScan] [recover.ts:cmdRepair]
- Model selection: `handleModelsCommand` over `doctor|fit|list-profiles|show-profile|apply-profile|install-profile|resolve|set-default|set-tier|free|routing` [models.ts:handleModelsCommand]
- Diagnostics: `handleObservability` over `health|metrics|state|trends|alerts|export|diagnostics` [observability.ts:handleObservability]; `handleOwnershipCommand` over `list|show|history|acquire|release|renew|conflicts|prune` [ownership.ts:handleOwnershipCommand]
- Capability namespace: `handleCapabilityCommand(args, deps)` delegates to `proposals|measure|consolidate|approve|reject` [capability.ts:handleCapabilityCommand]
- Issue execution: `handleIssueRunCommand` with `--dry-run` and `--proposal` modes [issue-run-handler.ts:handleIssueRunCommand] [issue-run-handler.ts:buildIssueRunOptions]
- Compatibility barrels: `handleAdaptationCommand`/`selectApplier` [adaptation.ts:handleAdaptationCommand], `handleDecisionCommand` [decision.ts:handleDecisionCommand], `handleGovernanceCommand` plus audit formatters [governance.ts:handleGovernanceCommand], `handleJevCommand` [jev.ts:handleJevCommand], and the security re-exports [security.ts:handleAuditVerify]
- Child command families: [./adaptation/README.md](./adaptation/README.md), [./decision/README.md](./decision/README.md), [./governance/README.md](./governance/README.md), [./jev/README.md](./jev/README.md), [./security/README.md](./security/README.md), [./skills/README.md](./skills/README.md)

## Invariants

- Every command module returns or exits with an explicit status; unknown subcommands print usage and `process.exit(1)` (or return `2` for capability) rather than falling through [coordination.ts:handleCoordination] [capability.ts:handleCapabilityCommand]
- Failed `alix run` terminal reasons are exactly `completed_unverified`, `max_repairs`, `max_iterations`; `rejected_scope_expansion` maps to `EXIT_CODES.REJECTED_SCOPE_EXPANSION` and context-budget overflow exits 1 [run.ts:handler]
- `alix run` loads config best-effort: an unreachable credential store warns and falls back to flags/defaults instead of aborting before the first turn [run.ts:handler]
- `--propose` can create a proposal only when the run carries a skill match; generic tasks must use `--intent` [run.ts:handler]
- `buildCoordinationPolicyGate` fails closed when the project approval store cannot be loaded; it never constructs a gate without durable approval authority [coordination.ts:buildCoordinationPolicyGate]
- Foreground coordination installs `SIGINT`/`SIGTERM` handlers that cancel the run before exiting 130, and removes them in `finally` [coordination.ts:handleCoordination]
- Coordination daemon mode warns when no daemon is running but leaves the run pending instead of failing [coordination.ts:handleCoordination]
- Only one renderer owns the terminal; OpenTUI requires an interactive TTY and throws otherwise [tui.ts:runTui]
- The TUI tolerates a missing config by falling back to defaults, and each of the three projections owns an independent checkpoint store [tui.ts:runTui]
- `runInit` writes only canonical `models` via `withoutDerivedModelProjections`; derived projections are rebuilt by the loader [init.ts:runInit]
- `handleConfigRollback` requires both `--force` and `--reason` [config.ts:handleConfigRollback]; `handleConfigShow` redacts API keys unless `--reveal-secrets` is passed [config.ts:handleConfigShow]
- Effects commands add no authorization semantics: they rebuild the original `ToolCallRequest` and delegate every authority/evidence/binding decision to the effect journal; unresolved states `claimed`, `started_unknown`, and `terminal_failure` are never cleared by age or PID [effects.ts:parseEffectsArgs] [effects.ts:handleEffectsRequest]
- `alix evals` defaults to the deterministic `scripted-mock` provider; any other provider requires an explicit `--model`, and `--baseline-scores` gates against a stored baseline [evals.ts:handleEvalsRun] [evals.ts:handleEvalsRunDataset]
- `alix approval` reads one inbox through `openApprovalStores`; `project` only runs the remote-decision projection [approval.ts:handleApproval]
- `alix apply` refuses a plan whose status is already `applied` and requires interactive confirmation before mutating files [apply.ts:runApply]
- `alix review` writes only the plan status (`approved`/`rejected`) after an explicit prompt answer [review.ts:runReview]
- `alix recovery scan` is read-only; `repair` is dry-run by default and requires confirmation or `--yes` [recover.ts:cmdScan] [recover.ts:cmdRepair]
- `--dry-run` and `--proposal` both set `readOnly` for issue runs; the default mode may execute tools but still opens no branch or PR [issue-run-handler.ts:buildIssueRunOptions]
- `alix schedule` manages only jobs already approved and active; `run-now` creates a daemon task record and increments run counters [schedule.ts:handleSchedule]

## Side Effects

- Session state is written under `.alix/sessions/<id>` by the TUI and issue-run handlers [tui.ts:runTui] [issue-run-handler.ts:handleIssueRunCommand]
- `.alix/config.json` and `AGENTS.md` are created by `alix init`, which may also run `git init --initial-branch=main` and append `.alix/` to `.gitignore` [init.ts:runInit]
- Plans are stored as YAML under `.alix/plans`, and `apply` mutates workspace files and rewrites the plan status [plan.ts:runPlan] [apply.ts:runApply]
- The run ledger persists under `.alix/governance` through `FileLedgerStore` [runs.ts:handleRunsCommand]
- `alix run --intent` appends to `~/.alix/execution/intents`; `--propose` writes proposals under `<cwd>/.alix/adaptation/proposals` [run.ts:handler]
- Approval, ownership, and effect-journal commands mutate their durable stores; approval decisions are recorded through the approval store [approval.ts:handleApproval] [ownership.ts:handleOwnershipCommand] [effects.ts:handleEffectsReconcile]
- Model, eval, issue-run, and marketplace commands make network/provider calls [models.ts:handleModelsCommand] [evals.ts:handleEvalsRun] [issue-run-handler.ts:handleIssueRunCommand]
- Long-running commands register signal handlers and terminate the process (`process.exit`) or set `process.exitCode` on findings [coordination.ts:handleCoordination] [recover.ts:cmdScan]

## Verification

- Run: `pnpm test`
