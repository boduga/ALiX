// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — CLI Observation Provider.
 *
 * Observes system state by executing shell commands and capturing
 * exit codes, stdout, and stderr. Never mutates the system.
 *
 * @module cli-provider
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a successful ObservationResult from captured process output.
 */
function buildSuccess(
  observationId: string,
  command: string,
  args: readonly string[],
  exitCode: number,
  stdout: string,
  stderr: string,
  expected: unknown,
): ObservationResult {
  let confidence = 1.0;
  const hasStderr = stderr.length > 0;

  if (hasStderr) {
    confidence *= 0.9;
  }

  let status: "pass" | "fail" | "error" | "inconclusive";

  if (expected !== undefined) {
    status = exitCode === expected ? "pass" : "fail";
  } else {
    status = "pass";
  }

  return {
    observationId,
    status,
    confidence,
    observedAt: new Date().toISOString(),
    expected,
    observed: exitCode,
    evidence: { command, args, exitCode, stdout, stderr, hasStderr },
  };
}

// ---------------------------------------------------------------------------
// CliObservationProvider
// ---------------------------------------------------------------------------

export class CliObservationProvider implements ObservationProvider {
  readonly name = "cli";
  readonly capabilities = ["cli"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const command = params?.command as string | undefined;
    const args = (params?.args as string[]) ?? [];

    if (!command || typeof command !== "string" || command.trim().length === 0) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: { errorType: "environment_failure", message: "No command specified" },
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });

      // Resolved => exit code 0
      return buildSuccess(
        observation.observationId,
        command,
        args,
        0,
        stdout,
        stderr,
        observation.expected,
      );
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };

      // Non-zero exit codes surface as rejection with error.code === exitCode
      if (typeof nodeErr.code === "number") {
        const stdout = nodeErr.stdout ?? "";
        const stderr = nodeErr.stderr ?? "";

        return buildSuccess(
          observation.observationId,
          command,
          args,
          nodeErr.code,
          stdout,
          stderr,
          observation.expected,
        );
      }

      // Genuine system/environment error
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "environment_failure",
          message: nodeErr.code === "ENOENT"
            ? `Command not found: ${command}`
            : nodeErr.message ?? String(err),
          code: nodeErr.code,
        },
      };
    }
  }
}
