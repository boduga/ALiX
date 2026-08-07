/**
 * #412 — Schema renderer (Phase 2, #308).
 *
 * Pure, platform-independent rendering of capability output and declared
 * schema shape as structured terminal lines. Replaces raw `JSON.stringify`
 * output with itemized / key:value lines when a capability declares a
 * `resultSchema`.
 *
 * Two modes:
 *   - renderSchemaResult(result, schema)  — render runtime output (data)
 *   - renderSchemaShape(schema)           — render a schema's declared form
 *
 * Both are pure functions — no I/O, no canvas, no store access. An absent
 * schema falls back to JSON.stringify (data mode) or an empty list (shape
 * mode); unknown keys are surfaced, never silently dropped; non-serializable
 * output degrades gracefully instead of throwing.
 *
 * @module schema-renderer
 */

// A minimal JSON-Schema-ish shape. We don't pull in a JSON-Schema library —
// we only need `type`, `properties`, and `items` to drive structured output.
type SchemaLike = {
  type?: string;
  properties?: Record<string, SchemaLike | undefined>;
  items?: SchemaLike | SchemaLike[] | undefined;
};

// ---------------------------------------------------------------------------
// Data mode — render runtime result
// ---------------------------------------------------------------------------

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Render a capability's runtime result as structured terminal lines.
 *
 * @param result - The capability output (arbitrary JSON-ish value).
 * @param schema - The capability's declared resultSchema, if any.
 * @returns Structured lines; `[JSON.stringify(result)]` when schema absent.
 */
export function renderSchemaResult(result: unknown, schema?: SchemaLike): string[] {
  // Absent schema → fall back to raw JSON.stringify (no crash, no blank).
  if (!schema || !schema.type) {
    return [safeStringify(result)];
  }
  // Cycle guard: track visited objects so cyclic output degrades to
  // "(cycle)" instead of overflowing the stack.
  const seen = new Set<object>();
  if (isPlainObject(result)) seen.add(result);
  return renderValue(result, schema, 0, seen);
}

function renderValue(value: unknown, schema: SchemaLike | undefined, depth: number, seen: Set<object>): string[] {
  const actual = typeOf(value);
  const indent = "  ".repeat(depth);

  // Array: itemized lines (or itemized object blocks).
  if (actual === "array") {
    const arr = value as unknown[];
    const out: string[] = [];
    for (const item of arr) {
      if (isPlainObject(item)) {
        if (seen.has(item)) {
          out.push(`${indent}- (cycle)`);
          continue;
        }
        seen.add(item);
        // First line carries the `- ` bullet; continuation lines indent.
        const lines = renderObject(item, depth, "", seen);
        out.push("- " + lines[0]);
        for (const line of lines.slice(1)) out.push("  " + line);
      } else {
        out.push(`${indent}- ${String(item)}`);
      }
    }
    return out.length > 0 ? out : [indent + "(empty)"];
  }

  // Object: key:value pairs, nested objects indented.
  if (isPlainObject(value)) {
    return renderObject(value, depth, "", seen);
  }

  // Primitive / scalar.
  return [indent + String(value)];
}

function renderObject(
  obj: Record<string, unknown>,
  depth: number,
  prefix: string,
  seen: Set<object>,
): string[] {
  const indent = "  ".repeat(depth);
  const out: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (isPlainObject(val)) {
      if (seen.has(val)) {
        out.push(`${indent}${prefix}${key}: (cycle)`);
        continue;
      }
      seen.add(val);
      out.push(`${indent}${prefix}${key}:`);
      out.push(...renderObject(val, depth + 1, "", seen));
    } else if (Array.isArray(val)) {
      out.push(`${indent}${prefix}${key}:`);
      for (const item of val) {
        out.push(`${indent}  - ${isPlainObject(item) ? safeStringify(item) : String(item)}`);
      }
    } else {
      out.push(`${indent}${prefix}${key}: ${String(val)}`);
    }
  }
  return out;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Non-serializable (cyclic, BigInt, ...) — degrade gracefully.
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Shape mode — render declared schema
// ---------------------------------------------------------------------------

/**
 * Render a schema's declared form as structured terminal lines (shape mode).
 *
 * @param schema - The capability's declared argsSchema/resultSchema.
 * @returns Structured lines describing the shape; `[]` when schema absent.
 */
export function renderSchemaShape(schema?: SchemaLike): string[] {
  if (!schema || !schema.type) return [];
  if (schema.type === "object") {
    const props = schema.properties ?? {};
    const keys = Object.keys(props);
    if (keys.length === 0) return ["object"];
    return keys.map((key) => `${key}: ${shapeType(props[key])}`);
  }
  if (schema.type === "array") {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    return [`[] ${items?.type ?? "any"}`];
  }
  // Primitive.
  return [schema.type];
}

function shapeType(schema: SchemaLike | undefined): string {
  if (!schema || !schema.type) return "any";
  if (schema.type === "object") return "object";
  if (schema.type === "array") return `array<${Array.isArray(schema.items) ? schema.items[0]?.type ?? "any" : schema.items?.type ?? "any"}>`;
  return schema.type;
}
