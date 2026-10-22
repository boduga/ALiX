# Harness cutover plan (P0 — deliverable 5, PRE-R010 / PRE-R011)

**Status:** DESIGN ONLY. Nothing here is approved, scheduled, or authorized.
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §5 (PRE-R010/R011), §8 (P0-F, P0-H), §9.
**Publication / simplification:** HOLD (Q13). This plan executes nothing.

The cutover plan exists to make future consolidation **reversible and ordered**,
not to justify removal. Every step below has a rollback; a step without a rollback
is marked as requiring design before it can be scheduled.

---

## 1. Dependency order (what must precede what)

Derived from `harness-dependency-retirement-map.md` §1 and the PRD workstream
table (§8). An edge here is a hard prerequisite, not a suggestion.

```
P0-A inventory ──────────────► P0-B invariants ──────────► P0-C benchmark spec
                                                                    │
                                                                    ▼
                                                          P0-D baseline (Gate B)
                                                                    │
                              ┌─────────────────────────────────────┘
                              ▼
                    P0-E ablations (Gate C)   ◄── NOT AUTHORIZED (§12.4)
                              │
                              ▼
                    P0-F migration design (PRE-R010/R011)
                              │
                              ▼
                    P0-H approved cutover (Q04/Q05 + Gate E/F approval)
```

**Current position: between P0-D and P0-E.** Gate B is HOLD, so nothing downstream
is schedulable. This is the single most important fact in this document.

---

## 2. Migration inventory — state of each candidate

### 2.1 L0 (whole-item removal candidates)

| ID | Item | Reader inventory | Status |
|---|---|---|---|
| HC-11 | `config.model` / `config.subagents` compatibility projections, single writer `normalizeModelConfig` (`src/operations/config/loader.ts:40-77`) | **NOT COMPLETE** — gap F-05: projection readers not inventoried | **blocked on PRE-R010** |

This is the one genuine L0 candidate and it is **not ready to touch**. The
projections have a single documented writer and an unknown reader set. Retiring a
projection with live readers is a breaking change to every one of them, and the
repo's own DOX rule (`Root AGENTS.md`, config contracts) makes the loader the only
projector — so removal must migrate readers first, never the writer first.

**Safe order:** enumerate readers → migrate each to the canonical `models` object
→ prove zero readers → remove the projection → keep the `noUnusedLocals` and
dead-module gates as the tripwire.

### 2.2 M2 (ablation-gated)

HC-01 (prompt sections) and HC-03 (patch format). **No removal is proposed here**;
`harness-ablation-report.md` records why no comparison is admissible yet. These
cannot enter a cutover until Gate C produces a keep/retire decision.

### 2.3 S0/S1 (preserve — never cutover targets)

Scheduling, authorization, approval consumption, ownership, recovery, verification,
run ceilings, single-use approval. Listed here only to make explicit that they are
**out of scope for consolidation**; a cutover that touches them is a re-architecture,
not a simplification, and needs its own S0 review.

---

## 3. Per-step plan shape

Each schedulable step must carry all six fields before it can be approved. This is
the template a future P0-H step must satisfy:

| Field | Requirement |
|---|---|
| **Concern** | exactly one concern per package (PRE-R011) |
| **Preconditions** | which inventory gap it closes; which gate it depends on |
| **Affected contracts** | named R1 ports / DOX-owned boundaries, with the file that owns each |
| **Tests** | the negative test that catches the regression, plus the parity table where authorization is involved |
| **Rollback** | revert-friendly: the change must be isolated to one commit with no data migration, or ship with a down-migration |
| **Stop condition** | what observation halts the step (e.g. an unreachable reader, a gate turning red) |

**Parity rule carried in from the root contract:** any change to what an
allow/deny/owned decision *authorizes* needs an expected-outcome table broader
than the implementation (`tests/ownership/path-scope.test.ts`), never a spot check.
A cutover step that touches authorization without that table is unapprovable.

---

## 4. Migration of historical data (Q04) and breaking interfaces (Q05)

Gate D requires both to cover **every supported reader/writer**. State:

| Requirement | State | Blocker |
|---|---|---|
| Q04 — historical-data migration | **not designed** | Reader/writer inventory incomplete (F-05). Cannot design a migration over an unknown data shape |
| Q05 — breaking-interface plan | **not designed** | Depends on the same inventory; also needs the Gate E security clearance for any interface reachable by a governance path |

No migration script, schema version bump, or interface deprecation is proposed
here. Proposing one against an uninventoried reader set is how silent data loss
happens.

---

## 5. Risk register

| Risk | Trigger | Mitigation |
|---|---|---|
| Silent reader breakage | retiring a projection with an uninventoried reader | F-05 must close first; `noUnusedLocals`/dead-module gates plus an import-count audit |
| Authorization regression during consolidation | moving a decision across a seam | path-scope parity table; R1 freeze shrink-only |
| Losing durability guarantees | collapsing ledger + projection | the ledger stays authoritative (S0); a cutover may only remove projections |
| Benchmark invalidation | changing prompt/behavior mid-baseline | baseline frozen per commit; cutover starts only after Gate B signs |
| Irreversibility | a step needing data migration | no such step may ship without a down-migration (see §3 rollback) |

---

## 6. Explicit non-decisions

- **No retirement is approved.** HC-11 is blocked, HC-01/HC-03 are unmeasured.
- **No migration is designed.** Q04/Q05 await the reader inventory.
- **No production change is authorized.** §12.4 and Q13 both stand.
- **No dates.** Duration estimates would be invented; the PRD forbids fabricated
  numeric targets, and a schedule derived from nothing is the same defect.

---

## 7. Verdict

**Gate D: NOT MET.** PRE-R010 is partially met (the one L0 candidate is
characterised but its readers are not enumerated); PRE-R011 is not started.

The plan's value today is the ordering constraint it records: **nothing downstream
of P0-D is schedulable while Gate B is HOLD**, and the first real step is a reader
inventory — a read-only task that needs no authorization beyond the current
audit mandate.
