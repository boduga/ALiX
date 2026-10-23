# Harness PRD closeout handoff

Date: 2026-10-23 UTC  
Workspace: `/home/babasola/Projects/ALiX`  
Base commit: `64f2fdafb558a6067989d0012e5c480f28c17a79` (`docs(harness): reconcile closure evidence`)

## Current decision

The PRE-2.0 Harness PRD is **not closed**. Gate B and Q13 remain HOLD. No API spend, ablations, publication, or operator signatures were authorized or performed. The earlier audit correction remains binding: only 7/12 successes are verified, at $0.067149 per verified success; capability mix is not evidence of a capability gap; strata 4/5 each have one valid case.

This pass prepared several offline evidence tools and designs. They narrow specific gaps but do not qualify the harness or change any gate verdict.

## Added or changed in the current uncommitted workspace

- `benchmark/evidence/config-consumer-inventory.mjs` and its test provide a compiler-backed, read-only census of config-field references. The retained snapshot scans 1,455 source files and reports 30 schema-bound references, 217 other declared-field references, 54 unresolved named-field references, and one dynamic config-key reference. It is a static review aid, not proof that external consumers are absent or that GitNexus coverage is complete.
- `benchmark/evidence/review-trial.mjs`, its test, and `docs/harness-review-evaluation-protocol.md` prepare a no-model scorer and protocol for future human review. There are no human trial observations; the public fixture is training material, not a holdout.
- `benchmark/evidence/coordination/four-worker-scripted.mjs` and its test exercise four workers through the real coordination kernel with deterministic worker executors. This can establish scripted kernel mechanics only. It does not establish model quality, independent security qualification, or paid four-model performance. The retained snapshot is `benchmark/evidence/coordination/four-worker-scripted.json`.
- `benchmark/evidence/harness2-reproduction.json` records a fresh credential-free run against the pinned Harness² source: 2/2 tasks, 28 executions, 32 editor calls, exit 0. The existing Python environment was reused, so fresh-install qualification remains open.
- `docs/harness-shim-catalog.md` inventories harness shims, owners, triggers, tests, and retirement criteria. Runtime usage is not measured. Before any future HC01 ablation, preserve the mandatory `alix_coordination_run` routing rule in both arms; removing the whole prompt section would invalidate that comparison.
- `docs/harness-cutover-plan.md` now describes three concrete, design-only migration packages: runtime reader parity, output-interface retirement, and historical JSON migration. Gate D remains unimplemented and unapproved.
- `docs/harness2-source-review.md` records the fresh reproduction and its limits.
- `benchmark/AGENTS.md` and `docs/AGENTS.md` index the new evidence tools and durable harness documents.

The standalone offline evidence command passes 7 tests on a fresh build:

```sh
node --test benchmark/evidence/config-consumer-inventory.test.mjs benchmark/evidence/review-trial.test.mjs benchmark/evidence/coordination/four-worker-scripted.test.mjs
```

The earlier `pnpm build` failure was not a fixture-validity signal: `tests/run/task-loop-shed-tool.vitest.ts:248` cast a partial object straight to `ToolExecutor` (TS2352), which is a pre-existing type error whenever the test project is compiled, independent of the four-worker fixture. It now casts through `unknown`, matching the sibling case in the same file. `pnpm build` succeeds after the change.

With that build the four-worker fixture produced a retained result at `benchmark/evidence/coordination/four-worker-scripted.json`: four distinct worker IDs and agent IDs, per-worker owned-path leases, one denied out-of-scope write, dependency results for the fourth worker, and completion `{execution: completed, aggregation: generated, outcome: success, verification: verified}`. Recorded `model: null`, `costUSD: null`, `verifiedPaidBaselineSuccesses: 0`. This is scripted-kernel mechanics evidence and does not move Gate B or Q13.

`pnpm check:dox` requires a resolvable committed `--head`, so it could not run before this handoff was committed (`cannot resolve --head 'HEAD'`). After commit it runs, but its default `--base main` self-compares when the work lands directly on `main` and reports `0 AGENTS.md file(s) changed` — the degenerate pass the root contract warns about, not a result. The meaningful invocation is explicit:

```sh
node scripts/check-dox-claims.mjs --base 64f2fdafb558a6067989d0012e5c480f28c17a79
```

That reports 3 claim tokens across 1 changed `AGENTS.md`, all resolving to branch content. No checker behavior was changed.

## Still required to close

1. Reconcile and qualify the paid baseline: six strata remain n=1, three cost files remain unproduced, delegate-model attribution is incomplete, and the ambiguous `forbidden-path-write` records lack execution outcome evidence. Recovered delegate sweeps contain summary fields only, with no run ID, execution status, reason, or final summary; they cannot distinguish honest refusal from a false claim. Do not infer either result.
2. Obtain the missing durable source inputs and provenance, then rerun only the measurements explicitly approved by the operator. The earlier 5/9 delegate cases could not measure a real model; do not treat those scripted-specific cases as model capability evidence.
3. Complete migration implementation and evidence for Gate D. The new cutover plan is design preparation only.
4. Run and independently qualify the required real-model baseline/ablations only after explicit authorization. No ablation proposal or run is authorized by this handoff.
5. Collect actual human review observations using independent holdout items. The scorer is ready for controlled use; human n=0.
6. Obtain independent reviewer qualification and the operator signature required by Gate B/Q13. These cannot be supplied by this agent.
7. Resolve the HC01 comparison design so mandatory coordination routing remains identical across arms; measure actual shim use before making usage claims.
8. Reconcile the remaining PRD acceptance rows against source and evidence, retain all qualified raw inputs, then update the primary PRD and readiness record. Do not convert preparation artifacts into a PASS.

## Tooling and workspace cautions

- GitNexus was stale/corrupt during this work: impact results returned `UNKNOWN` or unrelated symbols, and prior change detection attributed a critical risk to an empty function identity. The build fix reproduced this: `detect-changes --scope all` reported `risk level: critical` with 1 changed symbol named `execute` and 1,231 affected flows, while the actual diff is one `as unknown as` in a test-local object literal whose function is never exported. Treat graph qualification as unresolved; source searches were used only to confirm literal references, not as a substitute claim of complete graph coverage.
- Do not read protected `.alix` state or credential files directly. Use supported ALiX state tools/CLI if recovering further run evidence.
- Current branch has uncommitted files listed by `git status --short`; nothing from this pass has been committed or pushed. No production runtime files were intentionally changed. The benchmark/docs DOX indexes were updated for the new durable artifacts.

## Next operator-facing decision

The remaining work splits into offline evidence recovery and experiments requiring explicit authorization. Preserve the current no-spend/no-ablation boundary until the operator chooses a scope. The minimum no-spend path is: fix the build (done), retain the scripted four-worker result (done), update the acceptance matrix and owning DOX indexes (done), and continue source-artifact recovery (open). Full PRD closure still requires the human, independent, migration, paid-measurement, and signature gates above.
