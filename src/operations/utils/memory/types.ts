export type MemoryType = "user" | "project" | "feedback" | "reference";

export type MemoryEntry = {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
  createdAt: string;
  modifiedAt: string;
  confidence: number; // 0.0-1.0, starts at 0.5
  confirmations: number;
  source?: string;
};

export type MemoryConfig = {
  decayEnabled: boolean;
  decayDays: number; // Default: 30
  maxEntriesPerType: number; // Default: 50
  consolidateSchedule: "daily" | "weekly" | "manual";
  indexMaxLines: number; // Default: 100
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  decayEnabled: true,
  decayDays: 30,
  maxEntriesPerType: 50,
  consolidateSchedule: "daily",
  indexMaxLines: 100,
};