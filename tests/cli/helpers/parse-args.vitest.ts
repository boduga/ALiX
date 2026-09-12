import { describe, it, expect } from "vitest";
import { parseKeyValueArgs } from "../../../src/cli/helpers/parse-args.js";

describe("parseKeyValueArgs", () => {
  it("parses --key value pairs and --flags", () => {
    expect(parseKeyValueArgs(
      ["--candidates", "c.json", "--min-runs", "5", "--json"],
      ["candidates", "min-runs"],
      ["json"],
    )).toEqual({ candidates: "c.json", "min-runs": "5", json: true });
  });

  it("ignores a valued key with no consumable value", () => {
    expect(parseKeyValueArgs(["--model", "--json"], ["model"], ["json"]))
      .toEqual({ json: true });
    expect(parseKeyValueArgs(["--model"], ["model"], [])).toEqual({});
  });

  it("ignores bare positionals and unknown flags", () => {
    expect(parseKeyValueArgs(["run", "--bogus"], ["model"], ["json"])).toEqual({});
  });
});
