// src/correlation/correlation-graph-store.ts

import { existsSync, mkdirSync, openSync, readFileSync, renameSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CorrelationGraph, CorrelationSubsystemId } from "./correlation-types.js";
import { CorrelationGraphLoadError } from "./correlation-types.js";

const CANONICAL_SUBSYSTEMS: CorrelationSubsystemId[] = [
  "memory", "workflow", "skills", "agents",
  "tools", "security", "governance", "adaptation",
];

export class CorrelationGraphStore {
  constructor(private readonly rootDir: string) {}

  get filePath(): string {
    return join(this.rootDir, "graph.json");
  }

  get tmpPath(): string {
    return join(this.rootDir, "graph.json.tmp");
  }

  async save(graph: CorrelationGraph): Promise<void> {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }
    const data = JSON.stringify(graph, null, 2);
    const fd = openSync(this.tmpPath, "w");
    try {
      writeFileSync(fd, data, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(this.tmpPath, this.filePath);
  }

  async loadLatest(
    opts?: { staleAfterMs?: number },
  ): Promise<CorrelationGraph | null> {
    if (!existsSync(this.filePath)) return null;

    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf-8");
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CorrelationGraphLoadError(
        `Invalid JSON in graph file: ${this.filePath}`,
      );
    }

    const graph = parsed as Record<string, unknown>;

    if (graph.schemaVersion !== "p11.1.0") {
      throw new CorrelationGraphLoadError(
        `Unexpected schema version: ${String(graph.schemaVersion)}`,
      );
    }

    if (!Array.isArray(graph.nodes)) {
      throw new CorrelationGraphLoadError("CorrelationGraph.nodes must be an array");
    }

    if (!Array.isArray(graph.edges)) {
      throw new CorrelationGraphLoadError("CorrelationGraph.edges must be an array");
    }

    for (const node of graph.nodes as Array<Record<string, unknown>>) {
      if (!CANONICAL_SUBSYSTEMS.includes(node.subsystem as CorrelationSubsystemId)) {
        throw new CorrelationGraphLoadError(
          `Invalid subsystem ID in node: ${String(node.subsystem)}`,
        );
      }
    }

    for (const edge of graph.edges as Array<Record<string, unknown>>) {
      if (!CANONICAL_SUBSYSTEMS.includes(edge.source as CorrelationSubsystemId)) {
        throw new CorrelationGraphLoadError(
          `Invalid source subsystem ID in edge: ${String(edge.source)}`,
        );
      }
      if (!CANONICAL_SUBSYSTEMS.includes(edge.target as CorrelationSubsystemId)) {
        throw new CorrelationGraphLoadError(
          `Invalid target subsystem ID in edge: ${String(edge.target)}`,
        );
      }
      // Validate confidence bounds
      const cr = Number(edge.coOccurrenceRate);
      const cc = Number(edge.correlationConfidence);
      const lag = Number(edge.temporalLag);
      if (!Number.isFinite(cr) || cr < 0 || cr > 1) {
        throw new CorrelationGraphLoadError(
          `Edge ${String(edge.source)}→${String(edge.target)}: coOccurrenceRate out of range [0,1]`,
        );
      }
      if (!Number.isFinite(cc) || cc < 0 || cc > 1) {
        throw new CorrelationGraphLoadError(
          `Edge ${String(edge.source)}→${String(edge.target)}: correlationConfidence out of range [0,1]`,
        );
      }
      if (!Number.isFinite(lag) || lag < 0) {
        throw new CorrelationGraphLoadError(
          `Edge ${String(edge.source)}→${String(edge.target)}: temporalLag must be >= 0`,
        );
      }
    }

    const result = graph as unknown as CorrelationGraph;

    // stale check
    if (opts?.staleAfterMs !== undefined) {
      const generatedAt = new Date(result.generatedAt).getTime();
      const ageMs = Date.now() - generatedAt;
      if (ageMs > opts.staleAfterMs) {
        result.status = "stale";
      }
    }

    return result;
  }

  async exists(): Promise<boolean> {
    return existsSync(this.filePath);
  }
}
