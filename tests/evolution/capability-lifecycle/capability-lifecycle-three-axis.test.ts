// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_GOVERNANCE_STATUSES,
} from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";
import type {
  CapabilityRuntimeState,
  CapabilityGovernanceStatus,
} from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

const ALL_GOVERNANCE_STATUSES: readonly string[] = [
  "none", "proposed", "approved", "rejected", "applied", "measured",
];

describe("CapabilityGovernanceStatus (CAP-5 fourth axis)", () => {
  it("has exactly the six governance statuses", () => {
    assert.deepEqual([...CAPABILITY_GOVERNANCE_STATUSES].sort(), [...ALL_GOVERNANCE_STATUSES].sort());
  });

  it("does NOT include APPROVED_PENDING_APPLICATION (deletion = CAP-11)", () => {
    assert.equal(CAPABILITY_GOVERNANCE_STATUSES.includes("APPROVED_PENDING_APPLICATION" as CapabilityGovernanceStatus), false);
  });

  it("is typed as a union of the six literals", () => {
    const s: CapabilityGovernanceStatus = "approved";
    assert.equal(s, "approved");
  });
});

describe("CapabilityRuntimeState (three independent axes)", () => {
  // Minimal structural objects — the axes must be independently representable.
  it("allows deprecated + available (deprecated is terminal, not unavailable)", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "deprecated", availability: { available: true } } as unknown as CapabilityRuntimeState;
    assert.equal(state.lifecycle, "deprecated");
    assert.equal(state.availability.available, true);
  });

  it("allows active + unavailable (availability is never a lifecycle change)", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "active", availability: { available: false, reason: "provider_unavailable" } } as unknown as CapabilityRuntimeState;
    assert.equal(state.lifecycle, "active");
    assert.equal(state.availability.available, false);
  });

  it("allows emerging + available (unbound is availability, not dormant)", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "emerging", availability: { available: true } } as unknown as CapabilityRuntimeState;
    assert.equal(state.lifecycle, "emerging");
  });

  it("keeps definition / lifecycle / availability as distinct keys", () => {
    const state: CapabilityRuntimeState = { definition: {} as never, lifecycle: "active", availability: { available: true } } as unknown as CapabilityRuntimeState;
    assert.deepEqual(Object.keys(state).sort(), ["availability", "definition", "lifecycle"]);
  });
});
