// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — builder + session lifecycle coordinator.
 *
 * #717 step 5b: `build()` is a thin coordinator. All shared mutable state now
 * lives in a {@link SessionState} object (state.ts); the phases are module-level
 * factories in init.ts / turn.ts / chat.ts / resume.ts / activity.ts.
 *
 * @module agent-session
 */

import { saveDecisionsToMemory } from "../../run/helpers.js";
import { readVersionCached } from "./helpers.js";
import {
  type AgentSession,
  type AgentSessionConfig,
  type AgentSessionEvents,
  type AgentSessionState,
} from "./types.js";
import { createSessionState } from "./state.js";
import {
  cancelActiveTurn,
  getActivity,
  getLiveness,
  getPhase,
} from "./activity.js";
import { processTurn } from "./turn.js";
import { processChat } from "./chat.js";
import { resumeSession } from "./resume.js";

export class AgentSessionBuilder {
  private config: Partial<AgentSessionConfig>;

  constructor(config?: AgentSessionConfig) {
    this.config = config ?? {};
  }

  /** Set plan-phase configuration: approval mode and optional gate. */
  withPlan(cfg: { approvalMode?: "interactive" | "deferred"; gate?: import("../../run/plan-approval-gate.js").PlanApprovalGate }): this {
    if (cfg.approvalMode !== undefined) this.config.planApprovalMode = cfg.approvalMode;
    (this.config as any).gate = cfg.gate;
    return this;
  }

  /** Set chat configuration: search tool for workspace queries. */
  withChat(cfg: { chatSearchTool?: (q: string) => Promise<string> }): this {
    (this.config as any).chatSearchTool = cfg.chatSearchTool;
    return this;
  }

  /** Set persistence configuration: approval store and event log. */
  withPersistence(cfg: { approvalStore?: import("../../approvals/approval-store.js").ApprovalStore; eventLog?: import("../../tui/runtime-collector.js").RuntimeCollector }): this {
    (this.config as any).approvalStore = cfg.approvalStore;
    (this.config as any).eventLog = cfg.eventLog;
    return this;
  }

  /** Set event subscription configuration: streaming and diagnostic callbacks. */
  withEvents(cfg: AgentSessionEvents): this {
    (this.config as any).onStream = cfg.onToken ? (token: string) => cfg.onToken(token) : undefined;
    (this.config as any).onToolCall = cfg.onToolCall ? (call: import("../../providers/types.js").ToolCall) => cfg.onToolCall(call) : undefined;
    return this;
  }

  /** Set tool configuration: custom tool descriptors. */
  withTools(cfg: { tools?: import("../../providers/types.js").ToolDef[] }): this {
    if (cfg.tools) (this.config as any).tools = cfg.tools;
    return this;
  }

  build(): AgentSession {
    const config = this.config as AgentSessionConfig;
    const state = createSessionState(config);

  function getSessionId(): string {
    if (!state.ctx) return state.resolvedSessionId;
    return state.ctx.sessionId;
  }

  function getMode(): "auto" | "ask" | "bypass" {
    return state.ctx?.config.permissions.sessionMode ?? state.config.sessionMode ?? "auto";
  }

  function setMode(mode: "auto" | "ask" | "bypass"): void {
    // Mutate both the in-flight config (if a ctx has been built) and
    // the seed config so subsequent initAgent calls pick up the new mode.
    if (state.config) state.config.sessionMode = mode;
    if (state.ctx) state.ctx.config.permissions.sessionMode = mode;
  }

  function getVersion(): string {
    return readVersionCached();
  }

  function getState(): AgentSessionState {
    return {
      sessionId: getSessionId(),
      messages: Object.freeze([...state.messages]),
      toolHistory: Object.freeze([...state.toolHistory]),
      turnCount: state.turnCount,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      progressLedger: state.latestLedgerText,
      currentIntent: state.latestIntent,
      filesTouched: state.filesTouchedCount,
    };
  }

  async function save(): Promise<void> {
    if (!state.ctx) return;
    // Always run the legacy memory-decision extraction (best-effort).
    // `save()` is an explicit user action, so interactive confirmation stays
    // allowed here (unlike turn completion, which must never prompt).
    try {
      const sessionEvents = await state.ctx.log.readAll();
      await saveDecisionsToMemory(sessionEvents, state.ctx.memoryStore, { confirm: true });
    } catch {
      // Best-effort — never let persistence fail a save().
    }

    // If a SessionStore is wired, persist a full snapshot so /resume works.
    if (state.config.store) {
      try {
        const snap = getState();
        const snapshot = {
          sessionId: state.ctx.sessionId,
          task: state.currentTask,
          sessionMode: state.ctx.config.permissions.sessionMode ?? "auto",
          messages: snap.messages,
          toolHistory: snap.toolHistory,
          turnCount: snap.turnCount,
          createdAt: snap.createdAt,
          updatedAt: snap.updatedAt,
          scopeSnapshot: (state.ctx as any)._scopeSnapshot,
          stateSnapshot: (state.ctx as any)._stateSnapshot,
          completed: state.sessionCompleted,
        };
        await state.config.store.save(snapshot);
      } catch (err) {
        // Log but don't throw — memory write above is the legacy contract.
        console.error("SessionStore.save failed:", err);
      }
    }
  }

    return {
      processTurn: (message, options) => processTurn(state, message, options),
      processChat: (message) => processChat(state, message),
      getSessionId,
      getMode,
      setMode,
      getVersion,
      getState,
      getPhase: () => getPhase(state),
      getLiveness: () => getLiveness(state),
      getActivity: () => getActivity(state),
      cancelActiveTurn: (reason) => cancelActiveTurn(state, reason),
      getLastCancelSummary: () => state.lastCancelSummary,
      save,
      resume: (sessionId) => resumeSession(state, sessionId),
      setPlanApprovalGate: (gate) => {
        config.planApprovalGate = gate ?? undefined;
      },
    };
  }
}
