# PRE-R024 — isolation qualification record

**Date:** 2026-10-23
**Verdict: 5 controls QUALIFIED, 2 PARTIAL, 1 UNQUALIFIED. Model-backed probes remain BLOCKED.**

**2026-10-28 requalification:** the original file-tool containment result was too broad. A committed shell-boundary probe demonstrates that `shell.run` can observe a sibling grader marker outside the declared workspace when only `cwd` constrains execution. Control 1 is therefore PARTIAL, not fully qualified. The new per-arm qualification runner executes the complete mandatory S0 negative set and requires an explicit replay class; that qualifies the control-8 mechanism, while actual future arms must still run it.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §13.1 (PRE-R024), §8 (P0-J)
**Spec:** [Experiment spec](harness-optimization-experiment-spec.md) §3
**Executable evidence:** `tests/security/pre-r024-isolation-qualification.vitest.ts` (19 tests)

## 1. What changed from "exists"

The spec's §3 table said six controls "exist" and two were unknown. "Exists" was a
claim about production code that nobody had driven with hostile input in one
place. This record replaces that claim with executable evidence — every qualified
row below is asserted by a test that fails if the control regresses.

Two of my own probes were wrong before the tests were right, and both are recorded
because they are the failure mode this exercise exists to catch:

- Passing a `WorkspacePathResolver` into `FileToolRouter`'s **second** constructor
  slot put it in `eventLog`, silently disabling protection. All three protected
  paths came back `WRITTEN`. Correct order is `(root, eventLog, sessionId,
  pathResolver)`.
- Calling `PolicyGate.evaluateToolCall` with the model-facing tool name
  (`alix_file_create`) instead of the executor id (`file.create`) skipped the
  owned-path rule entirely and returned `allow`.

Neither was a product defect. Both would have produced a *passing* qualification of
a control that was not actually exercised.

## 2. Control-by-control result

| # | Control | Result | Evidence |
|---|---|---|---|
| 1 | Sandbox / filesystem boundary | **PARTIAL — file tools qualified; process isolation failed** | File-tool lexical escape and outside-target symlink are rejected, and protected/sensitive paths are enforced. However `benchmark/evidence/pre-r024-shell-boundary-probe-2026-10-28.json` reproduces `shell.run` reading a sibling grader marker outside its `cwd` (`observation: REACHABLE`). `cwd` is not an OS sandbox. |
| 2 | Restricted egress incl. shell clients | **QUALIFIED** | 11 private/loopback/link-local/CGNAT/IPv6 literals rejected; a public name resolving to a private address rejected; inet_aton obfuscations (`0x7f.0.0.1`, `2130706433`, `017700000001`) normalized to `127.0.0.1`; allowlist and scheme enforcement; 7 shell client invocations (`curl`/`wget`/`nc`/`ssh`/`ping`, including absolute and `sudo` paths) rejected; ordinary `echo` still allowed. |
| 3 | No hidden rubrics | **UNQUALIFIED** | Rubric unreachability must be proved per benchmark. The shell-boundary probe now establishes a concrete local blocker: placing a grader outside the workspace is insufficient because `shell.run` can reach sibling/parent filesystem paths. Public upstream rubric exposure remains an additional contamination risk. |
| 4 | Secret controls | **QUALIFIED** | `getApiKey` returns the store value and ignores a planted `OPENAI_API_KEY` env marker. Tested behaviourally, not by string-matching source. |
| 5 | Prompt-injection posture | **QUALIFIED (with a stated limit)** | Tool output is delivered verbatim as data under the result envelope. The control is the envelope plus the prompt contract; content is deliberately not laundered. A behavioural injection test against a live model is not possible without spend and is not claimed. |
| 6 | Side-effect policy | **QUALIFIED** | Protected-path writes (`.env`, `.git/config`, `secrets/token`) denied through the real router while an ordinary file writes; a denied command is a hard deny under `bypass`; a blanket `file.write: allow` cannot widen a declared owned scope (denies via `owned-path-rule`, allows the owned path). |
| 7 | Replay | **PARTIAL** | Provenance distinguishes table replay, arithmetic replay and scenario reproduction. `pre-r024-arm-isolation-check.mjs` now refuses an arm without an explicit replay class and records source commit/tree, but no model-backed arm has yet demonstrated full scenario reproducibility from its recorded evidence. |
| 8 | Negative tests per arm | **QUALIFIED mechanism; mandatory on every future arm** | `benchmark/evidence/pre-r024-arm-isolation-check.mjs` builds the exact source and runs all four required S0 suites before an arm may proceed. The committed qualification-control record passed 25/25 Node negatives plus 19/19 worker-port negatives at `b52c77cf`. A future arm that does not carry a passing record is inadmissible. |

## 3. Consequence

PRE-R024 is **not cleared**. The remaining blockers are now more precise:

1. **OS-level process/filesystem isolation is missing for `shell.run`.** File-tool path controls are real, but a spawned shell is only given a working directory. The committed probe observes `REACHABLE` for a sibling grader marker. A model-backed probe that exposes `shell.run` therefore cannot claim the grader/rubric is unreachable merely because it lives outside the workspace.
2. **Rubric containment must still be qualified per benchmark.** Even after process isolation exists, the selected benchmark must prove its grader/answers are inaccessible through every offered tool and allowed network path.
3. **Replay is only structurally enforced so far.** The runner requires a replay-class declaration, but a real model-backed arm has not yet demonstrated reconstruction from its evidence.

The S0-negative runner obligation is no longer an unknown: the qualification-control arm ran the full set successfully. That mechanism is now mandatory for every future arm.

## 4. What would clear it

- Add or select a process-isolation profile that makes filesystem paths outside the probe root unreachable to every offered process-capable tool; alternatively remove those tools and prove no equivalent escape path remains.
- Choose a benchmark and record, per benchmark, how rubric unreachability was verified across filesystem, network and tool surfaces.
- Run `benchmark/evidence/pre-r024-arm-isolation-check.mjs` for every arm; a missing/failing record blocks scoring.
- Demonstrate scenario reconstruction for at least the model-backed arm class actually proposed, not merely a replay-class label.

Until those exist, any probe result would be inadmissible under §3 regardless of
its numbers.
