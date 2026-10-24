# PRE-R024 — isolation qualification record

**Date:** 2026-10-23
**Verdict: 6 of 8 controls QUALIFIED by executable test. 2 remain UNQUALIFIED
(rubric containment, replay). Model-backed probes remain BLOCKED.**
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
| 1 | Sandbox / filesystem boundary | **QUALIFIED** | Lexical escape rejected; symlink with an outside canonical target rejected by `isCanonicalInWorkspace` while `isInWorkspace` still reports inside (proving the canonical check is load-bearing); protected/sensitive paths flagged inside the workspace. |
| 2 | Restricted egress incl. shell clients | **QUALIFIED** | 11 private/loopback/link-local/CGNAT/IPv6 literals rejected; a public name resolving to a private address rejected; inet_aton obfuscations (`0x7f.0.0.1`, `2130706433`, `017700000001`) normalized to `127.0.0.1`; allowlist and scheme enforcement; 7 shell client invocations (`curl`/`wget`/`nc`/`ssh`/`ping`, including absolute and `sudo` paths) rejected; ordinary `echo` still allowed. |
| 3 | No hidden rubrics | **UNQUALIFIED** | No repository guard can make a public benchmark's rubric unreachable. Asserted as unqualified, not omitted. This is the hard block on model-backed probes. |
| 4 | Secret controls | **QUALIFIED** | `getApiKey` returns the store value and ignores a planted `OPENAI_API_KEY` env marker. Tested behaviourally, not by string-matching source. |
| 5 | Prompt-injection posture | **QUALIFIED (with a stated limit)** | Tool output is delivered verbatim as data under the result envelope. The control is the envelope plus the prompt contract; content is deliberately not laundered. A behavioural injection test against a live model is not possible without spend and is not claimed. |
| 6 | Side-effect policy | **QUALIFIED** | Protected-path writes (`.env`, `.git/config`, `secrets/token`) denied through the real router while an ordinary file writes; a denied command is a hard deny under `bypass`; a blanket `file.write: allow` cannot widen a declared owned scope (denies via `owned-path-rule`, allows the owned path). |
| 7 | Replay | **UNQUALIFIED (partial)** | Provenance still distinguishes table replay, arithmetic replay and scenario reproduction. A probe arm must declare its class; none has. |
| 8 | Negative tests per arm | **PARTIAL** | The four S0 suites exist and are addressable (`legacy-approval-single-use`, `approval-crash-recovery`, `worker-approval-port`, `r15-authorization`). Wiring them to actually RUN per arm is a probe-runner obligation that no probe has yet discharged. |

## 3. Consequence

PRE-R024 is **not cleared**. Two rows block it, for different reasons:

1. **Rubric containment is not this repo's to qualify.** It is a property of the
   chosen upstream benchmark. No amount of local test writing closes it; it closes
   by choosing a benchmark whose graders are unreachable, and recording how that
   was verified.
2. **Per-arm negative execution is a runner obligation**, unexercised because no
   probe exists.

The honest position: six controls are now evidenced rather than asserted, which
narrows the blocker to two named items instead of an eight-row table of
uncertainty. It does not make a model-backed probe admissible.

## 4. What would clear it

- Choose a benchmark and record, per benchmark, how rubric unreachability was
  verified (network policy plus a fetched-grader negative test).
- Build the per-arm runner that invokes the four S0 suites before scoring any arm.
- Record the replay class of every arm's evidence in its manifest.

Until those exist, any probe result would be inadmissible under §3 regardless of
its numbers.
