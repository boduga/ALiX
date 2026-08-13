// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 9 — `alix capability measure <id@version>` CLI command.
 *
 * Routes through `service.measure()` exclusively (ruling #11).
 * Exit codes:
 *   0 — success
 *   2 — usage error
 *   3 — CapabilityMeasureFailedError
 *   4 — CapabilityMeasureInvalidTargetError
 *   5 — CapabilityServiceNotImplementedError or service absent
 *
 * This is a THIN ADAPTER (ruling #11). No measurement logic, no projection
 * logic, no outcome computation — the CLI hands the request to
 * `service.measure()` and serializes the result.
 *
 * @module cli/commands/capability-measure
 */

import type { CapabilityService } from "../../capability/capability-service.js";
import { CapabilityMeasureFailedError } from "../../capability/errors/measure-failed.js";
import { CapabilityMeasureInvalidTargetError } from "../../capability/errors/measure-invalid-target.js";
import { CapabilityServiceNotImplementedError } from "../../capability/errors/service-not-implemented.js";

const USAGE = `Usage: alix capability measure <id@version> [--baseline <observation-id>]`;

export interface CapabilityMeasureCommandOptions {
  readonly service: CapabilityService | undefined;
}

export async function capabilityMeasureCommand(
  args: string[],
  opts: CapabilityMeasureCommandOptions,
): Promise<number> {
  const rest = [...args];
  const targetArg = rest[0];
  if (!targetArg || !targetArg.includes("@")) {
    console.error(USAGE);
    return 2;
  }

  const [capabilityId, version] = targetArg.split("@", 2);
  if (!capabilityId || !version) {
    console.error(USAGE);
    return 2;
  }

  const service = opts.service;
  if (!service) {
    console.error("CapabilityService not supplied — CLI dispatcher contract violated.");
    return 5;
  }

  let baselineObservationId: string | undefined;
  const baselineFlag = rest.find((a) => a.startsWith("--baseline="));
  if (baselineFlag) {
    baselineObservationId = baselineFlag.split("=")[1];
  } else {
    const baselineIndex = rest.indexOf("--baseline");
    if (baselineIndex >= 0 && rest[baselineIndex + 1]) {
      baselineObservationId = rest[baselineIndex + 1]!;
    }
  }

  try {
    const result = await service.measure({
      capabilityId,
      version,
      ...(baselineObservationId !== undefined ? { baselineObservationId } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof CapabilityServiceNotImplementedError) {
      console.error(`measure() not implemented: ${err.message}`);
      return 5;
    }
    if (err instanceof CapabilityMeasureInvalidTargetError) {
      console.error(`Invalid target: ${err.message}`);
      return 4;
    }
    if (err instanceof CapabilityMeasureFailedError) {
      console.error(`Measurement failed: ${err.message}`);
      return 3;
    }
    throw err;
  }
}

/** USAGE text — exported for help/listing. */
export const CAPABILITY_MEASURE_USAGE = USAGE;
