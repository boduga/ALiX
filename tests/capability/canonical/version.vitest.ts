import { describe, it, expect } from "vitest";
import {
  isValidVersion, parseVersion, formatVersionId, parseVersionId, compareVersions, bumpVersion,
} from "../../../src/capability/canonical/version.js";

describe("Capability versioning (SemVer)", () => {
  it("accepts full SemVer only", () => {
    expect(isValidVersion("1.0.0")).toBe(true);
    expect(isValidVersion("0.0.1")).toBe(true);
    expect(isValidVersion("10.2.30")).toBe(true);
    expect(isValidVersion("1.0")).toBe(false);       // short form rejected (#479)
    expect(isValidVersion("1")).toBe(false);
    expect(isValidVersion("v1.0.0")).toBe(false);
    expect(isValidVersion("1.0.0-beta")).toBe(false); // pre-release out of CAP-1 scope
    expect(isValidVersion("")).toBe(false);
  });
  it("parses components", () => {
    expect(parseVersion("2.3.4")).toEqual({ major: 2, minor: 3, patch: 4 });
  });
  it("round-trips id@version", () => {
    expect(formatVersionId("tool.file.read", "1.0.0")).toBe("tool.file.read@1.0.0");
    expect(parseVersionId("tool.file.read@1.0.0")).toEqual({ id: "tool.file.read", version: "1.0.0" });
  });
  it("orders versions", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("bumps versions", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
});
