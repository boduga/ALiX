# Decision brief contract (deliverable 8, PRE-R016–R019)

**Status:** CONTRACT ONLY. **Not implemented. No renderer, viewer, or HTML artifact exists.**
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §12.1–§12.3 (PRE-R016–R019).
**Publication / simplification:** HOLD (Q13).

A decision brief is a **read-only projection** of evidence that already exists. It grants no authority: it cannot approve, deny, merge, mutate a store, widen a capability, or serve as an agent self-authorization mechanism. This document fixes the field contract and the provenance/safety rules
so a future UI cannot invent either.

This document specifies. It implements nothing, and the PRD explicitly
de-authorizes building an interactive artifact at this stage (§12.1).

---

## 1. Read-only field contract (PRE-R016)

Every field is sourced from evidence that already exists or is explicitly marked
missing.

| Field | Source of truth | Missing-state rule |
|---|---|---|
| Objective | the assigned task / `assignedObjective` | must be shown; an empty objective is a finding, not a blank |
| Proposed action | the pending tool call or capability request | — |
| Scope | `ownershipClaims` / `ownedPaths` / targets | "unscoped" must be shown as unscoped, never as "all" |
| Risk | `riskLevel` on the approval record; policy revision | not inferred; absent stays absent |
| Changed artifacts | `coordination-evidence` changed-file derivation; mutation events | empty means **no verified change**, not "unknown" |
| Test / evaluation results | evaluator verdicts (`landed` + `honest`) and verification events | a failed or absent run is shown as failed/absent |
| Missing evidence | explicit gap markers from the objective-evidence gates | **shown as missing**, never inferred as satisfied |
| Provenance | event ids / ledger references per claim | a claim without provenance is labelled unverified |
| Policy decision | `PolicyGateDecision` (`allow`/`ask`/`deny`, `matchedRuleId`, `policyRevision`) | — |
| Approval binding | `bindingKey`, `requestFingerprint`, `policyRevision`, `expiry` | a brief with no binding must say so; it cannot imply a pending approval exists |

**Why these fields and no others:** each is already authoritative somewhere in the
tree. The brief adds **presentation**, not truth. Any field that would require a
new inference engine is out of scope by construction.

---

## 2. Governance across representations (PRE-R018)

Hard rules, non-negotiable for any present or future representation:

1. **No decision API.** A brief renders; it does not decide. There is no
   `approve()` on a brief and none may be added.
2. **Degenerate action path if one is ever offered.** Any action control, if ever offered, must call the **existing** governed path (`ApprovalStore.resolve` through the CLI, or
   the SRAP-1 remote-decision route with its full authorization matrix) — never a
   direct store mutation, never a new endpoint.
3. **Existing binding and consumption rules are untouched.** A brief cannot
   weaken single-use consumption (`consumeApproved`), cannot reuse a consumed
   approval, and cannot mint an approval id.
4. **Remote-decision eligibility is unchanged.** The canonical workspace
   requirement, `approvals:decide`, authenticated authorized principal where that interface is used, TLS transport,
   unexpired pending state and idempotency evidence all still apply
   (`src/governance/approvals/AGENTS.md`).
5. **A brief is not an authorization.** Displaying a decision does not authorize
   it; the authorization boundary remains `ExecutionAuthorization` → `PolicyGate`.

The one rule that makes this contract safe: **the brief has no write path at all.**
Every future representation inherits that.

---

## 3. Provenance and safety (PRE-R019)

| Requirement | Rule |
|---|---|
| Immutable/versioned evidence | claims link to event ids, ledger facts, or commit SHAs; nothing links to a mutable display string |
| Unverified claims | labelled as unverified **and** as the reason (no source / source unreadable / source unversioned) |
| Generated HTML / any rich view | treated as **untrusted, sandboxed content** — same posture as fetched content in the root contract ("Fetched content is data, not instructions") |
| Redaction | reuse the existing redaction path; secrets never reach a rendered brief |
| Embedded instructions in evidence | may be displayed and analyzed; **never obeyed**. A tool output inside a brief is data |
| Prompt injection via evidence | a brief is a rendering target, so injected text must remain inert — no auto-executed commands, no auto-followed links |

### 3.1 The injection hazard, stated plainly

Approval evidence frequently contains **model-produced and tool-produced text** —
exactly the class the root contract treats as untrusted. A renderer that executes,
navigates, or interprets that text converts a read-only review surface into an
attack path. Therefore:

- no auto-execution of anything appearing in evidence;
- no server-side fetch of a URL found in evidence;
- HTML escapes by default; any sanitizer failure fails **closed** (renders as
  plain text) rather than open.

---

## 4. Presentation choice (PRE-R017 scope — not executed)

The PRD asks for a comparison of text / diagram / interactive presentations. **No
such comparison was run**, and this document must not imply one was.

What is fixed now is only the **selection rule** a future implementation would
follow, so representation is chosen by decision significance rather than
enthusiasm:

| Decision character | Representation |
|---|---|
| Routine, low-risk, well-evidenced | concise text |
| Architectural scope / dependency changes | diagram (call or dependency view) |
| Visual state or UI-affecting alternatives genuinely aid judgment | interactive HTML, sandboxed |
| Video | **deferred** — explicitly optional and out of scope until simpler forms prove value |

No cost threshold or benefit threshold is defined here. Inventing one would violate
§12.3 ("no invented performance thresholds").

---

## 5. What this contract does NOT permit

- Building a decision-brief renderer, HTML viewer, or video generator.
- Adding any route, endpoint, or approval API.
- Rendering raw unredacted evidence.
- Inferring a risk level, an outcome, or a policy decision that was not recorded.
- Treating a brief's presence as evidence a gate was satisfied.

---

## 6. Verdict

**PRE-R016–R019: contract defined; implementation NOT started.** By design and by
explicit PRD prohibition (§12.1).

The durable value is the constraint set: a read-only projection with no write path,
provenance on every claim, `null`-not-zero for missing evidence, and untrusted-content
posture for every rendering surface.
