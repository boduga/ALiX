# PRE-R024 isolation requalification — 2026-10-28

**Verdict: PARTIAL / HOLD. Model-backed Harness² probes remain inadmissible.**

## Evidence delta

At source commit `b52c77cf8b87ee25b8b1daa22bc610850709d974` two committed qualification probes replace the earlier broad "workspace containment" assumption with executable evidence.

### Per-arm S0 mechanism — PASS

`benchmark/evidence/pre-r024-arm-isolation-check.mjs` requires an `armId` and explicit replay class, records source commit/tree, builds the exact source, and executes the mandatory negative suites before an arm can be scored.

Qualification-control result:

- build: PASS;
- Node negatives: 25/25 PASS (`legacy-approval-single-use`, `approval-crash-recovery`, `r15-authorization`);
- worker approval port: 19/19 PASS;
- combined mandatory negatives: 44/44 PASS;
- replay class: `scenario-reproduction`;
- tracked source dirty state: false.

Evidence: `benchmark/evidence/pre-r024-arm-isolation-check-2026-10-28.json`.

This qualifies the **control-8 mechanism**. It does not grandfather a future arm: every future arm must carry its own passing record.

### Shell/process boundary — FAIL

`benchmark/evidence/pre-r024-shell-boundary-probe.mjs` creates a temporary workspace and a sibling grader marker, then invokes ALiX `shell.run`/`runCommand` with the workspace as `cwd`.

Observed command:

```text
test -r ../grader-marker.txt && echo REACHABLE || echo BLOCKED
```

Observed result:

```text
REACHABLE
```

The child command itself exited successfully. Therefore `cwd` is not an OS filesystem sandbox: a process-capable tool can observe a sibling path outside the declared workspace. File-tool `WorkspacePathResolver` controls remain useful and tested, but they do not establish process isolation.

Evidence: `benchmark/evidence/pre-r024-shell-boundary-probe-2026-10-28.json`.

## Control disposition

| Control | Requalified disposition |
|---|---|
| 1 Sandbox / filesystem | **PARTIAL** — file tools qualified; process isolation fails |
| 2 Restricted egress | **QUALIFIED** under existing adversarial tests |
| 3 No hidden rubrics | **UNQUALIFIED** — selected benchmark grader must be unreachable; current shell boundary defeats filesystem-only separation |
| 4 Secret controls | **QUALIFIED** under existing adversarial test |
| 5 Prompt-injection posture | **QUALIFIED with stated content-as-data limit** |
| 6 Side-effect policy | **QUALIFIED** under existing authorization/path negatives |
| 7 Replay | **PARTIAL** — class/source pin enforced; no model-backed arm reconstruction yet |
| 8 Negative tests per arm | **QUALIFIED mechanism** — mandatory runner passes 44/44; every future arm must execute it |

## Independent agent review

A first small-model review challenged the control-8 statement because the control numbering was not explicit in its prompt; that challenge was traced to review ambiguity rather than missing evidence. A second independent local model (`granite3-moe:latest`, temperature 0) received the explicit eight-control mapping and the frozen facts above. It concluded that the control-8 mechanism qualification is accurate, that future arms still have to execute it, and that PRE-R024 must remain PARTIAL/HOLD until OS isolation, per-benchmark rubric unreachability, and model-arm replay are proved. It identified no factual overclaim in that scoped verdict.

This is an agent review of evidence framing, not Gate E security clearance.

## What remains

PRE-R024 can move beyond HOLD only after all of the following are evidenced for the proposed model-backed probe profile:

1. process-capable tools cannot access filesystem content outside the isolated probe root (or are removed from the offered surface with equivalent escape paths disproved);
2. the selected benchmark's grader/answers are unreachable through filesystem, network and every offered tool surface;
3. a model-backed arm demonstrates reconstruction/replay from its recorded evidence;
4. that arm carries a passing per-arm S0 qualification record.

No model-backed Harness² probe was executed as part of this requalification.
