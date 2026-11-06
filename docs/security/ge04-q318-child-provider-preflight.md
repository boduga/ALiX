# GE-04 Q3.18 — Opt-in child provider preflight

**SECURITY HOLD remains active. Not production credential isolation.**

`subagent-cli.ts` accepts opt-in `--ge04-route-preflight` plus `--ge04-owner-id`. When explicitly enabled, it reads a durable coordination claim, checks identity/attempt/owner and persisted route snapshot against locally loaded canonical config, and validates the actual primary route before `createProvider`. It **rejects every configured fallback** because the existing child `createProvider` path does not support the scheduler's ordered fallback chain. No fallback is silently discarded in the opt-in path. Legacy child invocation is unchanged and no scheduler passes these flags yet.

**Limitations:** `loadConfig` and `readWorkerCredentialSnapshot` still run **before** this check, so credential exposure may already have occurred. The worker itself supplies owner and loads scheduler config from the same workspace; it is not an authenticated authority. No proof of isolation, no protection from a malicious same-UID worker, and no enforcement for legacy workers. This phase must not be used to enable production credential delivery.

Follow-up: authenticated scheduler/broker authority, verified canonical route delivered independently of worker-writable config, correct fallback-capable provider construction, and fail-closed credential access before any secret material is loaded.
