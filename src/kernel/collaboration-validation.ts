/**
 * collaboration-validation.ts — Validation and canonicalization for collaboration records.
 */

import { resolve, relative, isAbsolute } from "node:path";
import type { PublishFindingInput, PublishArtifactInput } from "./collaboration-types.js";
import type { WorkerOwnershipClaim } from "./coordination-types.js";

// ─── Constants ──────────────────────────────────────────────────────

const MAX_TITLE_CHARS = 200;
const MIN_CONTENT_CHARS = 1;
const MAX_CONTENT_CHARS = 20_000;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 64;
const MAX_EVIDENCE_REFS = 64;
const MAX_ARTIFACT_REFS = 64;

// ─── Helpers ────────────────────────────────────────────────────────

function isInRange(v: number | undefined, min: number, max: number): boolean {
  return v === undefined || (v >= min && v <= max);
}

function strlen(s: string | undefined, min: number, max: number): boolean {
  if (s === undefined) return false;
  return s.length >= min && s.length <= max;
}

// ─── Finding validation ─────────────────────────────────────────────

export function validatePublishFindingInput(input: PublishFindingInput): string[] {
  const errors: string[] = [];

  if (!strlen(input.title, 1, MAX_TITLE_CHARS)) {
    errors.push(`title must be 1-${MAX_TITLE_CHARS} characters`);
  }
  if (!strlen(input.content, MIN_CONTENT_CHARS, MAX_CONTENT_CHARS)) {
    errors.push(`content must be ${MIN_CONTENT_CHARS}-${MAX_CONTENT_CHARS} characters`);
  }
  if (!isInRange(input.confidence, 0, 1)) {
    errors.push("confidence must be between 0 and 1");
  }
  if (input.tags && input.tags.length > MAX_TAGS) {
    errors.push(`tags must not exceed ${MAX_TAGS}`);
  }
  for (const tag of input.tags ?? []) {
    if (tag.length > MAX_TAG_LENGTH) {
      errors.push(`tag "${tag.slice(0, 20)}..." exceeds ${MAX_TAG_LENGTH} characters`);
    }
  }
  if (input.evidenceRefs && input.evidenceRefs.length > MAX_EVIDENCE_REFS) {
    errors.push(`evidenceRefs must not exceed ${MAX_EVIDENCE_REFS}`);
  }
  if (input.artifactRefs && input.artifactRefs.length > MAX_ARTIFACT_REFS) {
    errors.push(`artifactRefs must not exceed ${MAX_ARTIFACT_REFS}`);
  }

  return errors;
}

// ─── Artifact validation ────────────────────────────────────────────

export function validatePublishArtifactInput(input: PublishArtifactInput, cwd: string): string[] {
  const errors: string[] = [];

  if (!input.uri || input.uri.length === 0) {
    errors.push("uri is required");
  } else {
    // Reject absolute paths
    if (isAbsolute(input.uri)) {
      errors.push("uri must not be an absolute path");
    }
    // Reject traversal
    const resolved = resolve(cwd, input.uri);
    const rel = relative(cwd, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      errors.push("uri must remain inside workspace");
    }
  }

  if (input.sizeBytes !== undefined && input.sizeBytes < 0) {
    errors.push("sizeBytes must not be negative");
  }

  return errors;
}

// ─── Canonicalization ───────────────────────────────────────────────

export function canonicalizeFindingInput(input: PublishFindingInput): PublishFindingInput {
  return {
    ...input,
    tags: [...(input.tags ?? [])].sort(),
    evidenceRefs: [...(input.evidenceRefs ?? [])].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ),
    artifactRefs: [...(input.artifactRefs ?? [])].sort(),
  };
}
