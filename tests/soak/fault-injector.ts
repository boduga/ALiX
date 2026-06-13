/**
 * fault-injector.ts — Utilities for injecting faults into ALiX storage files.
 *
 * All functions write to paths that match the real storage locations:
 *   .alix/approvals/approvals.json
 *   .alix/approvals/continuations.json
 *   .alix/sessions/<id>/events.jsonl
 *   .alix/daemon-tasks.json
 *
 * Precondition: the .alix directory and parent directories already exist.
 * Use writeFileSync to create a valid baseline before corrupting.
 */

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Write a truncated (incomplete) JSON value to a file. */
export function writePartialJson(filePath: string): void {
  writeFileSync(filePath, `[{"id": "incomplete"`, "utf-8");
}

/** Write valid JSON then append trailing garbage. Requires baseline first. */
export function corruptJsonWithTrailingGarbage(filePath: string): void {
  const original = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "[]";
  writeFileSync(filePath, original + '\n"TRAILING_GARBAGE": true,}}]', "utf-8");
}

/** Append a partial (incomplete) JSONL line to a session events file. */
export function corruptJsonlWithPartialLine(filePath: string): void {
  appendFileSync(filePath, '{"type":"tool.started","payload":{}}\n{"type":"tool.out', "utf-8");
}

/** Write a well-formed JSONL file with one malformed line in the middle. */
export function corruptJsonlWithMalformedLine(filePath: string): void {
  appendFileSync(filePath, '{"type":"tool.started","payload":{}}\nNOT_JSON\n{"type":"tool.completed","payload":{}}\n', "utf-8");
}

/** Zero out a file. */
export function zeroOutFile(filePath: string): void {
  writeFileSync(filePath, "", "utf-8");
}

/** Write a stale PID file that references a non-running process. */
export function writeStalePid(filePath: string): void {
  writeFileSync(filePath, "9999999\n", "utf-8");
}

/** Write an orphaned (empty) socket file. */
export function writeOrphanedSocket(filePath: string): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "", "utf-8");
}

/** Ensure a storage directory exists. */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
