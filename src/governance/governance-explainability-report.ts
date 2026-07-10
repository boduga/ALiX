/**
 * P28.3 — Governance Explainability Report Renderer.
 *
 * Pure render functions convert GovernanceExplanation into either
 * ANSI-coloured terminal text or plain JSON. No I/O, no side effects.
 *
 * Core invariant: text sections rendered in stable canonical order:
 *   signal_origin → candidate_lifecycle → outcome_summary →
 *   peer_comparison → learning_synthesis
 *
 * @module
 */

import type {
  GovernanceExplanation,
  ExplanationSectionKind,
} from "./governance-explainability-types.js";

// ---------------------------------------------------------------------------
// Section ordering (canonical and stable)
// ---------------------------------------------------------------------------

const SECTION_ORDER: ExplanationSectionKind[] = [
  "signal_origin",
  "candidate_lifecycle",
  "outcome_summary",
  "peer_comparison",
  "learning_synthesis",
];

// ---------------------------------------------------------------------------
// P28_FOOTER
// ---------------------------------------------------------------------------

export const P28_FOOTER = `P28 explains governance decisions already made.
It does not recommend, predict, or prescribe actions.
No policy was changed. No thresholds were adjusted.
No reviewers were ranked. No outcomes were predicted.`;

// ---------------------------------------------------------------------------
// renderExplanationText — ANSI-terminal output
// ---------------------------------------------------------------------------

/**
 * Render a GovernanceExplanation as human-readable terminal text.
 *
 * Sections appear in the stable canonical order defined by SECTION_ORDER.
 * Sections not present in the explanation are silently skipped.
 */
export function renderExplanationText(explanation: GovernanceExplanation): string {
  const lines: string[] = [];

  lines.push("P28-EXPLAIN-START");
  lines.push("");
  lines.push(explanation.subject);
  lines.push("");

  // Build a quick lookup by section kind
  const sectionMap = new Map<ExplanationSectionKind, typeof explanation.sections[0]>();
  for (const section of explanation.sections) {
    sectionMap.set(section.kind, section);
  }

  for (const kind of SECTION_ORDER) {
    const section = sectionMap.get(kind);
    if (!section) continue;

    lines.push(`=== ${section.heading} ===`);
    lines.push(section.body);
    lines.push("");

    if (section.dataPoints && Object.keys(section.dataPoints).length > 0) {
      for (const [key, value] of Object.entries(section.dataPoints)) {
        lines.push(`  ${key}: ${value}`);
      }
      lines.push("");
    }

    if (section.evidenceRefs.length > 0) {
      lines.push(`  references: ${section.evidenceRefs.join(", ")}`);
      lines.push("");
    }
  }

  lines.push(P28_FOOTER);
  lines.push("");
  lines.push("P28-EXPLAIN-END");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// renderExplanationJson — JSON output
// ---------------------------------------------------------------------------

/**
 * Render a GovernanceExplanation as indented JSON.
 */
export function renderExplanationJson(explanation: GovernanceExplanation): string {
  return JSON.stringify(explanation, null, 2);
}
