import type { TransformName } from "../types.js";
import { removeNullField } from "./remove-null-field.js";
import { stripMarkdownLinks } from "./strip-markdown-links.js";
import { parseJsonArray } from "./parse-json-array.js";
import { smartDefault } from "./smart-default.js";
import { stripOuterQuotes } from "./strip-outer-quotes.js";

export type TransformFn = (args: Record<string, unknown>, paramName: string) => { args: Record<string, unknown>; changed: boolean };

const TRANSFORMS: Record<TransformName, TransformFn> = {
  remove: removeNullField,
  strip_markdown_links: stripMarkdownLinks,
  parse_json_string_to_array: parseJsonArray,
  default_first_read: smartDefault,
  default_last_read: smartDefault,
  replace_with_value: (args, paramName) => ({ args, changed: false }), // handled by repairer
  strip_outer_quotes: stripOuterQuotes,
};

export function getTransform(name: TransformName): TransformFn | undefined {
  return TRANSFORMS[name];
}

export function applyTransform(name: TransformName, args: Record<string, unknown>, paramName: string, value?: unknown): { args: Record<string, unknown>; changed: boolean } {
  if (name === "replace_with_value" && value !== undefined) {
    const current = args[paramName];
    if (current === value) return { args, changed: false };
    return { args: { ...args, [paramName]: value }, changed: true };
  }
  const fn = TRANSFORMS[name];
  if (!fn) return { args, changed: false };
  return fn(args, paramName);
}
