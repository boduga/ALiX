import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AlixConfig } from "../config/schema.js";
import { loadConfig } from "../config/loader.js";
import { EventLog } from "../events/event-log.js";
import { PolicyEngine } from "../policy/policy-engine.js";
import { PolicyEngineBuilder } from "../policy/policy-engine.js";
import { ToolExecutor } from "../tools/executor.js";
import { CheckpointManager } from "../patch/checkpoint.js";
import type { Runtime } from "./runtime.js";

export class RuntimeBuilder {
  private _root: string;
  private _config?: AlixConfig;
  private _sessionId?: string;
  private _eventLog?: EventLog;
  private _policyEngine?: PolicyEngine;
  private _toolExecutor?: ToolExecutor;
  private _checkpointManager?: CheckpointManager;

  constructor(root: string) {
    this._root = root;
  }

  withConfig(config: AlixConfig): this {
    this._config = config;
    return this;
  }

  withSession(sessionId: string): this {
    this._sessionId = sessionId;
    return this;
  }

  async build(): Promise<Runtime> {
    const config = this._config ?? await loadConfig(this._root);
    const sessionId = this._sessionId ?? randomUUID();
    const sessionDir = join(this._root, ".alix", "sessions", sessionId);

    // Initialize event log
    this._eventLog = new EventLog(sessionDir);
    await this._eventLog.init();

    // Build policy engine
    this._policyEngine = new PolicyEngineBuilder(config)
      .withEventLog(this._eventLog, sessionId)
      .build();

    // Build checkpoint manager and tool executor
    this._checkpointManager = new CheckpointManager(sessionDir);
    await this._checkpointManager.init();
    this._toolExecutor = new ToolExecutor(config, this._eventLog, this._root);

    return {
      close: async () => {
        // Clean up in reverse order of creation
        await this._checkpointManager?.close();
        await this._eventLog?.close();
      },
      eventLog: this._eventLog!,
      policyEngine: this._policyEngine!,
      toolExecutor: this._toolExecutor!,
    };
  }
}