/**
 * P25.3 — Policy Review Candidate Store.
 *
 * File-based store for persisted policy review candidates with append-only
 * event log. State machine transition validation enforced here — the CLI
 * never decides transition legality.
 *
 * Store receives configurable rootDir for testability.
 * Store MAY import types from policy-review-candidate-types.ts.
 * Store MUST NOT import the builder module.
 */

import { access, mkdir, readFile, writeFile, readdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  PolicyReviewCandidate,
  PolicyReviewCandidateEvent,
  PolicyReviewCandidateStatus,
} from "./policy-review-candidate-types.js";
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_STORE_ROOT,
  type PolicyReviewCandidateStore as StoreInterface,
} from "./policy-review-candidate-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function eventId(): string {
  return randomUUID();
}

function candidatePath(rootDir: string, candidateId: string): string {
  return join(rootDir, `${candidateId}.json`);
}

function eventsPath(rootDir: string, candidateId: string): string {
  return join(rootDir, `${candidateId}.events.jsonl`);
}

// ---------------------------------------------------------------------------
// createPolicyReviewCandidateStore
// ---------------------------------------------------------------------------

export function createPolicyReviewCandidateStore(opts: {
  rootDir?: string;
}): StoreInterface {
  const rootDir = opts.rootDir ?? DEFAULT_STORE_ROOT;

  // -------------------------------------------------------------------------
  // Ensure store directory exists
  // -------------------------------------------------------------------------

  async function ensureDir(): Promise<void> {
    await mkdir(rootDir, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Read candidate
  // -------------------------------------------------------------------------

  async function readCandidate(candidateId: string): Promise<PolicyReviewCandidate | null> {
    const path = candidatePath(rootDir, candidateId);
    try {
      await access(path);
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as PolicyReviewCandidate;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Write candidate
  // -------------------------------------------------------------------------

  async function writeCandidate(candidate: PolicyReviewCandidate): Promise<void> {
    await ensureDir();
    const path = candidatePath(rootDir, candidate.candidateId);
    await writeFile(path, JSON.stringify(candidate, null, 2), "utf-8");
  }

  // -------------------------------------------------------------------------
  // Append event
  // -------------------------------------------------------------------------

  async function appendEvent(event: PolicyReviewCandidateEvent): Promise<void> {
    await ensureDir();
    const path = eventsPath(rootDir, event.candidateId);
    await appendFile(path, JSON.stringify(event) + "\n", "utf-8");
  }

  // -------------------------------------------------------------------------
  // Read events
  // -------------------------------------------------------------------------

  async function readEvents(candidateId: string): Promise<PolicyReviewCandidateEvent[]> {
    const path = eventsPath(rootDir, candidateId);
    try {
      await access(path);
      const raw = await readFile(path, "utf-8");
      return raw
        .split("\n")
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as PolicyReviewCandidateEvent);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // List candidates
  // -------------------------------------------------------------------------

  async function listCandidates(opts?: { status?: PolicyReviewCandidateStatus }): Promise<PolicyReviewCandidate[]> {
    await ensureDir();
    const files: string[] = [];
    try {
      const entries = await readdir(rootDir);
      for (const entry of entries) {
        if (entry.endsWith(".json") && !entry.endsWith(".events.jsonl")) {
          files.push(entry);
        }
      }
    } catch {
      return [];
    }

    const candidates: PolicyReviewCandidate[] = [];
    for (const file of files) {
      const raw = await readFile(join(rootDir, file), "utf-8");
      try {
        const candidate = JSON.parse(raw) as PolicyReviewCandidate;
        if (!opts?.status || candidate.status === opts.status) {
          candidates.push(candidate);
        }
      } catch {
        // Skip malformed files
        continue;
      }
    }

    // Deterministic sort: createdAt ascending, candidateId as tie-break
    candidates.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.candidateId.localeCompare(b.candidateId),
    );
    return candidates;
  }

  // -------------------------------------------------------------------------
  // openCandidate
  // -------------------------------------------------------------------------

  async function openCandidate(opts: {
    candidate: PolicyReviewCandidate;
    rationale?: string;
  }): Promise<PolicyReviewCandidate> {
    const existing = await readCandidate(opts.candidate.candidateId);

    if (existing) {
      // Idempotent: return existing, don't duplicate events
      return existing;
    }

    if (opts.candidate.status !== "proposed") {
      throw new Error(
        `openCandidate rejects status "${opts.candidate.status}". ` +
        `Candidates must be opened with status "proposed".`,
      );
    }

    await writeCandidate(opts.candidate);

    const event: PolicyReviewCandidateEvent = {
      eventId: eventId(),
      candidateId: opts.candidate.candidateId,
      occurredAt: now(),
      type: "candidate_opened",
      rationale: opts.rationale,
      boundaries: { noPolicyMutation: true, noThresholdChange: true, noAutoAdoption: true },
    };
    await appendEvent(event);

    return opts.candidate;
  }

  // -------------------------------------------------------------------------
  // transitionCandidate
  // -------------------------------------------------------------------------

  async function transitionCandidate(opts: {
    candidateId: string;
    nextStatus: PolicyReviewCandidateStatus;
    rationale: string;
  }): Promise<PolicyReviewCandidate> {
    const candidate = await readCandidate(opts.candidateId);
    if (!candidate) {
      throw new Error(`Candidate not found: ${opts.candidateId}`);
    }

    const allowed = ALLOWED_TRANSITIONS[candidate.status];
    if (!allowed || !allowed.includes(opts.nextStatus)) {
      throw new Error(
        `Invalid transition: ${candidate.status} → ${opts.nextStatus}. ` +
        `Allowed from ${candidate.status}: ${(allowed ?? []).join(", ") || "(none, terminal state)"}`,
      );
    }

    const previousStatus = candidate.status;
    candidate.status = opts.nextStatus;
    candidate.updatedAt = now();
    if (opts.rationale) {
      candidate.review.rationale = opts.rationale;
    }

    await writeCandidate(candidate);

    const event: PolicyReviewCandidateEvent = {
      eventId: eventId(),
      candidateId: opts.candidateId,
      occurredAt: now(),
      type: "status_changed",
      previousStatus,
      nextStatus: opts.nextStatus,
      rationale: opts.rationale,
      boundaries: { noPolicyMutation: true, noThresholdChange: true, noAutoAdoption: true },
    };
    await appendEvent(event);

    return candidate;
  }

  // -------------------------------------------------------------------------
  // addNote
  // -------------------------------------------------------------------------

  async function addNote(opts: {
    candidateId: string;
    note: string;
  }): Promise<PolicyReviewCandidate> {
    const candidate = await readCandidate(opts.candidateId);
    if (!candidate) {
      throw new Error(`Candidate not found: ${opts.candidateId}`);
    }

    candidate.review.notes.push(opts.note);
    candidate.updatedAt = now();
    await writeCandidate(candidate);

    const event: PolicyReviewCandidateEvent = {
      eventId: eventId(),
      candidateId: opts.candidateId,
      occurredAt: now(),
      type: "note_added",
      rationale: opts.note,
      boundaries: { noPolicyMutation: true, noThresholdChange: true, noAutoAdoption: true },
    };
    await appendEvent(event);

    return candidate;
  }

  // -------------------------------------------------------------------------
  // showCandidate
  // -------------------------------------------------------------------------

  async function showCandidate(candidateId: string): Promise<{
    candidate: PolicyReviewCandidate | null;
    events: PolicyReviewCandidateEvent[];
  }> {
    const candidate = await readCandidate(candidateId);
    const events = await readEvents(candidateId);
    return { candidate, events };
  }

  return {
    openCandidate,
    transitionCandidate,
    addNote,
    listCandidates,
    showCandidate,
  };
}
