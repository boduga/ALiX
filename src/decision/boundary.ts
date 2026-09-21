/**
 * boundary.ts — Remote-boundary redaction/validation service (J0b).
 *
 * The Jev adapter is a remote trust boundary (hand-off §6, §10). This module
 * accepts already-projected input, gates it, and seals it for transport.
 * Only sealed projections may cross to Jev; the adapter must refuse anything
 * unsealed. Per-decision payload schemas arrive in J1–J3; these gates are the
 * backstop, not the schema.
 *
 * Fail-closed rules (JEV-2..JEV-6):
 * - Secrets rejected, never masked (JEV-3). Detection reuses the single
 *   source `redactSecrets` patterns via inequality compare, which is
 *   stateless (String.replace with /g resets lastIndex; raw .test would not).
 * - Raw ExecutionState shape rejected (JEV-2). Single keys like `objective`
 *   or `status` pass — only the full shape (>=4 contract keys) rejects.
 * - Tool-result carriers rejected (JEV-4); source-file carriers rejected (JEV-5).
 * - Oversize / over-deep / non-JSON-safe payloads rejected (JEV-6 minimum-necessary).
 */

import { createHash } from "node:crypto";
import { redactSecrets } from "../policy/secret-scanner.js";
import type { DecisionType } from "./contracts.js";

export const MAX_PROJECTION_JSON_BYTES = 64_000;
export const MAX_PROJECTION_DEPTH = 8;

/** ExecutionState contract keys (mirrors execution-state.ts, decoupled). */
export const EXECUTION_STATE_KEYS = [
  "executionId",
  "schemaVersion",
  "version",
  "step",
  "objective",
  "status",
  "intent",
  "pendingActions",
  "activeCapabilities",
  "constraints",
  "artifacts",
] as const;

/** Tool-result carrier keys (mirrors NormalizedToolResult, decoupled). */
const TOOL_RESULT_KEYS = [
  "toolUseId",
  "invocationId",
  "executionId",
  "toolCallId",
] as const;

/** Key names that never cross the remote boundary, case-insensitive. */
const PROHIBITED_KEY_SET = new Set(
  [
    // Secret/credential carriers (JEV-3)
    "apikey",
    "apikeys",
    "secret",
    "secrets",
    "token",
    "tokens",
    "password",
    "credential",
    "credentials",
    "privatekey",
    "authorization",
    "accesstoken",
    "refreshtoken",
    // Raw-state carriers (JEV-2/JEV-4/JEV-5)
    "tooloutput",
    "toolresult",
    "rawoutput",
    "rawstate",
    "executionstate",
    "sourcetext",
    "sourcefile",
    "filecontents",
    "filecontent",
  ].map((k) => k.toLowerCase()),
);

export class ProjectionRejectedError extends Error {
  readonly code = "PROJECTION_REJECTED";
  readonly reason: string;
  constructor(reason: string) {
    super(`Projection rejected at remote boundary: ${reason}`);
    this.name = "ProjectionRejectedError";
    this.reason = reason;
  }
}

/** Sealed projection. Only values produced by sealForRemote carry the brand. */
export type RemoteSealedProjection<T = unknown> = {
  readonly sealed: "remote";
  decision: DecisionType;
  projectorVersion: string;
  payload: Readonly<T>;
  hash: string;
  sealedAt: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Deterministic JSON with sorted keys. Input must be JSON-safe (inspected first). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashProjection(payload: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(payload), "utf8").digest("hex")}`;
}

function hasSecrets(value: string): boolean {
  return redactSecrets(value) !== value;
}

function walk(value: unknown, depth: number, issues: string[]): void {
  if (issues.length > 0 && issues.length >= 8) return;
  if (depth > MAX_PROJECTION_DEPTH) {
    issues.push(`exceeds max depth ${MAX_PROJECTION_DEPTH}`);
    return;
  }
  if (typeof value === "string") {
    if (hasSecrets(value)) issues.push("contains secret material");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push("non-finite number");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, issues);
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    for (const key of keys) {
      if (PROHIBITED_KEY_SET.has(key.toLowerCase())) {
        issues.push(`prohibited key: ${key}`);
        return;
      }
    }
    const stateHits = keys.filter((k) =>
      (EXECUTION_STATE_KEYS as readonly string[]).includes(k),
    ).length;
    if (stateHits >= 4) {
      issues.push("resembles raw ExecutionState");
      return;
    }
    const toolHits = keys.filter((k) =>
      (TOOL_RESULT_KEYS as readonly string[]).includes(k),
    ).length;
    if (toolHits >= 2) {
      issues.push("resembles raw tool result");
      return;
    }
    for (const key of keys) walk(value[key], depth + 1, issues);
    return;
  }
  issues.push("not JSON-safe");
}

/** Pure gate report. Empty = allowed. Never throws. */
export function inspectRemoteProjection(payload: unknown): string[] {
  const issues: string[] = [];
  if (!isPlainObject(payload)) {
    return ["projection must be a plain object"];
  }
  walk(payload, 0, issues);
  if (issues.length === 0) {
    const bytes = Buffer.byteLength(stableStringify(payload), "utf8");
    if (bytes > MAX_PROJECTION_JSON_BYTES) {
      issues.push(`exceeds max size ${MAX_PROJECTION_JSON_BYTES} bytes`);
    }
  }
  return issues;
}

/**
 * Gate + seal. Throws ProjectionRejectedError on any gate failure.
 * Projection validation failure never reaches remote transport.
 */
export function sealForRemote<T>(
  decision: DecisionType,
  projectorVersion: string,
  payload: T,
  opts?: { now?: number },
): RemoteSealedProjection<T> {
  if (typeof decision !== "string" || decision.length === 0) {
    throw new ProjectionRejectedError("decision must be a non-empty string");
  }
  if (typeof projectorVersion !== "string" || projectorVersion.length === 0) {
    throw new ProjectionRejectedError("projector version must be a non-empty string");
  }
  const issues = inspectRemoteProjection(payload);
  if (issues.length > 0) throw new ProjectionRejectedError(issues[0]);
  return {
    sealed: "remote",
    decision,
    projectorVersion,
    payload,
    hash: hashProjection(payload),
    sealedAt: opts?.now ?? Date.now(),
  };
}

/** Verify brand + hash + gates. Never throws; false = untrusted. */
export function verifySealedProjection(sealed: unknown): boolean {
  if (!isPlainObject(sealed)) return false;
  const s = sealed as Record<string, unknown>;
  if (s.sealed !== "remote") return false;
  if (typeof s.decision !== "string" || (s.decision as string).length === 0) return false;
  if (typeof s.projectorVersion !== "string" || (s.projectorVersion as string).length === 0) {
    return false;
  }
  if (typeof s.hash !== "string" || typeof s.sealedAt !== "number") return false;
  if (!Number.isFinite(s.sealedAt as number)) return false;
  if (inspectRemoteProjection(s.payload).length > 0) return false;
  return hashProjection(s.payload) === s.hash;
}
