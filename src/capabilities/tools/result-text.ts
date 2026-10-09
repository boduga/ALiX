/**
 * result-text.ts — the single renderer for a ToolResult's model-visible text.
 *
 * ToolResult is a discriminated union whose success branch carries different
 * payloads per tool family: `content` (file.read), `output` (shell.run,
 * glob.match), `value`, `matches[]` (grep.search) or `exists`
 * (file.exists). A consumer that reads only `output`/`content` silently drops
 * every search result — the model receives an empty `<tool_result>` for a
 * grep that matched, reports "the tool returned nothing", and re-issues the
 * same search until the iteration budget is gone.
 *
 * Both consumers must go through this function, because they disagreeing is
 * exactly how that bug hid: telemetry previewed the matches while the message
 * handed to the model was empty.
 */

import type { ToolResult } from "./types.js";

/**
 * Render a successful tool result as text. Errors render as "" — callers own
 * their error formatting (`buildErrorMessage`), which carries retry hints.
 */
export function toolResultText(result: ToolResult): string {
  if (result.kind !== "success") return "";
  if (typeof result.output === "string" && result.output.length > 0) return result.output;
  if (typeof result.content === "string" && result.content.length > 0) return result.content;
  if (typeof result.value === "string" && result.value.length > 0) return result.value;
  if (Array.isArray(result.matches)) {
    return result.matches
      .map(match => `${match.path}:${match.lineNumber}: ${match.line}`)
      .join("\n");
  }
  if (typeof result.exists === "boolean") return result.exists ? "exists" : "does not exist";
  return "";
}
