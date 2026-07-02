// tests/correlation/normalize-subsystem.vitest.ts

import { describe, it, expect } from "vitest";
import { executiveToCorrelationSubsystem } from "../../src/correlation/normalize-subsystem.js";

describe("executiveToCorrelationSubsystem", () => {
  it("maps 'workflow' to 'workflow'", () => {
    expect(executiveToCorrelationSubsystem("workflow")).toBe("workflow");
  });

  it("maps 'learning' to 'skills'", () => {
    expect(executiveToCorrelationSubsystem("learning")).toBe("skills");
  });

  it("maps 'memory' to 'memory'", () => {
    expect(executiveToCorrelationSubsystem("memory")).toBe("memory");
  });

  it("returns null for unknown name", () => {
    expect(executiveToCorrelationSubsystem("execution")).toBeNull();
  });

  it("returns null for 'demo'", () => {
    expect(executiveToCorrelationSubsystem("demo")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(executiveToCorrelationSubsystem("")).toBeNull();
  });
});
