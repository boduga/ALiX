# P17.4 — Audited Execution Recorder

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p17-4-audited-execution-recorder.md`

## Overview

Record execution attempts after explicit operator approval. Pure module + append-only JSONL store. No execution, no mutation.

## Task 1 — execution-recorder.ts

Types + validation + factory `recordExecutionAttempt()`. Validation per spec (rejected approvals, action ID mapping, status transitions, failureReason requirements). Deterministic attempt IDs.

## Task 2 — Record tests

19 tests covering all validation rules, determinism, completedAt logic.

## Task 3 — execution-store.ts

Append-only JSONL store with async I/O. `append`, `list`, `getById`, `getByPlanId`, `getByApprovalId`.

## Task 4 — Store tests

10 tests covering all store methods.

## Acceptance

Pure module, no store/audit imports, append-only semantics, no execution.
