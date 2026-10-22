# Harness 429 diagnosis: requested output budget

Gate B and publication remain HOLD. Current default model and credentials were
not changed.

## Controlled result

The failed agent request was captured through the provider fetch seam without
sending it: 20 tools, two messages, approximately 29 KB, streaming enabled,
`max_tokens: 32768`. Credentials and full prompts are not part of the committed
diagnostic artifact.

Same tiny prompt, same model and endpoint, sequential requests:

| Requested max tokens | HTTP result | Actual usage |
|---|---|---|
| 128 | 200 | 37 input / 29 output |
| 32768 | 429 `quota_exceeded` | unknown |
| 128 | 200 | 37 input / 15 output |

The full captured request also succeeded when ONLY `max_tokens` was changed to
2048: HTTP 200, valid `alix_file_read`, 7212 input / 127 output tokens. The first
full replay reached a successful SSE response, but the diagnostic initially tried
to decode it as one JSON document; a corrected SSE-aware replay captured usage.

This supports output-budget-dependent quota admission for this account/model at
measurement time. It disproves the earlier blanket explanation that the account
could not serve any full agent request. It does not establish the vendor's exact
reservation formula or account limits; no rate-limit/reset headers were returned.

Evidence: `benchmark/evidence/cost/output-budget-admission.json`. Diagnostic
responses are not successful baseline objectives and are not cost qualification.

Vendor Token Plan page states that API keys share account RPM/TPM limits:
[Intern InkStone Token Plan](https://discovery.intern-ai.org.cn/token-plan/home).
The experiment, rather than that general statement, establishes the budget effect.

## Explicit workaround

Positive and restart harnesses accept `--output-cap N`, a positive safe integer.
It changes only the temporary workspace's context output cap and is recorded in
raw results. Omission keeps existing behavior. It neither changes the user's
stored default model nor silently retries a 429 with a different budget/model.

```bash
node benchmark/evidence/cost/run-positive-cases.mjs --output-cap 2048 --output <raw.json>
node benchmark/evidence/coordination/run-restart-metered.mjs --output-cap 2048 --kill-on-running --out <raw.json>
```

Restart fault injection can wait for a persisted running worker before SIGKILL.
Final usage reads the cumulative event log once; pre-kill usage is not added again.

## End-to-end follow-up

At cap 2048, the two-file real case made three successful calls (22354 input /
796 output tokens), wrote both correct artifacts, then received another 429 before
terminal completion. The next mixed-policy case received 429 before tools. Neither
qualifies as a successful priced baseline. Lowering the initial admission budget
is therefore not sufficient to avoid all subsequent quota failures; a rolling
allowance remains a plausible additional constraint.

The first cap-2048 restart attempt stopped before a worker ran: planner request
received 429 and persisted diagnostic run
`coord_75f1de7c-2fba-48ce-af8a-381f46336c97`. No kill or resume was claimed.
Record: `benchmark/evidence/coordination/restart-cap2048-planner-blocked.json`.
Source inspection found that `createPlannerGenerator` omitted the explicit context
output cap from provider requests. A regression reproduced `[undefined, undefined]`
instead of `[2048, 2048]`; the bounded fix now forwards a configured positive safe
integer while preserving omitted-cap behavior. Two planner regressions pass.

Rebuilt restart follow-up is pending. Measured coverage remains 4/10 until
independent success plus authoritative pricing is recorded.
