// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * A5.1 — Filesystem Observation Provider.
 *
 * Observes filesystem state: file existence, content hashes, and stat
 * metadata. Never mutates the filesystem.
 *
 * @module filesystem-provider
 */

import { access, stat, readFile, constants } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { Observation, ObservationResult, ObservationProvider } from "../contracts/observation-contract.js";
import { buildObservationResult } from "./shared.js";

// ---------------------------------------------------------------------------
// FilesystemObservationProvider
// ---------------------------------------------------------------------------

export class FilesystemObservationProvider implements ObservationProvider {
  readonly name = "filesystem";
  readonly capabilities = ["filesystem"];

  async observe(observation: Observation): Promise<ObservationResult> {
    const params = observation.params as Record<string, unknown> | undefined;
    const path = params?.path as string | undefined;
    const check = (params?.check as string) ?? "exists";

    if (!path || typeof path !== "string") {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: { errorType: "environment_failure", message: "path parameter required" },
      };
    }

    try {
      switch (check) {
        case "exists": {
          let exists = true;
          try {
            await access(path, constants.F_OK);
          } catch {
            exists = false;
            // If parent directory is also inaccessible, the path is
            // fundamentally invalid — signal an environment error.
            try {
              await access(dirname(path), constants.F_OK);
            } catch {
              return {
                observationId: observation.observationId,
                status: "error",
                confidence: 0,
                observedAt: new Date().toISOString(),
                evidence: { errorType: "environment_failure", message: "Cannot access path", path },
              };
            }
          }
          return buildObservationResult(observation, exists, { path, check, exists });
        }

        case "hash": {
          const content = await readFile(path);
          const hash = createHash("sha256").update(content).digest("hex");
          return buildObservationResult(observation, hash, { path, check, hash });
        }

        case "stat": {
          const stats = await stat(path);
          const statInfo = {
            size: stats.size,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            mtimeMs: stats.mtimeMs,
            mode: stats.mode,
          };
          return buildObservationResult(observation, statInfo.size, { path, check, ...statInfo });
        }

        default:
          return {
            observationId: observation.observationId,
            status: "error",
            confidence: 0,
            observedAt: new Date().toISOString(),
            evidence: { errorType: "environment_failure", message: `Unknown check type: ${check}`, path },
          };
      }
    } catch (err: unknown) {
      return {
        observationId: observation.observationId,
        status: "error",
        confidence: 0,
        observedAt: new Date().toISOString(),
        evidence: {
          errorType: "environment_failure",
          message: (err as Error).message ?? String(err),
          path,
        },
      };
    }
  }

}
