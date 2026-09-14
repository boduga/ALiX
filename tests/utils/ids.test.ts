import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTimestamp } from "../../src/utils/ids.js";

describe("sanitizeTimestamp (canonical, #715)", () => {
  it("strips separators but keeps date/time letters", () => {
    assert.equal(sanitizeTimestamp("2026-06-25T12:00:00.000Z"), "20260625T120000000Z");
  });

  it("strips timezone offsets and whitespace (strict)", () => {
    assert.equal(sanitizeTimestamp("2026-06-25T12:00:00+00:00"), "20260625T1200000000");
    assert.equal(sanitizeTimestamp("2026-06-25 12:00:00"), "20260625120000");
  });

  it("leaves already-safe strings untouched", () => {
    assert.equal(sanitizeTimestamp("20260625T120000000Z"), "20260625T120000000Z");
  });
});
