/**
 * Source marker preserved from Markdown list syntax.
 */
export type ListMarker =
  | "-"
  | "*"
  | "+"
  | "ordered";


/**
 * Structured representation of an agent response.
 *
 * Markdown remains the canonical persisted artifact.
 * ResponseBlock is only a presentation model.
 *
 * Phase 1 supports:
 * - text paragraphs
 * - fenced code blocks
 * - bullet and ordered lists
 */
export type ResponseBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "code";
      language?: string;
      code: string;
      fenced: true;
    }
  | {
      type: "list";
      marker: ListMarker;
      items: string[];
    };
