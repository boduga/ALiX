# FINDING — two different documents are both labelled "Pre-2.0 Harness PRD v1.1"

**Status:** OPEN — needs operator decision. **Not reconciled by this audit.**
**Recorded:** 2026-10-20
**Branches:** root `fix/tui-approval-worker-dispatch` @ `7ea5ea43`; audit `docs/pre-2.0-harness-audit`

---

## 1. The problem

Two files claim to be the Pre-2.0 Harness PRD at **version 1.1**:

| File | Version string | Contents |
|---|---|---|
| `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root, commit `7ea5ea43`) | `1.1 (proposed; operator-attention amendment)` | §1–§11 **plus §12 operator-attention (PRE-R015–R019) and §13 Harness² (PRE-R020–R026)**; parent **Master PRD v2.8** |
| `docs/ALiX_PRE_2_0_HARNESS_PRD.md` (audit branch) | `1.1 (baseline pinned)` | §1–§11 only; parent **Master PRD v2.7**; carries the **P0-A baseline pin** |

**Neither is a superset of the other.** Diff: 78 lines unique to the root copy,
83 lines unique to the audit copy.

### What the root v1.1 loses

- The pinned source baseline `4ac6df14` (tree `8bf5ac2b…`) — `4ac6df14` appears
  **0 times** in the root copy, 3 times in the audit copy.
- The re-verification of all twelve candidate paths at the pinned target.
- The HC-07 correction: `src/execution/run/task-loop.ts` is a 26-line **barrel**;
  the orchestration lives in `task-loop/main.ts`. The root copy still lists the
  barrel alone, which is the imprecision P0-A fixed.

### What the audit copy lacks

- **§12 PRE-R015–R019** — operator-attention measurement and the evidence-linked
  decision-brief contract.
- **§13 PRE-R020–R026** — Harness² research qualification.
- The parent bump to Master PRD v2.8.

---

## 2. Why this matters

`PRE-R001` requires a *reproducible baseline manifest* against a pinned commit.
The root copy does not name that commit, so a benchmark built from it would not
be pinned to anything. Conversely the audit copy has no §12, so operator-attention
measurement (`PRE-R015`) is not in the spec this audit is executing against.

A reader cannot tell from the version string which document governs. That is
exactly the ambiguity `PRE-R014` ("unknown remains unknown") and the Gate B
reproducibility requirement exist to prevent.

---

## 3. What this audit did NOT do

- **Did not merge them.** Which PRD is canonical is an operator/governance
  decision, not an audit finding. Silently producing a third "v1.1" would deepen
  the problem.
- **Did not adopt §12/§13 requirements as satisfied.** Nothing in this audit
  implements PRE-R015–R026; no operator-attention metric and no Harness² review
  exist. Recorded as `not measured` / `not started`.
- **Did not edit the root copy** (Q13 / dirty-root preservation).

---

## 4. Recommended resolution (operator decision)

1. Choose one canonical document and version it distinctly (e.g. v1.2) so the
   string identifies the content.
2. Merge in the direction chosen. If the audit copy is the base (it has the
   baseline pin), append §12/§13 and bump the parent to v2.8. If the root copy is
   the base, re-apply the `4ac6df14` pin, the twelve-path re-verification and the
   HC-07 barrel correction.
3. Record the merge as a PRD change under change control (Q01–Q15 unchanged).

## 5. Effect on Gate B

None directly — Gate B was already HOLD on measured-cost coverage. But **§12
adds PRE-R015–R019 to P0-C/P0-D scope**, and §12.4 states explicitly that the
additions "do **not** clear Gate B". So Gate B's blockers are unchanged and now
have one more unmeasured dimension (`operatorActiveReviewMinutes /
independentlyVerifiedSuccesses`, which must be reported `null` until observed).
