/**
 * P9.0f — `alix governance` CLI dispatcher.
 *
 * @module
 */

export { handleGovernanceCommand } from "./governance/main.js";
export { formatMetadata, formatTimelineLine, computeRelatedEvents } from "./governance/audit.js";
