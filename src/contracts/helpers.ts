// src/contracts/helpers.ts
//
// Typed decode/parse wrappers around Effect Schema.
// Returns Either for safe decoding — never throws unless explicitly called.

import { Schema, Either, ParseResult } from "effect";

/**
 * Safely decode an unknown input against a schema.
 * Returns Right(decoded value) on success, Left(ParseError) on failure.
 * No thrown exceptions.
 */
export function decode(
  schema: Schema.Schema<any, any, never>,
  input: unknown,
): Either.Either<any, ParseResult.ParseError> {
  return Schema.decodeUnknownEither(schema as any)(input, {
    errors: "all",
  }) as any;
}

/**
 * Decode and throw on failure.
 * Use in test helpers and trusted contexts; prefer `decode()` for production.
 */
export function parseOrThrow(
  schema: Schema.Schema<any, any, never>,
  input: unknown,
): any {
  return Schema.decodeUnknownSync(schema as any)(input);
}

/**
 * Format a ParseError into a human-readable string.
 */
export function formatErrors(error: ParseResult.ParseError): string {
  return ParseResult.TreeFormatter.formatErrorSync(error);
}
