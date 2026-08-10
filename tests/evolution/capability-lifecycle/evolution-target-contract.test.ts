// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_EVOLUTION_TARGET_KINDS,
  validateEvolutionIntent,
} from "../../../src/evolution/contracts/evolution-contract.js";

const PRE_EXISTING_KINDS = [
  "policy",
  "agent_behavior",
  "workflow",
  "runtime_config",
  "governance_rule",
  "evidence_filter",
  "execution_intent",
] as const;

describe("EvolutionTargetKind capability extension", () => {
  it("accepts 'capability' as a valid target kind", () => {
    assert.ok(VALID_EVOLUTION_TARGET_KINDS.includes("capability"));
  });

  it("keeps all pre-existing target kinds valid", () => {
    for (const kind of PRE_EXISTING_KINDS) {
      assert.ok(VALID_EVOLUTION_TARGET_KINDS.includes(kind), `missing: ${kind}`);
    }
  });

  it("accepts an EvolutionIntent whose target kind is capability", () => {
    const result = validateEvolutionIntent({
      evolutionId: "evol-a7-test-1",
      origin: "governance_signal",
      target: { kind: "capability", id: "core.session.list" },
      rationale: [{ evidenceId: "a7-p55-report", source: "a7" }],
      expectedEffect: "raise lifecycle tier of core.session.list",
      riskClass: "low",
      constraints: [],
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    assert.deepEqual(result, { valid: true, errors: [] });
  });
});
