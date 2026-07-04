# P11 Post-Effect Roadmap Alignment

**Date:** 2026-07-04  
**Status:** Accepted  
**Scope:** PRs #186 onward  
**Supersedes:** Temporary Phase 3–7 naming used during the Effect/runtime hardening arc  

---

## 1. Purpose

This decision records how the work after PR #185 maps back onto the ALiX P-series project plan.

The Effect.ts / Effect Schema migration and runtime hardening work did **not** reset ALiX back to an earlier P4.x milestone. It was a safety and reliability hardening arc inside the already-active P11 roadmap.

The canonical project-plan mapping is:

```text
P11.6 — Effect/runtime safety foundation        #160–#185  ✅
P11.7 — Observability and execution context     #186–#200  ✅
P11.8 — Autonomous issue execution foundation   #201–#206  ✅
P11.9 — Issue-to-PR proposal loop               #207+      active
```

---

## 2. Decision

All PRs after #185 must be interpreted as continuations of the P11.x roadmap.

Temporary phase labels remain useful as historical checkpoint labels, but future roadmap docs, PR titles, PR bodies, and milestone summaries should use P11.x labels as the canonical project-plan language.

| Temporary label | Canonical project-plan mapping |
|---|---|
| Phase 3: Observability & diagnostics | P11.7a — Durable Observability |
| Phase 4: Execution context | P11.7b — Execution Context Correlation |
| Phase 5: Agent-loop context | P11.7c — Agent-Run Attribution |
| Phase 6: Autonomous issue execution | P11.8 — Autonomous Issue Execution Foundation |
| Phase 7: PR proposal and patch execution | P11.9 — Issue-to-PR Proposal Loop |

---

## 3. PR Mapping After #185

### P11.7a — Durable Observability

| PR | Title / summary | Mapping |
|---:|---|---|
| #186 | Design durable diagnostics telemetry | P11.7a |
| #187 | Add diagnostic event store sink | P11.7a |
| #188 | Wire diagnostic event store sink | P11.7a |
| #189 | Add diagnostics query CLI | P11.7a |
| #190 | Record observability and diagnostics milestone | P11.7a checkpoint |

### P11.7b — Execution Context Correlation

| PR | Title / summary | Mapping |
|---:|---|---|
| #191 | Design execution context correlation | P11.7b |
| #192 | Add execution context type | P11.7b |
| #193 | Attach execution context to runtime diagnostics | P11.7b |
| #194 | Attach execution context to contract diagnostics | P11.7b |
| #195 | Filter diagnostics by execution context | P11.7b |
| #196 | Record execution context and correlation milestone | P11.7b checkpoint |

### P11.7c — Agent-Run Attribution

| PR | Title / summary | Mapping |
|---:|---|---|
| #197 | Create execution context for agent runs | P11.7c |
| #198 | Add execution-context diagnostics query examples | P11.7c |
| #199 | Propagate parentRunId for child agent runs | P11.7c |
| #200 | Record agent-loop execution context milestone | P11.7c checkpoint |

### P11.8 — Autonomous Issue Execution Foundation

| PR | Title / summary | Mapping |
|---:|---|---|
| #201 | Design autonomous issue execution loop | P11.8 |
| #202 | Add issue execution run skeleton | P11.8 |
| #203 | Add structured evidence events to issue execution | P11.8 |
| #204 | Add dry-run mode to issue execution | P11.8 |
| #205 | Add GitHub issue comment with run summary | P11.8 |
| #206 | Record issue execution milestone | P11.8 checkpoint |

### P11.9 — Issue-to-PR Proposal Loop

| PR | Title / summary | Mapping |
|---:|---|---|
| #207 | Design issue-to-PR proposal loop | P11.9 design |

P11.9 is the active implementation track after this alignment decision.

---

## 4. Current Project-Plan Status

```text
P11.1–P11.5  Core cognitive pipeline                         ✅ complete
P11.6        Effect/runtime safety foundation                 ✅ complete (#160–#185)
P11.7        Observability, diagnostics, execution context     ✅ complete (#186–#200)
P11.8        Autonomous issue execution foundation             ✅ complete (#201–#206)
P11.9        Issue-to-PR proposal loop                         🚧 active (#207+)
```

---

## 5. Naming Rules Going Forward

Future PRs in this stream should include the P11.x milestone in the title or body.

Preferred examples:

```text
docs(agent): design P11.9 issue-to-PR proposal loop
feat(agent): add P11.9 issue patch proposal dry run
feat(agent): add P11.9 changed-files guardrail
feat(agent): add P11.9 verification command runner
feat(agent): add P11.9 draft PR creation behind explicit flag
docs(agent): record P11.9 issue-to-PR milestone
```

Avoid introducing new standalone phase labels unless they are explicitly mapped back to the P11.x project plan.

---

## 6. Non-Goals

This alignment does not:

- change any shipped code behavior;
- rewrite completed PR history;
- rename existing checkpoint files;
- move docs between directories;
- alter Effect/runtime architecture;
- reset the project to P4.x;
- start A-series autonomous evolution work;
- authorize autonomous merge.

---

## 7. Rationale

ALiX was already in the P11 roadmap before the Effect.ts migration. The migration and runtime-hardening arc added safety, diagnostics, execution context, and issue-execution capabilities required by P11, but it did not replace the roadmap.

Keeping this work under P11 preserves continuity:

```text
P11 cognitive pipeline
  → P11 runtime and observability hardening
  → P11 agent-run attribution
  → P11 autonomous issue execution
  → P11 issue-to-PR proposal loop
```

The next implementation work should continue as P11.9.
