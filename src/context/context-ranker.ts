export interface RankableFile {
  path: string;
  score?: number;
  modifiedAt?: Date;
  changeCount?: number;
  exports?: number;
}

export interface RankedFile extends RankableFile {
  finalScore: number;
  rank: number;
  factors: { name: string; value: number; weight: number }[];
}

export interface ContextRankerOptions {
  recencyBoost?: number;
  recencyWindowDays?: number;
  hotPathBoost?: number;
  exportBoost?: number;
  maxFiles?: number;
}

export class ContextRanker {
  private options: Required<ContextRankerOptions>;

  constructor(options: ContextRankerOptions = {}) {
    this.options = {
      recencyBoost: options.recencyBoost ?? 0.2,
      recencyWindowDays: options.recencyWindowDays ?? 30,
      hotPathBoost: options.hotPathBoost ?? 0.15,
      exportBoost: options.exportBoost ?? 0.1,
      maxFiles: options.maxFiles ?? 100,
    };
  }

  rankFiles(files: RankableFile[]): RankedFile[] {
    const now = Date.now();
    const maxAge = this.options.recencyWindowDays * 24 * 60 * 60 * 1000;

    const scored = files.map(file => {
      const factors: { name: string; value: number; weight: number }[] = [];

      const baseScore = file.score ?? 0.5;
      factors.push({ name: "base", value: baseScore, weight: 1 });

      if (file.modifiedAt) {
        const age = now - file.modifiedAt.getTime();
        const recency = Math.max(0, 1 - age / maxAge);
        const recencyScore = 1 + (recency * this.options.recencyBoost);
        factors.push({ name: "recency", value: recencyScore, weight: this.options.recencyBoost });
      }

      if (file.changeCount && file.changeCount > 1) {
        const hotScore = 1 + Math.min(0.5, file.changeCount * this.options.hotPathBoost);
        factors.push({ name: "hotPath", value: hotScore, weight: this.options.hotPathBoost });
      }

      if (file.exports && file.exports > 5) {
        const exportScore = 1 + (Math.min(0.3, file.exports * this.options.exportBoost));
        factors.push({ name: "exports", value: exportScore, weight: this.options.exportBoost });
      }

      const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
      const finalScore = totalWeight > 0
        ? factors.reduce((sum, f) => sum + f.value * f.weight, 0) / totalWeight
        : baseScore;

      return { ...file, finalScore, rank: 0, factors };
    });

    return scored
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, this.options.maxFiles)
      .map((file, index) => ({ ...file, rank: index + 1 }));
  }
}