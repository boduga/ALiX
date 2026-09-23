# docs/jev — Jev / System One Integration Docs

## Purpose

Durable documentation for the ALiX × TypeSafe System One (Jev) integration:
the design spec, the delivery plan, and the current status. This is a docs
boundary, not a code boundary — it owns what the integration *is* and *where it
stands*, never how any source file works (that lives in the `AGENTS.md` next to
the code).

## Ownership

| Doc | Authoritative for |
|-----|-------------------|
| `ALiX-Jev-Architecture-Design.md` | The design spec: bounded decisions, invariants JEV-1..JEV-10, architectural boundaries. |
| `ALiX-Jev-Engineering-HandOff.md` | Context, locked decisions, constraints, implementation boundaries. |
| `ALiX-Jev-Implementation-Plan.md` | Phases J0–J6, tasks, exit criteria, PR strategy, stop conditions. |
| `ALiX-Jev-J0-Integration-Points.md` | The read-only inventory of classifier/routing/governance seams. |
| `ALiX-Jev-Status.md` | **Current state**: what landed, what is live-verified, what is deliberately not done, the open wiring decision, caveats. |

## Local Contracts

- **Status lives in exactly one place.** `ALiX-Jev-Status.md` is the single
  source for "where did this land". Do not restate phase/verification state in
  the spec docs; they state intent. When a phase lands, a mapping is
  live-verified, or a decision is made, update the status doc and nothing else.
- **The spec docs describe intent, not progress.** Architecture, Hand-Off, and
  Plan are the design. If implementation legitimately diverges from the spec,
  correct the spec — do not let the status doc become a second spec.
- **Verified facts must be traceable to code.** Claims about the live wire
  shape belong in `src/decision/engines/jev-protocol.ts` (where
  `JEV_WIRE_FORMAT_STATUS` records the verification) with the status doc
  summarising. Never assert a wire detail here that the protocol types do not.
- **Caveats are part of the record.** Circular fixture metrics, a single
  adversarial fixture, and a small Noul corpus must stay listed as caveats.
  Removing a caveat requires the evidence that retires it.
- **Name collision:** `src/cli/commands/decision/` is the governance-lens CLI
  and is unrelated to `src/decision/`. The Jev surface is `alix jev`.

## Work Guidance

- Read `ALiX-Jev-Status.md` first; it answers "is this already done?" faster
  than the plan.
- Read the Plan when adding a phase or deciding whether an exit criterion is
  met; read the Architecture when questioning a boundary or an invariant.
- When the runtime wiring decision is made or changes, update §5 of the status
  doc — that section is the handover's most load-bearing part.

## Verification

Confirm the status doc still matches reality before trusting or editing it:

```bash
# Live-verified mappings and current engine/config state
alix jev status

# Local replay is free; confirms corpora and baselines still behave
alix jev replay --engine local --compare local

# Confirm nothing in the runtime imports the decision subsystem (status §1).
# Import-specific: a bare "decision/" grep also matches comments.
grep -rn 'from "[^"]*decision/' src/agent src/runtime src/policy src/providers src/kernel
```

`alix jev status` reporting `journal records: 0` while the remote engine is
enabled is the live confirmation of the "no runtime wiring" claim. If the grep
returns an import, status §1 is stale and must be corrected.

## Child DOX Index

None.
