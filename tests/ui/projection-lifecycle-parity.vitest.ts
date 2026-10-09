/**
 * Lifecycle vocabulary parity (issue #878).
 *
 * `src/interfaces/ui/projection.js` has no build pipeline (copied verbatim
 * to dist), so it cannot import the TS event constants. This test is the
 * bridge: every lifecycle string the browser matches must exist in the
 * canonical `AGENT_LIFECYCLE_EVENT_TYPES` / `SUBAGENT_EVENT_TYPES`
 * vocabularies. A rename on either side breaks loudly here, never silently
 * in the timeline.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_LIFECYCLE_EVENT_TYPES,
  SUBAGENT_EVENT_TYPES,
} from "../../src/runtime-state/events/types.js";
// @ts-expect-error plain-JS browser module without TypeScript declarations
import { AGENT_LIFECYCLE_TYPES, SUBAGENT_FAILURE_TYPES, SUBAGENT_START_TYPES, SUBAGENT_SUCCESS_TYPES } from "../../src/interfaces/ui/projection.js";

const agentValues = new Set(Object.values(AGENT_LIFECYCLE_EVENT_TYPES));
const subagentValues = new Set(Object.values(SUBAGENT_EVENT_TYPES));

function assertKnown(
  set: Set<string>,
  known: Set<string>,
  label: string,
): void {
  for (const type of set) {
    expect(
      known.has(type),
      `${label} carries an uncatalogued lifecycle string: ${type}`,
    ).toBe(true);
  }
}

describe("lifecycle vocabulary parity (TS constants <-> browser projection)", () => {
  it("matches only catalogued agent.* lifecycle events", () => {
    assertKnown(AGENT_LIFECYCLE_TYPES, agentValues, "AGENT_LIFECYCLE_TYPES");
  });

  it("matches only catalogued subagent.* legacy events", () => {
    const known = new Set<string>([...agentValues, ...subagentValues]);
    assertKnown(SUBAGENT_START_TYPES, known, "SUBAGENT_START_TYPES");
    assertKnown(SUBAGENT_SUCCESS_TYPES, known, "SUBAGENT_SUCCESS_TYPES");
    assertKnown(SUBAGENT_FAILURE_TYPES, known, "SUBAGENT_FAILURE_TYPES");
  });

  it("covers the exact canonical subagent timeline vocabulary", () => {
    expect(AGENT_LIFECYCLE_TYPES).toEqual(
      new Set([
        AGENT_LIFECYCLE_EVENT_TYPES.SPAWNED,
        AGENT_LIFECYCLE_EVENT_TYPES.STATE_CHANGED,
        AGENT_LIFECYCLE_EVENT_TYPES.COMPLETED,
        AGENT_LIFECYCLE_EVENT_TYPES.FAILED,
        AGENT_LIFECYCLE_EVENT_TYPES.CANCELLED,
      ]),
    );
    expect(SUBAGENT_START_TYPES).toEqual(
      new Set([SUBAGENT_EVENT_TYPES.STARTED, AGENT_LIFECYCLE_EVENT_TYPES.SPAWNED]),
    );
    expect(SUBAGENT_SUCCESS_TYPES).toEqual(
      new Set([SUBAGENT_EVENT_TYPES.COMPLETED, AGENT_LIFECYCLE_EVENT_TYPES.COMPLETED]),
    );
    expect(SUBAGENT_FAILURE_TYPES).toEqual(
      new Set([
        SUBAGENT_EVENT_TYPES.FAILED,
        AGENT_LIFECYCLE_EVENT_TYPES.FAILED,
        AGENT_LIFECYCLE_EVENT_TYPES.CANCELLED,
      ]),
    );
  });
});
