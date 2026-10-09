/**
 * outbound-redaction.ts — R5.1 egress redaction gate.
 *
 * Redacts secrets from provider-bound text before it leaves the process. The
 * runtime sends system prompts that embed memory and repomap content; without
 * this gate those reach a remote provider raw (tracing redacted only its
 * captured copy). Applied centrally by `withProviderContracts`, so every
 * adapter created through `createProvider` is gated in one place.
 *
 * Uses the security-owned structural redactor with the strictest `public`
 * profile (redacts every secret classification). Redaction is span-in-place:
 * it preserves the surrounding prompt and never truncates it.
 */

import type { ContentPart, NormalizedMessage, NormalizedRequest } from "./types.js";
import { createRedactionPolicy } from "../../governance/security/redaction/redaction-policy.js";
import { SecretDetector } from "../../governance/security/redaction/secret-detector.js";
import { redactText } from "../../governance/security/redaction/redactor.js";

// One strict policy + detector per process — the egress gate is the strictest
// security surface and must not use a lenient profile.
const EGRESS_POLICY = createRedactionPolicy("public");
const EGRESS_DETECTOR = new SecretDetector();

/** Redact secret spans in one string, preserving the full surrounding text. */
export function redactOutboundText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  return redactText(text, EGRESS_POLICY, EGRESS_DETECTOR);
}

function redactContent(content: NormalizedMessage["content"]): NormalizedMessage["content"] {
  if (typeof content === "string") return redactOutboundText(content);
  if (Array.isArray(content)) {
    return content.map((part): ContentPart => {
      if (part.type === "text") return { ...part, text: redactOutboundText(part.text) };
      // Image/file sources are binary or references, not prompt prose.
      return part;
    });
  }
  return content;
}

/**
 * Return a redacted copy of a provider-bound request. Redacts the system
 * prompt, every message's text content, and tool-result content. Never throws
 * (the underlying redactor is non-throwing); returns a new object.
 */
export function redactOutboundRequest(request: NormalizedRequest): NormalizedRequest {
  const messages = Array.isArray(request.messages)
    ? request.messages.map((message) => ({ ...message, content: redactContent(message.content) }))
    : request.messages;
  const toolResults = Array.isArray(request.toolResults)
    ? request.toolResults.map((result) =>
        result && typeof result.content === "string"
          ? { ...result, content: redactOutboundText(result.content) }
          : result,
      )
    : request.toolResults;
  return {
    ...request,
    systemPrompt: redactOutboundText(request.systemPrompt),
    messages,
    toolResults,
  };
}
