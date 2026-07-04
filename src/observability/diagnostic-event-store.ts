/**
 * #187 — JSONL diagnostic event store.
 *
 * Append-only persistence for DiagnosticEvent records.
 * Parent directory is created on first write. Each event is one JSON line.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagnosticEvent } from "./diagnostic-event.js";
import type { RuntimeDiagnostic } from "../runtime/runtime-diagnostics.js";
import type { ContractDiagnostic } from "../contracts/contract-diagnostics.js";
import { runtimeDiagToEvent, contractDiagToEvent } from "./diagnostic-event.js";
import type { DiagnosticSink } from "../runtime/runtime-diagnostics.js";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class DiagnosticEventStore {
  private filePath: string;
  private dirCreated = false;

  constructor(dir: string, filename = "diagnostics.jsonl") {
    this.filePath = join(dir, filename);
  }

  /**
   * Append a single DiagnosticEvent to the JSONL file.
   * Creates parent directory on first write.
   */
  append(event: DiagnosticEvent): void {
    if (!this.dirCreated) {
      const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.dirCreated = true;
    }
    appendFileSync(this.filePath, JSON.stringify(event) + "\n", "utf-8");
  }

  /**
   * Append a RuntimeDiagnostic (maps to DiagnosticEvent internally).
   */
  appendRuntime(diag: RuntimeDiagnostic): void {
    this.append(runtimeDiagToEvent(diag));
  }

  /**
   * Append a ContractDiagnostic (maps to DiagnosticEvent internally).
   */
  appendContract(diag: ContractDiagnostic): void {
    this.append(contractDiagToEvent(diag));
  }
}

// ---------------------------------------------------------------------------
// DiagnosticSink wrapper
// ---------------------------------------------------------------------------

/**
 * Create a DiagnosticSink that writes runtime diagnostics to the event store.
 * Compatible with the existing onDiagnostic callback pattern.
 */
export function createDiagnosticStoreSink(store: DiagnosticEventStore): DiagnosticSink {
  return {
    emit: (diag: RuntimeDiagnostic) => {
      store.appendRuntime(diag);
    },
  };
}
