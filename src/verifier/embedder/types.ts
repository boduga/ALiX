export interface VerificationEmbedding {
  id: string;
  sessionId: string;
  taskType: string;
  filePatterns: string[];
  errorPatterns: string[];
  toolSequence: string[];
  embedding: Float32Array;
  createdAt: number;
}

export interface FailureRecord {
  id: string;
  sessionId: string;
  task: string;
  errorSummary: string;
  fileChanges: string[];
  resolution: string;
  resolvedAt: number;
  embeddingId: string;
}

export interface EmbedderConfig {
  dimensions: number;
  modelName: string;
  provider: "local" | "api";
}

export interface SimilarityResult {
  record: FailureRecord;
  score: number;
  matchedPatterns: string[];
}

export interface EmbedderOptions {
  config: EmbedderConfig;
  dbPath: string;
}