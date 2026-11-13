# docs/security — Security Evidence and Hold Dispositions

## Purpose

Security design, threat models, risk registers, qualification designs, and the
evidence records behind them. Much of this tree describes work that is
**designed and tested but not independently accepted**. A document in this
directory being present, detailed, or green does not mean the control it
describes is qualified or released.

## Ownership

| Path | Contents |
|------|----------|
| `threat-model.md` | Repository-wide threat model; the framing document the `ge04-*` set specializes |
| `risk-register.md` | Tracked risks and their current disposition |
| `architecture.md`, `operations.md`, `rollout-strategy.md`, `acceptance-matrix.md`, `baseline-inventory.md` | Security architecture, operational posture, staged rollout, acceptance matrix, and pinned baseline inventory |
| `inspector-security.md` | Inspector authentication and authorization model |
| `ge04-*.md` | GE-04 privileged-worker qualification: designs, boundary contracts, and per-gate evidence. 54 files; the largest coherent body of work here |
| `ge04-production-authorization-gate-register.md` | The nine required acceptance gates (G1–G9) and their current disposition |
| `ge04-acceptance-ledger-2026-11-08.md` | Per-requirement acceptance ledger across the 13 open GE-04 issues |
| `2026-10-31-*.md` | Dated investigations: dependency remediation, ONNX/embedding qualification, audit-exception gate defect |

## Local Contracts

- **The GE-04 security hold is read, not remembered.** `security_hold` is `ACTIVE`
  across the gate register and acceptance ledger. Resolve hold state against
  `ge04-production-authorization-gate-register.md`, not against a summary,
  a readiness report, or a passing test suite.
- **An unmet gate is not a missing document.** All nine gates in the register
  are `Unmet`, and all 76 ledger items are unchecked with evidence recorded as
  `NOT VERIFIED IN THIS LEDGER`. Each is an unverified acceptance item, not
  necessarily absent source code. Do not mark one satisfied without linked test
  output, platform details, an independent reviewer, and the exact commit.
- **Author-side evidence is not acceptance.** Tests, fixtures, drift checks and
  model review establish that the code behaves as its author intended. They
  cannot supply independent human security acceptance. That distinction is the
  whole reason the hold exists; collapsing it is the one edit this directory
  does not permit.
- **No document here is a second policy authority.** ALiX governance remains
  sole authority. A witness, signature, trust monitor, readiness report or
  operator name in this tree may not become an alternative authorization path.
- **Runtime enforcement fails closed by assertion.** `ge04-native-governance-readiness.ts`
  raises `GE-04 SECURITY HOLD` for every gated operation and rejects unknown
  claim fields, including a caller-supplied authorization flag. A matching
  fingerprint is never evidence of signing, provenance or release authorization.
- **Dated records are history; the design contracts are current.** A
  `YYYY-MM-DD-` file records what was true when written. When a dated record and
  a `ge04-*` design contract disagree, the contract governs the current
  boundary and the record explains how it was reached.
- **Superseded analysis is deleted, not archived here.** This directory is not a
  history tree; durable superseded material belongs under `docs/superseded/`.

## Work Guidance

- Adding a GE-04 qualification design means adding its gate row to the register
  and its requirement lines to the ledger in the same change. Evidence that is
  not indexed by a gate is indistinguishable from evidence that does not exist.
- Name the exact source path and the exact test that proves each claim, so a
  reviewer can re-run it. Prose assertions are not evidence.
- State the limits of what a control proves before stating what it enables. The
  `ge04-*` documents do this deliberately: a boundary that authenticates a
  caller is described by what it still cannot authorize.
- Do not weaken a hold, gate disposition, or acceptance wording to match an
  implementation's current state. Change the implementation, or record the gate
  as unmet.

## Verification

- `pnpm check:staleness` resolves every root-relative path named in this tree and
  fails on a reference that no longer describes it. Run it after any path move.
- `pnpm check:dox` audits contract claims added to this file against branch
  content.
- GE-04 Python checks under `scripts/ge04-*.py` and their tests under
  `tests/agents/test_ge04_*.py` verify behaviour, not acceptance. A green run is
  a statement about the fixture, never about the gate.

## Child DOX Index

No child `AGENTS.md`. This directory is flat; the `ge04-*` set is one body of
work governed by this file.
