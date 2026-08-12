// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 CLI capabilities commands.
 *
 * Per locked ruling #7: the seam reaches capability semantics EXCLUSIVELY
 * through the canonical capability service. Direct constructor invocations
 * of the platform registry / resolver types are a hard failure (axis 1 of
 * the three-axis structural sentinel). The legacy CAP-1..CAP-7 CLI
 * behaviours reach the unified service through `service.list`,
 * `service.inspect`, `service.measure`, etc. inside the delegated module.
 *
 * References to `CapabilityService` here are REQUIRED by axis 3 of the
 * three-axis structural sentinel — this is the public declaration point.
 */

import type { CapabilityService } from "../../capability/capability-service.js";

export { handleCapabilitiesCommand } from "../../evolution/capability-lifecycle/capability-lifecycle-cli.js";

/** Re-export the surface type so the CLI dispatcher can supply a service
 *  through `CapabilitiesCLIDeps` without re-importing from the canonical
 *  location. */
export type { CapabilityService };
