import type { AlixEvent } from "../../events/types.js";
import type { MemoryEntry } from "./types.js";

export type DecisionPattern = {
  type: "project" | "user" | "feedback";
  keywords: string[];
  regex: RegExp;
};

/**
 * Patterns for detecting decisions in session events.
 * Each pattern has keywords (for quick filtering) and a regex (for precise extraction).
 */
export const DECISION_PATTERNS: DecisionPattern[] = [
  // Project decisions: "chose X because Y", "decided to use X", "picked X over Y"
  {
    type: "project",
    keywords: ["chose", "decided", "picked", "selected", "went with", "opted for"],
    regex: /\b(chose|decided|picked|selected|went with|opted for)\s+([^.]+)/gi,
  },
  // User preferences: "prefers X", "likes Y", "wants Z", "favorite is X"
  {
    type: "user",
    keywords: ["prefers", "likes", "wants", "favorite", "loves", "rather"],
    regex: /\b(prefers|likes|wants|favorite|loves|rather)\s+([^.]+)/gi,
  },
  // Feedback/lessons: "fixed by doing X", "solved by Y", "resolved by Z"
  {
    type: "feedback",
    keywords: ["fixed", "solved", "resolved", "worked around", "handled by"],
    regex: /\b(fixed|solved|resolved|worked around|handled by)\s+([^.]+)/gi,
  },
];

/**
 * Extract key decisions from session events.
 * Scans through all events looking for text content that matches decision patterns.
 */
export function extractDecisions(events: AlixEvent[]): MemoryEntry[] {
  const decisions: MemoryEntry[] = [];
  const now = new Date().toISOString();

  for (const event of events) {
    // Only process events with text payloads (user messages, agent messages)
    if (!isTextEvent(event)) continue;

    const text = extractText(event);
    if (!text) continue;

    for (const pattern of DECISION_PATTERNS) {
      // Quick keyword filter to avoid expensive regex on every event
      const hasKeyword = pattern.keywords.some((kw) =>
        text.toLowerCase().includes(kw)
      );
      if (!hasKeyword) continue;

      // Reset regex state and find all matches
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const [, action, detail] = match;
        const content = `${action.trim()} ${detail.trim()}`.trim();

        decisions.push({
          name: generateName(content, pattern.type),
          description: `Auto-extracted ${pattern.type} decision: ${action.trim()}`,
          type: pattern.type,
          content,
          createdAt: now,
          modifiedAt: now,
          confidence: 0.5, // Auto-extracted, starts at 0.5
          confirmations: 0,
          source: `session:${event.sessionId}`,
        });
      }
    }
  }

  return decisions;
}

function isTextEvent(event: AlixEvent): boolean {
  const textEventTypes = [
    "user.message",
    "agent.message",
    "hook.pre_task",
    "hook.post_task",
  ];
  return textEventTypes.includes(event.type);
}

function extractText(event: AlixEvent): string | null {
  const payload = event.payload as { text?: string; output?: string; command?: string; reason?: string };
  return payload.text ?? payload.output ?? payload.command ?? payload.reason ?? null;
}

function generateName(content: string, type: "project" | "user" | "feedback"): string {
  // Generate a short name from the first few words
  const words = content.split(/\s+/).slice(0, 4);
  const base = words.join(" ");
  const suffix = type === "project" ? "decision" : type === "user" ? "preference" : "lesson";
  return `${base}... (${suffix})`;
}