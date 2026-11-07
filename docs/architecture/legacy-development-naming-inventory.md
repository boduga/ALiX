# Legacy development naming inventory

Scope: production `src/` at the `main` baseline. This is an inventory and migration plan, **not** authorization to change persisted or externally consumed contracts.

## Internal rename candidates

- `src/agents/worker-ge04-linux-lifecycle.ts` — milestone in production filename; inspect consumers before renaming.
- `src/agents/worker-ge04-startup-gate.ts` and `src/agents/subagent-cli.ts` import — milestone in production filename; preserve the `GE04_READY\\n` startup handshake unless versioned migration is approved.
- `src/agents/subagent-manager.ts` — `ge04WorkerLifecycle` internal option; check external consumers and tests before renaming.
- `src/execution/filesystem/recovery-evidence.ts` — `GE04_RECOVERY_PROTOCOL` / `GE04_RECOVERY_DENIAL` symbol names can be decoupled from their serialized string values with a compatibility review.
- `src/interfaces/tui/workspace-manager.ts` — obsolete `Monolith` example in comment; comment-only cleanup.

## Compatibility-sensitive: retain until explicit migration

- `--ge04-startup-fd`, `--ge04-route-preflight`, `--ge04-owner-id` in `src/agents/subagent-cli.ts` — worker CLI arguments; rename only with coordinated caller/consumer rollout.
- `GE04_READY\\n` — startup pipe handshake, not just a label.
- `ALIX_GE04_RECOVERY_V1`, `GE04_RECOVERY_NOT_QUALIFIED`, `ALIX_GE04_FINAL_EFFECT_V1`, `GE04_FINAL_EFFECT_UNQUALIFIED` — evidence and denial contracts.
- `ALIX_GE04_Q330_LINUX_TEST` — qualification switch.
- `native/ge04/` and `scripts/ge04-release-verify.mjs` — native launcher and release verification references; inspect packaging paths before relocation.

## Legitimate compatibility terminology

`legacy-adapter`, `LegacyAuditRecord`, and legacy format readers describe actual backwards-compatibility responsibilities, not automatically obsolete names. Do not mass-replace `legacy`, `v1`, `prototype`, or milestone strings.

## Migration gates

1. Establish exact references in `src/`, `tests/`, `scripts/`, `native/`, docs and packaging.
2. Rename internal code identifiers and filenames separately from serialized values.
3. Extend naming checks to internal filenames/import paths and new identifiers, with narrow documented compatibility exceptions.
4. Run build, focused tests, full Node suite and release verification before merging implementation PRs.
5. Preserve the GE-04 SECURITY HOLD until containment and authorization qualification is independently demonstrated.
