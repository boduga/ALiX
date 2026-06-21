import { describe, it, expect } from "vitest";
import { assertSafePathComponent } from "../../src/security/path-assert.js";

describe("assertSafePathComponent", () => {
  it("accepts simple alphanumeric names", () => {
    expect(assertSafePathComponent("agent-42")).toBe("agent-42");
    expect(assertSafePathComponent("mySkill")).toBe("mySkill");
    expect(assertSafePathComponent("prop-2026-06-20-001")).toBe("prop-2026-06-20-001");
  });

  it("allows leading-dot names like .well-known", () => {
    expect(assertSafePathComponent(".well-known")).toBe(".well-known");
    expect(assertSafePathComponent(".internal-config")).toBe(".internal-config");
  });

  it("rejects parent directory traversal", () => {
    expect(() => assertSafePathComponent("..")).toThrow();
    expect(() => assertSafePathComponent("../foo")).toThrow();
    expect(() => assertSafePathComponent("foo/../bar")).toThrow();
  });

  it("rejects lone dot", () => {
    expect(() => assertSafePathComponent(".")).toThrow();
  });

  it("rejects forward slashes", () => {
    expect(() => assertSafePathComponent("foo/bar")).toThrow();
  });

  it("rejects backslashes", () => {
    expect(() => assertSafePathComponent("foo\\bar")).toThrow();
  });

  it("rejects null bytes", () => {
    expect(() => assertSafePathComponent("foo\0bar")).toThrow();
  });

  it("rejects empty strings", () => {
    expect(() => assertSafePathComponent("")).toThrow();
  });

  it("rejects Windows reserved names", () => {
    expect(() => assertSafePathComponent("CON")).toThrow();
    expect(() => assertSafePathComponent("nul")).toThrow();
    expect(() => assertSafePathComponent("PRN")).toThrow();
    expect(() => assertSafePathComponent("aux")).toThrow();
  });

  it("rejects Windows drive prefixes", () => {
    expect(() => assertSafePathComponent("C:")).toThrow();
    expect(() => assertSafePathComponent("D:foo")).toThrow();
  });

  it("rejects absolute paths", () => {
    expect(() => assertSafePathComponent("/etc/passwd")).toThrow();
  });

  it("rejects non-string inputs", () => {
    expect(() => assertSafePathComponent(null as any)).toThrow();
    expect(() => assertSafePathComponent(undefined as any)).toThrow();
    expect(() => assertSafePathComponent(42 as any)).toThrow();
  });
});
