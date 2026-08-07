/**
 * #412 — Schema renderer tests.
 *
 * Pins the pure schema-driven renderer for capability output:
 *   - renderSchemaResult(result, schema) → structured lines (data mode)
 *   - renderSchemaShape(schema) → structured lines (shape mode)
 *
 * Both are pure functions — no I/O, no canvas, no store access. They exist
 * so capability output / declared shape renders as structured terminal lines
 * instead of raw JSON.stringify (Phase 2, #308).
 */

import { describe, it, expect } from "vitest";
import {
  renderSchemaResult,
  renderSchemaShape,
} from "../../../src/tui/capabilities/schema-renderer.js";

describe("renderSchemaResult — data mode", () => {
  it("renders a primitive string result as-is", () => {
    const lines = renderSchemaResult("hello", { type: "string" });
    expect(lines).toEqual(["hello"]);
  });

  it("renders a primitive number result as-is", () => {
    const lines = renderSchemaResult(42, { type: "number" });
    expect(lines).toEqual(["42"]);
  });

  it("renders an array as itemized lines", () => {
    const lines = renderSchemaResult(
      ["session-1", "session-2"],
      { type: "array", items: { type: "string" } },
    );
    expect(lines).toEqual(["- session-1", "- session-2"]);
  });

  it("renders an array of objects as itemized key:value blocks", () => {
    const lines = renderSchemaResult(
      [{ id: "a", count: 2 }, { id: "b", count: 3 }],
      { type: "array", items: { type: "object" } },
    );
    expect(lines).toEqual([
      "- id: a",
      "  count: 2",
      "- id: b",
      "  count: 3",
    ]);
  });

  it("renders an object as key:value pairs", () => {
    const lines = renderSchemaResult(
      { id: "a", count: 2 },
      { type: "object" },
    );
    expect(lines).toEqual(["id: a", "count: 2"]);
  });

  it("falls back to JSON.stringify when the schema is absent", () => {
    const lines = renderSchemaResult({ id: "a" }, undefined);
    expect(lines).toEqual([JSON.stringify({ id: "a" })]);
  });

  it("tolerates unknown keys not declared in the schema", () => {
    const lines = renderSchemaResult(
      { id: "a", extra: 1 },
      { type: "object", properties: { id: { type: "string" } } },
    );
    // Unknown key is still surfaced (never silently dropped), and no throw.
    expect(lines.some((l) => l.startsWith("extra"))).toBe(true);
  });

  it("does not throw on non-JSON-serializable output", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => renderSchemaResult(cyclic, { type: "object" })).not.toThrow();
  });

  it("renders nested objects with indentation", () => {
    const lines = renderSchemaResult(
      { outer: { inner: "x" } },
      { type: "object", properties: { outer: { type: "object" } } },
    );
    expect(lines).toEqual(["outer:", "  inner: x"]);
  });
});

describe("renderSchemaShape — shape mode", () => {
  it("renders an object schema as property: type lines", () => {
    const lines = renderSchemaShape({
      type: "object",
      properties: {
        id: { type: "string" },
        count: { type: "number" },
      },
    });
    expect(lines).toEqual(["id: string", "count: number"]);
  });

  it("renders an array schema with its items type", () => {
    const lines = renderSchemaShape({
      type: "array",
      items: { type: "string" },
    });
    expect(lines).toEqual(["[] string"]);
  });

  it("renders a primitive schema as its type", () => {
    expect(renderSchemaShape({ type: "number" })).toEqual(["number"]);
  });

  it("falls back to the type name when properties are absent", () => {
    expect(renderSchemaShape({ type: "object" })).toEqual(["object"]);
  });

  it("handles an absent schema gracefully", () => {
    expect(() => renderSchemaShape(undefined)).not.toThrow();
    expect(renderSchemaShape(undefined)).toEqual([]);
  });
});
