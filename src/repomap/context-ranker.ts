export type RankInput = {
  path: string;
  baseKind: "source" | "test" | "config" | "docs" | "unknown";
  mentionScore: number;
  dependencyDistance: number | null;
  symbolMatched: boolean;
  relatedTest: boolean;
  config: boolean;
  gitTouches: number;
};

export type RankOutput = {
  score: number;
  reasons: string[];
};

export function rankContextCandidate(input: RankInput): RankOutput {
  let score = 0;
  const reasons: string[] = [];

  if (input.mentionScore > 0) {
    score += input.mentionScore;
    reasons.push(`task_mention:${input.mentionScore}`);
  }
  if (input.dependencyDistance !== null) {
    const dependencyScore = Math.max(0, 30 - input.dependencyDistance * 10);
    if (dependencyScore > 0) {
      score += dependencyScore;
      reasons.push(`dependency_distance:${input.dependencyDistance}`);
    }
  }
  if (input.symbolMatched) {
    score += 25;
    reasons.push("symbol_match");
  }
  if (input.relatedTest) {
    score += 40;
    reasons.push("related_test");
  }
  if (input.config) {
    score += 10;
    reasons.push("config_file");
  }
  if (input.gitTouches > 0) {
    const recencyScore = Math.min(18, input.gitTouches * 6);
    score += recencyScore;
    reasons.push(`git_activity:${input.gitTouches}`);
  }

  return { score, reasons };
}