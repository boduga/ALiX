// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────

import type { ALiXContext, ContextTransfer } from "../../src/runtime/contracts/context-contract.js";
import { CONTEXT_INVARIANTS } from "../../src/runtime/contracts/context-contract.js";

// ── Tests ───────────────────────────────────────────────────────

describe("M1.5 — Context Contract", () => {
  // ── ALiXContext ──────────────────────────────────────────────

  it("ALiXContext has all required fields", () => {
    const ctx: ALiXContext = {
      contextId: "ctx-001",
      kind: "task",
      ownerId: "agent-alpha",
      createdBy: "agent-alpha",
      createdAt: "2026-07-10T12:00:00.000Z",
      data: { goal: "implement feature X" },
    };

    assert.equal(typeof ctx.contextId, "string");
    assert.equal(ctx.contextId, "ctx-001");

    assert.equal(typeof ctx.kind, "string");
    assert.equal(ctx.kind, "task");

    assert.equal(typeof ctx.ownerId, "string");
    assert.equal(ctx.ownerId, "agent-alpha");

    assert.equal(typeof ctx.createdBy, "string");
    assert.equal(ctx.createdBy, "agent-alpha");

    assert.equal(typeof ctx.createdAt, "string");
    assert.equal(ctx.createdAt, "2026-07-10T12:00:00.000Z");

    assert.equal(typeof ctx.data, "object");
    assert.ok(ctx.data !== null);
    assert.equal(ctx.data.goal, "implement feature X");
  });

  it("ALiXContext kind accepts all four valid values", () => {
    const kinds: ALiXContext["kind"][] = ["task", "session", "execution", "governance"];
    assert.equal(kinds.length, 4);

    for (const kind of kinds) {
      const ctx: ALiXContext = {
        contextId: "ctx-kind-test",
        kind,
        ownerId: "test-agent",
        createdBy: "test-agent",
        createdAt: "2026-07-10T12:00:00.000Z",
        data: {},
      };
      assert.equal(ctx.kind, kind);
    }
  });

  it("ALiXContext parentContextId is optional", () => {
    // Without parentContextId
    const ctx: ALiXContext = {
      contextId: "ctx-root",
      kind: "session",
      ownerId: "agent-beta",
      createdBy: "agent-beta",
      createdAt: "2026-07-10T12:00:00.000Z",
      data: {},
    };
    assert.equal(ctx.parentContextId, undefined);

    // With parentContextId
    const child: ALiXContext = {
      contextId: "ctx-child",
      kind: "execution",
      ownerId: "agent-beta",
      parentContextId: "ctx-root",
      createdBy: "agent-beta",
      createdAt: "2026-07-10T12:00:01.000Z",
      data: {},
    };
    assert.equal(child.parentContextId, "ctx-root");
  });

  it("ALiXContext data accepts arbitrary payloads", () => {
    const withComplexData: ALiXContext = {
      contextId: "ctx-data-test",
      kind: "governance",
      ownerId: "governance-service",
      createdBy: "governance-service",
      createdAt: "2026-07-10T12:00:00.000Z",
      data: {
        rule: "no-mutation-without-approval",
        priority: 1,
        tags: ["security", "governance"],
      },
    };

    assert.equal(withComplexData.kind, "governance");
    assert.equal(withComplexData.data.rule, "no-mutation-without-approval");
    assert.equal(withComplexData.data.priority, 1);
    assert.ok(Array.isArray(withComplexData.data.tags));
    assert.equal(withComplexData.data.tags.length, 2);
  });

  // ── ContextTransfer ──────────────────────────────────────────

  it("ContextTransfer preserves origin and target agent IDs", () => {
    const transfer: ContextTransfer = {
      contextId: "ctx-001",
      fromAgentId: "agent-alpha",
      toAgentId: "agent-beta",
      transferredAt: "2026-07-10T12:00:00.000Z",
      includesData: ["goal", "scope"],
    };

    assert.equal(typeof transfer.contextId, "string");
    assert.equal(transfer.contextId, "ctx-001");

    assert.equal(typeof transfer.fromAgentId, "string");
    assert.equal(transfer.fromAgentId, "agent-alpha");

    assert.equal(typeof transfer.toAgentId, "string");
    assert.equal(transfer.toAgentId, "agent-beta");

    assert.equal(typeof transfer.transferredAt, "string");
    assert.equal(transfer.transferredAt, "2026-07-10T12:00:00.000Z");

    assert.ok(Array.isArray(transfer.includesData));
    assert.equal(transfer.includesData.length, 2);
    assert.ok(transfer.includesData.includes("goal"));
    assert.ok(transfer.includesData.includes("scope"));
  });

  it("ContextTransfer fromAgentId and toAgentId are distinct by design", () => {
    const transfer: ContextTransfer = {
      contextId: "ctx-transfer-distinct",
      fromAgentId: "sender-agent",
      toAgentId: "receiver-agent",
      transferredAt: "2026-07-10T12:00:00.000Z",
      includesData: [],
    };

    assert.notEqual(
      transfer.fromAgentId,
      transfer.toAgentId,
      "fromAgentId and toAgentId should be distinct for a meaningful transfer",
    );
  });

  it("ContextTransfer includesData can be empty", () => {
    const transfer: ContextTransfer = {
      contextId: "ctx-empty-transfer",
      fromAgentId: "agent-alpha",
      toAgentId: "agent-beta",
      transferredAt: "2026-07-10T12:00:00.000Z",
      includesData: [],
    };

    assert.ok(Array.isArray(transfer.includesData));
    assert.equal(transfer.includesData.length, 0);
  });

  // ── CONTEXT_INVARIANTS ───────────────────────────────────────

  it("CONTEXT_INVARIANTS documents all invariants", () => {
    assert.equal(CONTEXT_INVARIANTS.immutableIdentity, true);
    assert.equal(CONTEXT_INVARIANTS.kindFidelity, true);
    assert.equal(CONTEXT_INVARIANTS.ownerAccountability, true);
    assert.equal(CONTEXT_INVARIANTS.transferTraceability, true);
  });
});
