# src/skills — Skill Lifecycle (dispatch, distill, promote)

Purpose: installed-skill runtime — dispatch skill scripts, distill new
candidate skills from sessions or mined trace evidence, and promote
eligible candidates under usage gating.

## Ownership

| File | Responsibility |
|------|----------------|
| `factory.ts` | Distillation: `runSkillFactory` (session prose), `runSkillFactoryFromTrace` (trace evidence + candidate bar), `distillMinedCandidates` (mine `--factory-out` batches), prompt builders |
| `dispatcher.ts` | Post-session factory dispatch |
| `promotion.ts` | `promoteIfEligible` (success-gated install, versioning) |
| `types.ts` | `parseSkillContent` (front-matter manifest validation) |

## Local Contracts

- **Candidate bar** (plan tunables, enforced factory-side): ≥ 5 unique
  traceIds sharing a tool-sequence shape, every traced run scoring ≥ 0.8.
  Identity is unique traceIds (run counters can inflate); per-trace
  `scores` are mandatory — scoreless evidence is rejected, never distilled
  on count alone.
- **Fire-and-forget:** `runSkillFactoryFromTrace` never throws into the
  caller (provider may be down); it reports `{accepted, reason}` so batch
  callers can summarize. (`runSkillFactory` stays `void` — only the trace
  variant reports.) `distillMinedCandidates` additionally isolates
  per-row failures (including malformed JSONL) — one bad row never aborts
  the batch. A missing batch file itself throws (caller usage error).
- **Write target:** candidates land in `~/.alix/candidates/<sessionId>/`
  (`mined` for trace-evidence batches), never the workspace.
- **Mine→factory chain:** `mine.mjs --factory-out` emits `MinedCandidate`
  rows (tool sequence + traceIds + runs + scores + sessions);
  `alix skills distill-from-traces` distills them with the configured
  factory provider. Sessions ride as prompt provenance (`traceSessions`),
  not identity.

## Work Guidance

- New distillation inputs go through the candidate bar in
  `runSkillFactoryFromTrace` — never gate caller-side.
- Keep `MinedCandidate` a `Pick` of `TraceEvidence` so the mine/factory
  contract cannot drift field by field.

## Verification

```bash
pnpm build  # typecheck + build (must be green)
node --test dist/tests/skills/factory-trace.test.js
```

## Child DOX Index

None.
