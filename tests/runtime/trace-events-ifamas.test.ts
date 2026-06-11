import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTraceEvent } from "../../src/runtime/trace-events.js";

describe("IFÁ-MAS trace event normalization", () => {
  it("converts ifamas.diagnostic event to TraceEvent with sourceType 'ifamas'", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "00000000",
        polarity: "neutral",
        offeringAction: "proceed",
        routeTarget: "guild",
        gatewayValid: true,
        guildCandidateCount: 2,
        chronicleRefCount: 0,
      },
    });
    assert.ok(event);
    assert.equal(event!.sourceType, "ifamas");
    assert.equal(event!.eventType, "ifamas.diagnostic");
  });

  it("includes ifamasPayload with all fields", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "11111111",
        polarity: "ibi",
        offeringAction: "ask_approval",
        routeTarget: "caller",
        gatewayValid: false,
        guildCandidateCount: 1,
        chronicleRefCount: 3,
      },
    });
    assert.ok(event);
    assert.ok(event!.ifamasPayload);
    assert.equal(event!.ifamasPayload!.signalCode, "11111111");
    assert.equal(event!.ifamasPayload!.polarity, "ibi");
    assert.equal(event!.ifamasPayload!.offeringAction, "ask_approval");
    assert.equal(event!.ifamasPayload!.routeTarget, "caller");
    assert.equal(event!.ifamasPayload!.gatewayValid, false);
    assert.equal(event!.ifamasPayload!.guildCandidateCount, 1);
    assert.equal(event!.ifamasPayload!.chronicleRefCount, 3);
  });

  it("handles missing optional fields gracefully", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "10101010",
        polarity: "mixed",
        offeringAction: "pause",
        gatewayValid: true,
      },
    });
    assert.ok(event);
    assert.ok(event!.ifamasPayload);
    assert.equal(event!.ifamasPayload!.routeTarget, undefined);
    assert.equal(event!.ifamasPayload!.guildCandidateCount, 0);
    assert.equal(event!.ifamasPayload!.chronicleRefCount, 0);
  });

  it("sets label and detail from payload", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "01010101",
        polarity: "ire",
        offeringAction: "proceed",
        gatewayValid: true,
        guildCandidateCount: 0,
        chronicleRefCount: 0,
      },
    });
    assert.ok(event);
    assert.ok(event!.label.startsWith("ifamas:"));
    assert.ok(event!.detail?.includes("proceed"));
    assert.equal(event!.status, "completed");
  });
});
