import { describe, it, expect } from "vitest";
import { parseInitArgs, InitArgsError } from "../../../src/cli/helpers/init-args.js";

describe("parseInitArgs", () => {
  it("returns empty args when no flags", () => {
    expect(parseInitArgs([])).toEqual({ help: false });
  });

  it("parses --provider", () => {
    expect(parseInitArgs(["--provider", "openai"])).toEqual({ provider: "openai", help: false });
  });

  it("parses --model", () => {
    expect(parseInitArgs(["--model", "gpt-5"])).toEqual({ model: "gpt-5", help: false });
  });

  it("parses --provider + --model + --help together", () => {
    expect(parseInitArgs(["--provider", "openai", "--model", "gpt-5", "--help"])).toEqual({
      provider: "openai",
      model: "gpt-5",
      help: true,
    });
  });

  it("accepts flags in any order", () => {
    expect(parseInitArgs(["--help", "--model", "gpt-5", "--provider", "openai"])).toEqual({
      provider: "openai",
      model: "gpt-5",
      help: true,
    });
  });

  it("throws InitArgsError on unknown flag", () => {
    try {
      parseInitArgs(["--bogus"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitArgsError);
      expect((err as InitArgsError).code).toBe("unknown-flag");
      expect((err as InitArgsError).message).toBe("Unknown option: --bogus");
    }
  });

  it("throws when --provider has no value", () => {
    try {
      parseInitArgs(["--provider"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitArgsError);
      expect((err as InitArgsError).code).toBe("missing-value");
      expect((err as InitArgsError).message).toBe("Missing value for --provider");
    }
  });

  it("throws when --model value is consumed by the next flag", () => {
    // --model followed by --help should error: --model is missing a value.
    try {
      parseInitArgs(["--model", "--help"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitArgsError);
      expect((err as InitArgsError).code).toBe("missing-value");
      expect((err as InitArgsError).message).toBe("Missing value for --model");
    }
  });

  it("throws on unexpected positional arg", () => {
    try {
      parseInitArgs(["openai"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InitArgsError);
      expect((err as InitArgsError).code).toBe("unexpected-positional");
      expect((err as InitArgsError).message).toBe("Unexpected argument: openai");
    }
  });
});
