export interface SearchResult<T> {
  item: T;
  score: number; // higher = better match, 0 = no match
}

/**
 * Simple Levenshtein distance (no external dep).
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[b.length][a.length];
}

interface ScoredTool {
  name: string;
  description: string;
  [key: string]: string | number | boolean | object | undefined;
}

/**
 * Search tools by fuzzy matching on name and description.
 * Scoring: exact prefix > substring > Levenshtein distance.
 * Returns results sorted by score descending.
 */
export function searchTools<T extends ScoredTool>(
  query: string,
  tools: T[],
  options: { nameField?: string; descriptionField?: string } = {}
): SearchResult<T>[] {
  const nameField = options.nameField ?? "name";
  const descField = options.descriptionField ?? "description";
  const q = query.toLowerCase();

  const results: SearchResult<T>[] = [];

  // If query exactly matches a tool name, return just that result
  for (const tool of tools) {
    const name = String(tool[nameField] ?? "").toLowerCase();
    if (name === q) {
      return [{ item: tool, score: 100 }];
    }
  }

  for (const tool of tools) {
    const name = String(tool[nameField] ?? "").toLowerCase();
    const desc = String(tool[descField] ?? "").toLowerCase();

    let score = 0;

    const nameExact = name === q;
    const namePrefix = name.startsWith(q);
    const nameSubstring = name.includes(q);
    const descExact = desc === q;
    const descPrefix = desc.startsWith(q);
    const descSubstring = desc.includes(q);

    // Exact match
    if (nameExact || descExact) {
      score = 100;
    }
    // Exact prefix (name only, not desc to avoid double-counting)
    else if (namePrefix) {
      score = 80;
    }
    // Substring anywhere
    else if (nameSubstring || descSubstring) {
      score = 50 + (nameSubstring ? 10 : 0);
    }
    // Levenshtein — only if lengths are similar enough
    else {
      const maxLen = Math.max(name.length, q.length);
      if (maxLen > 0 && maxLen <= 30 && Math.abs(name.length - q.length) <= 5) {
        const dist = levenshtein(name, q);
        const relative = dist / maxLen;
        if (relative <= 0.5) score = Math.round((1 - relative) * 40);
      }
    }

    if (score > 0) {
      results.push({ item: tool, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}