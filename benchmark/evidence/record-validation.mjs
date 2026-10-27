/**
 * record-validation.mjs — shared helpers for the gate validators.
 *
 * Both `gate-e-qualification-record.mjs` and `release-clearance-record.mjs` had
 * their own `nonEmpty`, ISO check, identity normaliser and CLI bootstrap. That is
 * the duplication that lets two validators drift: a fix applied to one signature
 * check silently leaves the other weak, and the weaker one is the real gate.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where a record's cited paths resolve from. Explicit, never guessed. */
export const PATH_BASES = ['record', 'repo-root'];

export function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isIsoTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Case and spacing are not distinctions when deciding "same party". */
export function normalizeIdentity(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/**
 * Resolve a cited path.
 *
 * A record must SAY which base it uses, because a silent guess either rejects
 * valid citations or accepts nonexistent ones — and both look like a working
 * check.
 */
export function resolveCited(cited, baseDir, pathBase) {
  return pathBase === 'repo-root' ? resolve(cited) : resolve(baseDir, cited);
}

/**
 * Every cited evidence path must exist.
 *
 * A citation to nothing is not evidence.
 */
export function checkEvidenceFiles(label, list, baseDir, pathBase, problems) {
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${label} is required: a decision must cite the artifact a third party can re-read`);
    return;
  }
  for (const entry of list) {
    if (!nonEmpty(entry)) {
      problems.push(`${label} contains an empty path`);
    } else if (pathBase && !existsSync(resolveCited(entry, baseDir, pathBase))) {
      problems.push(`${label} cites a path that does not exist: ${entry}`);
    }
  }
}

/**
 * The signing artifact must NAME the signer.
 *
 * A record that points at a blank signature block is pointing at an unsigned gap.
 */
export function checkSignerNamed(label, list, identity, baseDir, pathBase, problems) {
  if (!nonEmpty(identity) || !Array.isArray(list)) return;
  const readable = list.filter(
    (entry) => nonEmpty(entry) && pathBase && existsSync(resolveCited(entry, baseDir, pathBase)),
  );
  if (readable.length === 0) return;
  const named = readable.some((entry) => {
    try {
      return readFileSync(resolveCited(entry, baseDir, pathBase), 'utf-8').includes(identity.trim());
    } catch {
      return false;
    }
  });
  if (!named) problems.push(`${label} does not contain the named signer: ${identity.trim()}`);
}

/**
 * Run a validator CLI: read, parse, validate, print, set the exit code.
 *
 * Exit codes are supplied by the caller because they carry meaning: an exit code
 * that collapses "the record is valid" into "the gate is cleared" is the defect
 * both validators had.
 */
export function runRecordCli({ argv, usage, render, validate, exitCodeFor }) {
  const path = argv[2];
  if (!path) {
    process.stderr.write(`usage: ${usage}\n`);
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(resolve(path), 'utf-8');
  } catch {
    process.stderr.write(`cannot read record: ${path}\n`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`record is not valid JSON: ${String(error)}\n`);
    process.exit(2);
  }
  const result = validate(parsed, { baseDir: dirname(resolve(path)) });
  process.stdout.write(render(result) + '\n');
  process.exitCode = exitCodeFor(result);
}

/** True when this module was invoked as the CLI entry point. */
export function isEntryPoint(importMetaUrl, argv) {
  return Boolean(argv[1]) && importMetaUrl === pathToFileURL(resolve(argv[1])).href;
}
