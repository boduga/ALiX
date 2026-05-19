export type TaskType = "bugfix" | "feature" | "refactor" | "explanation" | "test" | "docs" | "review" | "unknown";

export type ClassificationResult = {
  type: TaskType;
  confidence: number;
  files?: string[];
  keywords: string[];
};

type PatternConfig = {
  keywords: string[];
  weight: number;
};

const TASK_PATTERNS: Record<TaskType, PatternConfig> = {
  bugfix: {
    keywords: ["fix", "bug", "error", "crash", "broken", "fail"],
    weight: 1.2,
  },
  feature: {
    keywords: ["add", "implement", "create", "new", "build", "enable", "support"],
    weight: 1.0,
  },
  refactor: {
    keywords: ["refactor", "extract", "simplify", "restructure", "clean", "reorganize", "improve"],
    weight: 1.2,
  },
  explanation: {
    keywords: ["what is", "how does", "explain", "understand", "how to", "what does", "what are"],
    weight: 1.5,
  },
  test: {
    keywords: ["test", "spec", "coverage", "unit", "testing", "tests", "specs"],
    weight: 1.2,
  },
  docs: {
    keywords: ["document", "readme", "comment", "documentation"],
    weight: 1.2,
  },
  review: {
    keywords: ["review", "audit", "check", "analyze", "examine", "inspect", "assess"],
    weight: 1.5,
  },
  unknown: {
    keywords: [],
    weight: 0,
  },
};

const FILE_PATH_REGEX = /(?:src|lib|app|tests?|docs?|scripts?)[\w/.-]*(?:\.\w+)?/gi;

export class IntentClassifier {
  classify(input: string): TaskType {
    const result = this.classifyWithFiles(input);
    return result.type;
  }

  classifyWithFiles(input: string): ClassificationResult {
    const lowerInput = input.toLowerCase();
    const scores: Record<TaskType, number> = {
      bugfix: 0,
      feature: 0,
      refactor: 0,
      explanation: 0,
      test: 0,
      docs: 0,
      review: 0,
      unknown: 0,
    };

    for (const [type, config] of Object.entries(TASK_PATTERNS)) {
      if (type === "unknown") continue;
      for (const keyword of config.keywords) {
        if (lowerInput.includes(keyword)) {
          scores[type as TaskType] += config.weight;
        }
      }
    }

    const maxScore = Math.max(...Object.values(scores));

    const typeOrder: TaskType[] = ["unknown", "feature", "bugfix", "refactor", "explanation", "test", "docs", "review"];
    const type: TaskType = maxScore > 0
      ? typeOrder.find(t => scores[t] === maxScore) || "unknown"
      : "unknown";

    const confidence = maxScore > 0 ? Math.min(maxScore / 3, 1) : 0;

    const files = this.extractFiles(input);
    const keywords = this.extractKeywords(input);

    return {
      type,
      confidence,
      ...(files.length > 0 && { files }),
      keywords,
    };
  }

  private extractFiles(input: string): string[] {
    const matches = input.match(FILE_PATH_REGEX) || [];
    return [...new Set(matches)];
  }

  private extractKeywords(input: string): string[] {
    const stopWords = new Set(["the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "should", "could", "may", "might", "can", "this", "that", "these", "those", "it", "its"]);
    const words = input.toLowerCase().split(/\s+/);
    return words.filter(w => w.length > 2 && !stopWords.has(w) && !FILE_PATH_REGEX.test(w));
  }
}