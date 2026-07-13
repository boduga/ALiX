// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Git Observation Provider.
 *
 * Observes repository state: branch name, diff stats, file listing,
 * and clean status. Never mutates the repository.
 *
 * @module git-provider
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// GitObservationProvider
// ---------------------------------------------------------------------------

export class GitObservationProvider implements ObservationProvider {
  readonly name = "git";
  readonly capabilities = ["git"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const check = (params?.check as string) ?? "branch";
    const cwd = (params?.cwd as string) ?? process.cwd();

    try {
      switch (check) {
        case "branch": {
          const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 10_000 });
          const branch = stdout.trim();
          return this.buildResult(observation, branch, { check, branch });
        }

        case "diff": {
          const { stdout } = await execFileAsync("git", ["diff", "--stat"], { cwd, timeout: 10_000 });
          const filesChanged = stdout.trim() ? stdout.trim().split("\n").length : 0;
          return this.buildResult(observation, filesChanged, { check, filesChanged, diff: stdout.trim() });
        }

        case "files": {
          const { stdout } = await execFileAsync("git", ["ls-files"], { cwd, timeout: 10_000 });
          const files = stdout.trim().split("\n").filter(Boolean);
          return this.buildResult(observation, files.length, { check, files });
        }

        case "clean": {
          const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 10_000 });
          const isClean = stdout.trim().length === 0;
          return this.buildResult(observation, isClean, { check, isClean, porcelain: stdout.trim() });
        }

        default:
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: { errorType: "environment_failure", message: `Unknown check type: ${check}` },
          };
      }
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: nodeErr.code === "ENOENT" ? "environment_failure" : "provider_exception",
          message: (err as Error).message ?? String(err),
          code: nodeErr.code,
        },
      };
    }
  }

  private buildResult(
    observation: Observation,
    observed: unknown,
    evidence: Record<string, unknown>,
  ): ObservationResult {
    const expected = observation.expected;
    let status: "pass" | "fail" | "error" | "inconclusive";

    if (expected !== undefined) {
      status = observed === expected ? "pass" : "fail";
    } else {
      status = "pass";
    }

    return {
      observationId: observation.observationId,
      status,
      confidence: 1.0,
      observedAt: new Date().toISOString(),
      expected,
      observed,
      evidence,
    };
  }
}
