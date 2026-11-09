// Typed decode/parse wrappers around Effect 4 Schema.
import { Schema, Result } from "effect";

export function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): Result.Result<S["Type"], Schema.SchemaError> {
  return Schema.decodeUnknownResult(schema, { errors: "all" })(input);
}

export function parseOrThrow<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] {
  return Schema.decodeUnknownSync(schema)(input);
}

export function formatErrors(error: Schema.SchemaError): string {
  return error.message;
}
