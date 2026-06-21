import { describe, it, expect } from "vitest";
import { StrategicBriefBuilder } from "../../src/adaptation/strategic-brief.js";

describe("StrategicBriefBuilder", () => {
  it("exists and has a build method", () => {
    const b = new StrategicBriefBuilder();
    expect(typeof b.build).toBe("function");
  });
});
