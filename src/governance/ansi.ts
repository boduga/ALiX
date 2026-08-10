// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Minimal ANSI terminal helpers shared by the governance CLI dispatchers.
 * NO_COLOR and non-TTY output are out of scope — these are the same small
 * wrappers the evolution CLI and curation CLI each used to re-declare.
 *
 * @module governance-ansi
 */

/** Wrap `msg` in ANSI red, for error/diagnostic output. */
export function red(msg: string): string {
  return `[31m${msg}[0m`;
}

/** Wrap `msg` in ANSI bold, for section headers. */
export function bold(msg: string): string {
  return `[1m${msg}[0m`;
}
