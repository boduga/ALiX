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
import { buildObservationResult } from "./shared.js";

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
          return buildObservationResult(observation, branch, { check, branch });
        }

        case "diff": {
          const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd, timeout: 10_000 });
          const files = stdout.trim().split("\n").filter(Boolean);
          const filesChanged = files.length;
          return buildObservationResult(observation, filesChanged, { check, filesChanged, files });
        }

        case "files": {
          const { stdout } = await execFileAsync("git", ["ls-files"], { cwd, timeout: 10_000 });
          const files = stdout.trim().split("\n").filter(Boolean);
          return buildObservationResult(observation, files.length, { check, files });
        }

        case "clean": {
          const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 10_000 });
          const isClean = stdout.trim().length === 0;
          return buildObservationResult(observation, isClean, { check, isClean, porcelain: stdout.trim() });
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

}
