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
    const eventLog = new EventLog(sessionDir);
    await eventLog.init();

    // Build policy engine
    const policyEngine = new PolicyEngineBuilder(config)
      .withEventLog(eventLog, sessionId)
      .build();

    // Build tool executor
    const checkpointManager = new CheckpointManager(sessionDir);
    const toolExecutor = new ToolExecutor(config, eventLog, this._root);

    return {
      close: async () => {
        await eventLog.close();
      },
      eventLog,
      policyEngine,
      toolExecutor,
    };
  }
}