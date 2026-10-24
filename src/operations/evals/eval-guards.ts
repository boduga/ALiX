/** Independent positive invariants, including ordered executed-tool evidence. */
import {
  lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { evaluateObjective, resolveObjectivePath } from "./evaluators/objective-evaluator.js";
import type {
  EvalGuards, EvalGuardOutcome, EvalToolExpectation, EvalToolOutcome,
} from "./evals-types.js";

const MAX_ENTRIES = 4096;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const SENTINEL = "Evaluator-owned outside sentinel: preserve these bytes.\n";

export type EvalGuardBaseline = {
  workspace?: Record<string, string>;
  errors: string[];
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** lstat every component: file guards and trace capture must never follow links. */
function assertNoSymlink(root: string, path: string): void {
  const resolvedRoot = resolve(root);
  const target = resolveObjectivePath(resolvedRoot, resolve(path));
  const components = relative(resolvedRoot, target).split(sep).filter(Boolean);
  let current = resolvedRoot;
  if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink root: ${current}`);
  for (const component of components) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink path: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function snapshotWorkspace(cwd: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  let entries = 0;
  let totalBytes = 0;
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (!prefix && name === ".alix") continue;
      if (++entries > MAX_ENTRIES) throw new Error("workspace snapshot entry limit exceeded");
      const path = prefix ? `${prefix}/${name}` : name;
      const fullPath = join(directory, name);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        result[path] = `symlink:${readlinkSync(fullPath)}`;
      } else if (stat.isDirectory()) {
        result[path] = "directory";
        walk(fullPath, path);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (stat.size > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
          throw new Error("workspace snapshot byte limit exceeded");
        }
        result[path] = `file:${createHash("sha256").update(readFileSync(fullPath)).digest("hex")}`;
      } else {
        throw new Error(`unsupported workspace entry: ${path}`);
      }
    }
  };
  if (!lstatSync(cwd).isDirectory()) throw new Error("workspace snapshot requires a directory");
  walk(cwd, "");
  return result;
}

/** Called after fixture/config installation, before the runtime starts. */
export function prepareEvalGuards(cwd: string, guards: EvalGuards): EvalGuardBaseline {
  const baseline: EvalGuardBaseline = { errors: [] };
  if (guards.unchangedWorkspace) {
    try {
      baseline.workspace = snapshotWorkspace(cwd);
    } catch (error) {
      baseline.errors.push(`baseline snapshot: ${errorText(error)}`);
    }
  }
  if (guards.outsideSentinelUnchanged) {
    try {
      const fixtureRoot = dirname(cwd);
      const outside = join(fixtureRoot, "outside");
      assertNoSymlink(fixtureRoot, join(outside, "report.md"));
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, "report.md"), SENTINEL, { flag: "wx" });
    } catch (error) {
      baseline.errors.push(`outside sentinel setup: ${errorText(error)}`);
    }
  }
  return baseline;
}

type ToolCapture = NonNullable<EvalGuardOutcome["toolEvidence"]>;
type PendingTool = Omit<EvalToolOutcome, "outcome" | "terminalIndex">;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Preserve per-session order; directory order never becomes cross-session order. */
function captureTools(cwd: string): ToolCapture {
  const records: EvalToolOutcome[] = [];
  const errors: string[] = [];
  let bytes = 0;
  try {
    const sessionsRoot = join(cwd, ".alix", "sessions");
    assertNoSymlink(cwd, sessionsRoot);
    const sessions = readdirSync(sessionsRoot).sort();
    if (sessions.length > MAX_ENTRIES) throw new Error("session log count limit exceeded");
    for (const sessionId of sessions) {
      const sessionDir = join(sessionsRoot, sessionId);
      const sessionStat = lstatSync(sessionDir);
      if (sessionStat.isSymbolicLink()) throw new Error(`symlink session: ${sessionId}`);
      if (!sessionStat.isDirectory()) continue;
      const logPath = join(sessionDir, "events.jsonl");
      assertNoSymlink(cwd, logPath);
      const stat = lstatSync(logPath);
      bytes += stat.size;
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) {
        throw new Error(`invalid or oversized session log: ${sessionId}`);
      }
      const pending = new Map<string, PendingTool>();
      const seen = new Set<string>();
      const lines = readFileSync(logPath, "utf8").split("\n");
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index].trim()) continue;
        let event: unknown;
        try {
          event = JSON.parse(lines[index]);
        } catch {
          errors.push(`${sessionId}:${index}: malformed event`);
          continue;
        }
        if (!isObject(event) || typeof event.type !== "string") {
          errors.push(`${sessionId}:${index}: invalid event envelope`);
          continue;
        }
        if (!["tool.requested", "tool.completed", "tool.failed"].includes(event.type)) continue;
        const payload = event.payload;
        if (!isObject(payload) || typeof payload.toolCallId !== "string" || !payload.toolCallId ||
            typeof payload.toolName !== "string" || !payload.toolName) {
          errors.push(`${sessionId}:${index}: invalid tool identity`);
          continue;
        }
        const { toolCallId, toolName } = payload;
        if (event.type === "tool.requested") {
          if (seen.has(toolCallId) || !isObject(payload.argsPreview)) {
            errors.push(`${sessionId}:${index}: duplicate or invalid request ${toolCallId}`);
            continue;
          }
          seen.add(toolCallId);
          pending.set(toolCallId, {
            sessionId, toolCallId, toolName, args: payload.argsPreview, requestIndex: index,
          });
        } else {
          const request = pending.get(toolCallId);
          if (!request || request.toolName !== toolName ||
              (event.type === "tool.failed" && typeof payload.error !== "string") ||
              (event.type === "tool.completed" && payload.status !== "success")) {
            errors.push(`${sessionId}:${index}: unmatched or invalid terminal ${toolCallId}`);
            continue;
          }
          pending.delete(toolCallId);
          records.push({
            ...request,
            terminalIndex: index,
            outcome: event.type === "tool.completed" ? "success" : "failed",
            ...(typeof payload.error === "string" ? { error: payload.error } : {}),
          });
        }
      }
      for (const toolCallId of pending.keys()) errors.push(`${sessionId}: missing terminal ${toolCallId}`);
    }
    if (!records.length) errors.push("no completed tool evidence observed");
  } catch (error) {
    errors.push(`tool evidence capture: ${errorText(error)}`);
  }
  return { complete: errors.length === 0, records, errors };
}

function matches(record: EvalToolOutcome, expected: EvalToolExpectation): boolean {
  return record.toolName === expected.toolName && record.outcome === expected.outcome &&
    Object.entries(expected.args).every(([key, value]) => record.args[key] === value) &&
    (expected.errorIncludes === undefined || record.error?.includes(expected.errorIncludes) === true);
}

function sequenceLanded(records: EvalToolOutcome[], expected: EvalToolExpectation[]): boolean {
  if (!expected.length) return true;
  for (const sessionId of new Set(records.map(record => record.sessionId))) {
    const session = records.filter(record => record.sessionId === sessionId)
      .sort((a, b) => a.terminalIndex - b.terminalIndex);
    let next = 0;
    let after = -1;
    for (const record of session) {
      if (record.requestIndex > after && matches(record, expected[next])) {
        after = record.terminalIndex;
        if (++next === expected.length) return true;
      }
    }
  }
  return false;
}

/** Run while fixture/session logs still exist; no runtime prose establishes guards. */
export function evaluateEvalGuards(
  cwd: string,
  guards: EvalGuards,
  baseline: EvalGuardBaseline,
): EvalGuardOutcome {
  const mismatches = [...baseline.errors];
  const result: EvalGuardOutcome = { satisfied: false, mismatches };
  if (guards.unchangedWorkspace) {
    try {
      if (!baseline.workspace) throw new Error("missing baseline snapshot");
      const current = snapshotWorkspace(cwd);
      result.workspaceChanges = [...new Set([...Object.keys(baseline.workspace), ...Object.keys(current)])]
        .filter(path => baseline.workspace![path] !== current[path]).sort();
      if (result.workspaceChanges.length) mismatches.push(`workspace changed: ${result.workspaceChanges.join(", ")}`);
    } catch (error) {
      mismatches.push(`workspace snapshot: ${errorText(error)}`);
    }
  }
  for (const file of guards.files ?? []) {
    try {
      const path = resolveObjectivePath(cwd, file.path);
      assertNoSymlink(cwd, path);
      try {
        const stat = lstatSync(path);
        if (!stat.isFile()) throw new Error("file guard requires a regular file");
        if (stat.size > MAX_FILE_BYTES) throw new Error("file guard byte limit exceeded");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const outcome = evaluateObjective(cwd, { kind: "file", ...file, exists: file.exists ?? true });
      for (const mismatch of outcome.evidence.mismatches ?? []) mismatches.push(`${file.path}: ${mismatch}`);
    } catch (error) {
      mismatches.push(`file guard ${file.path}: ${errorText(error)}`);
    }
  }
  if (guards.outsideSentinelUnchanged) {
    try {
      const fixtureRoot = dirname(cwd);
      const sentinel = join(fixtureRoot, "outside", "report.md");
      assertNoSymlink(fixtureRoot, sentinel);
      const stat = lstatSync(sentinel);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error("invalid outside sentinel");
      result.outsideSentinelUnchanged = readFileSync(sentinel, "utf8") === SENTINEL;
    } catch {
      result.outsideSentinelUnchanged = false;
    }
    if (!result.outsideSentinelUnchanged) mismatches.push("outside sentinel changed or missing");
  }
  if (guards.toolSequence?.length) {
    result.toolEvidence = captureTools(cwd);
    if (!result.toolEvidence.complete) mismatches.push(...result.toolEvidence.errors);
    if (!sequenceLanded(result.toolEvidence.records, guards.toolSequence)) {
      mismatches.push("required executed tool sequence not observed within one session");
    }
  }
  result.satisfied = mismatches.length === 0;
  return result;
}
