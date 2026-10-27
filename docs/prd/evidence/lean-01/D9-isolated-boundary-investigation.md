# D9 isolated run — authorization and worker-result boundary

2026-10-26. Evidence-only investigation of the existing isolated run; no new run, model request, test, approval decision or production-code change. **D9 and LEAN-G01 remain BLOCKED.**

## Identified case

- Workspace: `/tmp/alix-d9-configfix-KzqJgE/workspace`
- Run: `coord_36518aec-0ae3-4099-b21b-b886a8f19849`
- Session: `coord_1793022604682`
- Worker: `worker_6e4f9e01-dc97-4573-9f91-621911466ff4`; canonical worker agent `alix#1`; recorded attempt `1`, maximum `3`.
- Goal: create `docs/d9-receipt.txt` containing `D9-APPROVED`.

[Retained CLI output, exported scripted trace and receipt](D9-isolated-boundary-evidence.json) preserve the evidence used below. Runtime state was queried through the compiled ALiX CLI, not by reading protected `.alix/**` files. The previously blocked source inspection was not retried with an alternative command, graph content lookup or escalation. The available tool inventory exposed no direct ALiX state-query connector; standard CLI state commands were used.

## Observations

| Boundary | Recorded evidence | What it establishes |
|---|---|---|
| Initial worker dispatch | `approval_1793022605302_ceq4n`, capability `filesystem.write`, status `consumed`; operator reason `isolated D9 dispatch qualification` | A dispatch grant was consumed; it does not by itself establish approval of the tool invocation |
| Dispatch binding | `2c711ee5c2c64b7710967964e5cbe6816b49d9820f8035765eaa8ad050dbc113` | Exact recorded initial binding, associated with this worker |
| Owned scope | Released exclusive-write lease `own_637bf477`, worker agent `alix#1`, task ID matching this worker, exact receipt path; acquired `2026-10-26T13:51:00.661Z` | This worker held the intended scope; a lease alone does not identify the policy rule that allowed the tool |
| Worker provider | Exported trace: `provider: scripted-mock`, invocation step 0 `tool`, step 1 `text` at `13:51:07.139Z` / `13:51:07.158Z` | The worker scenario ran its file-create/text sequence |
| Tool lifecycle | Session runtime projection: `tool.started` → `file.created` → `tool.completed` for `filesystem.write` around `13:51:07Z`; receipt content is exactly `D9-APPROVED` | The file mutation completed; this is stronger than the artifact's existence alone, but the projection omits the full decision payload |
| Inner session result | `task.done`, `graph.completed`, `session.ended` with `completed` | The inner worker task loop completed; this is not the outer objective review verdict |
| Worker result | `outcome: failure`, `failureKind: execution_error`, error quoted below | The outer worker review rejected the result because it did not receive a verdict |
| Subsequent dispatch | `approval_1793022668107_rf1xy`, capability `filesystem.write`, status `pending`, created `2026-10-26T13:51:08.107Z` | Another dispatch authorization was requested after the review failure |
| Subsequent binding | `e90effc3c7b046e779bc7a797cf99e0aaf9bbbd478819824b00d64d8c1541d57` | It is a different binding, not evidence that the original tool was waiting for approval |
| Current run | `blocked`; worker `blocked`, `blockReason: approval_required`; aggregate not yet generated, `verification: unverified` | The run has not succeeded and must not be promoted |

The persisted worker error is:

```text
Objective review: Reviewer requested tools instead of returning a verdict
Changed: docs/d9-receipt.txt
```

The exported trace adds a useful clue: after the worker's two invocation-scoped steps, it records a **global step 0 of kind `tool` at `2026-10-26T13:51:07.308Z`**. That timing is consistent with an objective-review call receiving the worker scenario's tool step rather than a review verdict. This is an inference: the trace does not label that call as the reviewer or retain its request/response envelope.

## Disposition of the three hypotheses

| Hypothesis | Disposition |
|---|---|
| Tool executed without the intended tool-level approval | **Unresolved.** The queried approval list contains the consumed dispatch grant and the subsequent pending dispatch grant, but no separate tool grant. That is not proof of an authorization bypass. |
| Tool was allowed through another authorization path | **Unresolved.** The scope lease and successful tool events are consistent with an owned-scope path, but the matched policy rule/decision record is missing. No rule ID is asserted from source memory or a guessed code path. |
| Successful mutation was followed by a worker-result verification failure | **Established.** The mutation completed, then the persisted outer result reports the reviewer protocol error. Whether the reviewer was wrong is not established: rejecting a tool call in place of a verdict can be correct fail-closed behavior. |

The immediate retry trigger is therefore the **worker-result review boundary**, not a demonstrated failure to execute the file write. Evidence points toward checking the scripted review invocation/response routing first. Do not weaken the reviewer to accept a file's existence, accept tool calls as verdicts, approve the second dispatch automatically, or alter PolicyGate/tool authorization based on the file alone.

## Missing authorization evidence

The required full tool-level record would identify the tool-call/invocation ID, exact arguments hash, canonical agent, owned scope, policy result and matched rule ID, plus any tool-specific approval ID and consumption receipt. Available observations were:

- `coordination approvals <run> --json` exposes dispatch records and binding keys, not complete tool-decision payloads.
- `runtime events --session <session> --limit 100 --json` returns the formatted lifecycle projection; `--json` does not make that surface return full event payloads.
- `coordination events <run> --json` returned `[]`.
- Filtered runtime events for `authorization` and `policy` returned `No matching events.`
- `audit by-approval <initial-dispatch-id>` returned `No records for approval.`; `audit list --limit 25` returned `No audit records.`

These are interface/capture limits, not proof that authorization never ran. An authorized full-decision export/read interface was requested from the operator. No protected files, credentials or blocked source paths were opened to fill the gap.

One projection discrepancy matters: `runtime events` labels the initial consumed approval as `approval.denied`. The dedicated approval CLI reports it as **consumed**. This investigation uses the dedicated record status and does not treat that projection label as an operator denial.

`coordination results <run> --json` was also queried. It returned a derived inventory with one failed worker result and a new observation-time `generatedAt`; `complete: true` describes that returned inventory, not successful execution. Its source state remained blocked with source update time `13:51:08.273Z`. No `tick`, `resume`, `approve`, `deny`, `cancel` or worker execution was invoked during this investigation.

## Reproduction of the reads

Commands were run with the isolated workspace as cwd using the compiled CLI at `/home/babasola/Projects/ALiX/dist/src/cli.js`:

```sh
node <cli> coordination list
node <cli> coordination status coord_36518aec-0ae3-4099-b21b-b886a8f19849 --json
node <cli> coordination workers coord_36518aec-0ae3-4099-b21b-b886a8f19849 --json
node <cli> coordination approvals coord_36518aec-0ae3-4099-b21b-b886a8f19849 --json
node <cli> coordination ownership coord_36518aec-0ae3-4099-b21b-b886a8f19849 --json
node <cli> coordination results coord_36518aec-0ae3-4099-b21b-b886a8f19849 --json
node <cli> runtime events --session coord_1793022604682 --limit 100 --json
node <cli> audit by-approval approval_1793022605302_ceq4n
```

All evidence-producing reads above exited 0. CLI discovery also showed that `coordination --help` and `coordination show` are unsupported (exit 1); the supported `status`, `workers`, `approvals`, `ownership`, `events` and `results` interfaces were then used. No safety denial was retried with another command. A shell startup warning about a read-only Starship cache was avoided for later commands by using a non-login shell; it was not a denial of state/source access.

## Closeout

Changes are limited to this report, its retained evidence JSON and the route-parity evidence pointer. No source or test was edited; no tests, build or TypeScript checks were run or claimed in this investigation. JSON/read-back/whitespace checks apply to these documentation artifacts. Prior 469-test implementation evidence remains historical and is not a successful rerun of this isolated case.

DOX pass: root and documentation contracts were re-read. AGENTS.md files and child indexes intentionally remain unchanged because this records observations, not a new operating contract. Existing worktree changes were preserved. No commit, push, merge, real-model request, policy weakening or safety bypass occurred.

**D9 remains BLOCKED. LEAN-G01 remains BLOCKED and independently unreviewed.** The reviewer protocol failure is localized; the actual tool-authorization path still needs an authorized decision export before any authorization change is justified.


## Subsequent controlled reproduction — 2026-10-26

[The paired actual-daemon verification](D9-review-routing-daemon-verification.md) captures the previously missing decision for new frozen fixtures: `owned-path-rule` allowed the receipt tool. A baseline reproduces the reviewer-tools rejection; correcting only the global reviewer script yields attempt-1 completion, one mutation and no new approval. The production reviewer correctly rejected the malformed fixture; no authorization policy was changed. This follow-up does not invent a raw decision for the historical run. The corrected run still reports completion verification unverified, so D9/LEAN-G01 remain blocked.
