# Supervision eligibility schema (deliverable 12b, PRE-R028–R032)

**Status:** PROPOSED SCHEMA. **Not implemented. No threshold defined.**
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §14.1 (PRE-R028–R032), §14.2.
**Companion:** `harness-supervision-authority-map.md` (what exists today).
**Publication / simplification:** HOLD (Q13).

A **node-level eligibility record** states whether a specific task class may run
under a qualified autonomous review mode. It is an **evidence bundle**, not a grant: it confers
no authority by itself, and it can only ever *narrow* what an existing policy
permits.

---

## 1. Proposed eligibility record (PRE-R028)

| Field | Meaning | Rule |
|---|---|---|
| `taskClass` | The kind of task this record covers | Scope precisely; "all tasks" is not a valid class |
| `capability` | Capabilities the class may use | Must be within existing policy; never a new grant |
| `environment` | Workspace / sandbox / egress profile | Must match a qualified isolation profile |
| `modelConfig` | Provider, model id, version, executor | A model change **invalidates** the record |
| `risk` | Maximum risk level permitted unattended | High/critical never eligible (Q08) |
| `policyRevision` | Policy revision the record was qualified against | A revision change **invalidates** the record |
| `reviewMode` | `full-verification` \| `sampled-verification` \| `exception-based` | Today only `full-verification` is supported by the agent-driven contract; reduced modes require qualification |
| `evidenceRefs` | Links to the runs/traces that justify the record | Required; a record with no evidence is invalid |
| `expiry` | Explicit expiry timestamp | Required; no permanent eligibility |
| `authorityRef` | Machine-verifiable policy/config authority for the qualification | Required; evaluated agents cannot mint or modify it |

**Mandatory default:** any field absent, unreadable, or stale ⇒ eligibility is
**denied** (fail closed). Unmeasured confidence and failure rates are treated as
**unknown**, never as acceptable — the PRD states this directly.

---

## 2. Promotion evaluation design (PRE-R029)

Not executable today; specified so a future evaluation is constrained.

A promotion from `full-verification` → `sampled-verification` (or `sampled-verification` → `exception-based`)
requires:

1. **Representative repeated tasks** — the class's real distribution, not a
   convenient subset. Repetition n≥3 minimum; more where variance appears.
2. **Risk-weighted failure categories** — a rare catastrophic failure outweighs
   many trivial successes. Categories are named **before** the run.
3. **Sample-size / uncertainty rationale** — reported with every estimate.
4. **Blinded seeded-risk checks** — deliberately seeded defects the independent verifier/critic
   should catch; measures what review actually detects.
5. **Holdouts** — tasks unseen by any tuning step.
6. **Trace completeness** — every decision auditable after the fact (gap S-7).
7. **Pre-versioned threshold authority.** **No default number is supplied here.** Thresholds must exist in signed/versioned policy or qualification configuration before evaluation begins. The evaluated agents cannot create, relax, or rewrite them.

### 2.1 The one rule that makes promotion meaningful

**A faster workflow with worse safety fails.** Per PRE-R031, verifier/critic effort, sampling quality, missed-risk rate, exception volume, queue bottlenecks, verified outcomes, cost and latency are **distinct measures**. No composite score is
defined here, because a composite would let a safety regression be offset by a
speed gain — precisely what the PRD forbids.

---

## 3. Downgrade and suspension triggers (PRE-R030)

Automatic demotion back to `full-verification`, with an auditable exception record and fail-closed fallback:

| Trigger | Condition | Action |
|---|---|---|
| Material failure | A failure in a risk category declared disqualifying | Suspend immediately |
| Policy change | `policyRevision` differs from the qualified value | Suspend pending re-qualification |
| Model / tool change | `modelConfig` or offered tool surface differs | Suspend pending re-qualification |
| Distribution shift | Task class drift detected beyond the qualified profile | Suspend; require new evaluation |
| Missing traces | Trace incomplete for a decision window | Suspend the class (safety cannot be evidenced) |
| Stale evidence | `evidenceRefs` older than the qualification window | Suspend pending refresh |
| Expired qualification | `expiry` passed | Suspend |

Every trigger routes to **full-verification** when already authorized, otherwise durable `BLOCKED`, and produces a durable exception record. None silently resumes; re-qualification is explicit and agent-independent.

---

## 4. Non-bypass demonstration requirement (PRE-R032)

Any future implementation must **demonstrate**, with tests, that supervision never
bypasses:

| Control | Required demonstration |
|---|---|
| Authorization | An eligibility record cannot turn a `deny` into an `allow`; `ExecutionAuthorization` still decides |
| Approval binding | High-risk action under any review mode still requires a valid bound approval; unavailable ⇒ durable pause, no side effect |
| Single-use consumption | `consumeApproved` semantics unchanged; eligibility cannot mint or reuse |
| Denial | A denial stays denied even under exception-based mode |
| Scope | `isWithinOwnedScope` still decides write targets |
| Q08 bounded autonomy | Eligibility is bounded and pre-authorized; the agent cannot widen it |
| Harness² optimization | Cannot promote itself into higher privilege (PRD §14.1) |

These become **parity tests** (expected-outcome tables broader than the
implementation), not spot checks — matching the repo's standing rule for any change
to what an allow/deny/owned decision authorizes.

---

## 5. Test matrix (specified, not written)

| Case | Expected |
|---|---|
| Eligibility present, all fields valid, within policy | Existing decisions unchanged; no new permission granted |
| Eligibility present, but policy would deny | **Deny** — eligibility is not authority |
| High-risk action, no valid bound authority | **Durable `BLOCKED`**, zero side effect |
| High-risk action, consumed approval | **Deny** with exact reason |
| Model changed since qualification | **Suspend** class |
| Policy revision changed | **Suspend** class |
| Trace incomplete | **Suspend** class |
| Expiry passed | **Suspend** class |
| Any field missing/unreadable | **Deny** (fail closed) |
| Eligibility names a broader capability than policy allows | **Deny** |

---

## 6. Verdict

**PRE-R028: schema proposed, not implemented.**
**PRE-R029: evaluation design specified, not executed.**
**PRE-R030: downgrade triggers defined, not implemented.**
**PRE-R031: measures named, all `not measured`.**
**PRE-R032: current structural non-bypass demonstration exists.** `tests/security/pre-r032-non-bypass.vitest.ts` and `tests/security/policy-protected-path-parity.vitest.ts` exercise the present authorization surfaces a future verification layer would have to preserve. This demonstrates the current absence of a supervision bypass surface; it does not qualify any future sampling/exception implementation.

**Progressive supervision is not implemented and is not qualified.** No task is
promoted to sampled or exception-only review; no autonomy engine was built; no threshold was invented. Existing session modes remain execution-policy inputs; the Harness contract itself requires independent verification rather than human supervision.

The durable value is the constraint set: eligibility is evidence, never authority;
absence or staleness fails closed; every promotion needs pre-versioned policy thresholds and blinded risk checks; and every safety bypass is a test case rather than a review
promise.
