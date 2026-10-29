import type { InvocationIdentity } from "../../governance/approvals/approval-binding.js";
import { approvalExpiryState } from "../../governance/approvals/approval-store.js";
import "node:fs";
import "node:fs/promises";
import { resolve } from "node:path";
import { hashArgs } from "./hash-args.js";
import { executeWithEffectJournal } from "./effect-journal.js";
import { emitToolTelemetry } from "./telemetry.js";
import type { AlixConfig } from "../../operations/config/schema.js";
import { createModelResolver } from "../../operations/config/model-resolver.js";
import type { EventLog } from "../../runtime-state/events/event-log.js";
import { TOOL_EVENT_TYPES, ARTIFACT_EVENT_TYPES } from "../../runtime-state/events/types.js";
import type { ToolOutputPayload, ToolCompletedPayload, ToolFailedPayload, ArtifactCreatedPayload } from "../../runtime-state/events/types.js";
import type { CorrelationContext } from "../../runtime-state/runtime/tool-correlation.js";
import type { CoordinationExecutionContext } from "../../runtime-state/runtime/execution-decision.js";
import type { McpManager } from "../mcp/manager.js";
import "../../governance/policy/secret-scanner.js";
import type { EditFormatPolicy } from "../../execution/patch/edit-format-policy.js";
import type { CheckpointManager } from "../../execution/patch/checkpoint.js";
import type { ToolResult, ToolCallRequest } from "./types.js";
import { toolResultText } from "./result-text.js";
import { inferCapability, canonicalCapabilityOf } from "./capability-map.js";
import { AlixToolRepair } from "../../../packages/tool-repair/src/adapters/alix.js";
import { buildDefaultToolIndex } from "./tool-registry.js";
import {
  CompositeToolRouter,
  ToolAwareRouter,
  FileToolRouter,
  ShellToolRouter,
  PatchToolRouter,
  McpToolRouter,
  DelegateToolRouter,
  SelfExtendToolRouter,
  ScheduleToolRouter,
  StateToolRouter,
  ClaimVerificationToolRouter,
  WebToolsRouter,
  type ToolRouter,
} from "./tool-router.js";
import { isSafeShellCommand } from "./safe-shell.js";
import { WorkspacePathResolver } from "../../runtime-state/runtime/workspace-path.js";
import { extractMutationPaths } from "../../agents/agent/mutations.js";
import { getProcessTraceClient } from "../../models/tracing/client-factory.js";
import type { TraceClient } from "../../models/tracing/client.js";
import type {
  SpanOutcome,
  ToolSpanInput,
  TraceRun,
  TraceSpan,
} from "../../models/tracing/types.js";
import { ExecutionCancelledError, isCancellationError, signalReason } from "../../runtime-state/runtime/cancellation-token.js";

/** Session identity uses the session directory on both POSIX and Windows. */
export function sessionIdFromDirectory(sessionDir: string): string {
  return sessionDir.split(/[/\\]sessions[/\\]/)[1] ?? "unknown";
}

const LARGE_OUTPUT_THRESHOLD = 10000;

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ["password", "token", "secret", "key"];
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      sensitive.some((s) => k.toLowerCase().includes(s)) ? "[REDACTED]" : v,
    ])
  );
}

export type ExecuteResult =
  | ToolResult
  | {
      kind: "denied";
      reason: string;
      /**
       * Set on the approval-gated FIRST attempt of `handleToolCall`'s
       * execute-twice flow — the pause that waits for operator resolution and
       * is then re-executed for real. Structurally flagged (design §21); the
       * `reason` string keeps its historical "Approval required (id): …" shape.
       */
      approvalRequired?: true;
      /** The pending approval's id, when `approvalRequired` is set. */
      approvalId?: string;
    };

/**
 * True when a `denied` result is the approval-gated FIRST attempt in
 * `handleToolCall`'s execute-twice flow. That attempt does not execute the
 * tool — it waits for operator approval and is re-executed for real, so it
 * must NOT emit a terminal span (design §21 exactly-once-per-physical-call).
 * Genuine policy/ownership/mcp denials are NOT this case and keep their single
 * error span.
 *
 * The structured `approvalRequired` flag is the primary signal. The reason
 * prefix fallback keeps hand-constructed denials (tests, tool adapters that
 * build `{ kind: "denied", reason }` directly) classified correctly without
 * requiring them to know the flag.
 */
function isPreApprovalDenial(result: ExecuteResult | null | undefined): boolean {
  return (
    result?.kind === "denied" &&
    (result.approvalRequired === true || /^Approval required \(/.test(result.reason))
  );
}

export class ToolExecutor {
  private router: ToolRouter;
  private toolAwareRouter: ToolAwareRouter;
  // Track consecutive empty-result counts per (toolName+argumentHash)
  private consecutiveEmptyOutputs = new Map<string, number>();
  private repair: AlixToolRepair | null = null;
  private toolRegistry: any = null;

  constructor(
    private config: AlixConfig,
    private log: EventLog,
    private root: string,
    private mcpManager?: McpManager,
    editFormatPolicy?: EditFormatPolicy,
    extraHandlers?: Record<
      string,
      (args: Record<string, unknown>, request?: ToolCallRequest) => Promise<ToolResult>
    >,
    checkpointManager?: CheckpointManager,
    private approvalStore?: any,  // ApprovalStore — for PolicyGate ask decisions
    private workspacePathResolver?: any,  // WorkspacePathResolver — for OwnershipGate
    private ownershipRegistry?: any,  // OwnershipRegistry — for OwnershipGate
    private ownedPaths?: string[],  // OwnedPaths — owned-path auto-approval for headless write subagents
    private coordinationContext?: CoordinationExecutionContext, // trusted host-minted worker identity
  ) {
    // Create router with all handlers
    const pathResolver = this.workspacePathResolver ?? new WorkspacePathResolver(this.root, config.permissions?.protectedPaths ?? []);
    const composite = new CompositeToolRouter([
      new FileToolRouter(this.root, log, this.sessionId(), pathResolver),
      new ShellToolRouter(
        this.root,
        pathResolver,
        config.runtime?.envAllowlist,
        config.permissions?.allowNetworkDomains ?? [],
      ),
      new PatchToolRouter(this.root, config, editFormatPolicy, checkpointManager, log, this.sessionId()),
      new McpToolRouter(mcpManager ?? null, log, this.sessionId()),
      new DelegateToolRouter(extraHandlers),
      new SelfExtendToolRouter(),
      new ScheduleToolRouter(() => this.sessionId()),
      new StateToolRouter(this.root),
      new ClaimVerificationToolRouter(this.root),
      new WebToolsRouter(config.permissions?.allowNetworkDomains ?? []),
    ]);
    this.toolAwareRouter = new ToolAwareRouter(composite, log, this.sessionId());
    this.router = this.toolAwareRouter;
    this.toolRegistry = buildDefaultToolIndex().registry;

    // Initialize tool repair layer
    try {
      const resolved = createModelResolver(config).require();
      this.repair = new AlixToolRepair(resolved.provider, resolved.name);
    } catch {
      this.repair = null;
    }
  }

  /** Expose intent-based tool filtering — sets intent keywords on the ToolAwareRouter. */
  setIntent(intent: string[]): void {
    this.toolAwareRouter.setIntent(intent);
  }

  /** Clear the current intent — all tools become available again. */
  clearIntent(): void {
    this.toolAwareRouter.clearIntent();
  }

  /**
   * Look up an approval record by id. Exposed so the agent loop can wait
   * for an approval to be resolved and then re-execute the original tool
   * call — without this, the loop sees "Approval required" as a generic
   * "Access denied" and the model just retries, generating one new
   * approval per iteration.
   */
  getApproval(id: string): { status?: string } | undefined {
    return this.approvalStore?.get?.(id);
  }

  /**
   * Authoritative approval read for a call that is WAITING on a decision.
   *
   * The in-memory `get` above reflects only decisions this process made. In a
   * coordination run the operator resolves from the TUI while the worker is a
   * separate execution context, so a wait built solely on `get` would never
   * observe the decision — the worker would sit until its 5-minute timeout and
   * then treat a granted approval as expired.
   *
   * `loadFresh` re-poll reads the authoritative ledger: it returns the current
   * record, `undefined` when the record is gone, and a throw on a transient read
   * error which this maps to `null` so the caller can keep waiting instead of
   * mistaking a broken read for a denial.
   */
  async loadApprovalForWait(id: string): Promise<{ status?: string } | undefined | null> {
    if (!this.approvalStore?.loadFresh) return this.getApproval(id);
    try {
      return await this.approvalStore.loadFresh(id);
    } catch {
      return null;
    }
  }

  /**
   * Authorize a bound (non-routed) tool through the SAME PolicyGate pipeline
   * dispatch uses (R1.5): bound collaboration tools previously executed inline
   * with no policy decision at all. This returns the gate decision only — the
   * caller maps `allow` → handler, `ask` → approval wait, `deny` → denial.
   * Evidence: the gate emits `policy.decision` via the executor's EventLog.
   */
  async authorizeBoundTool(request: {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    sessionId?: string;
    agentId?: string;
  }): Promise<{ decision: "allow" | "ask" | "deny"; approvalId?: string; reason: string }> {
    const policyGate = await this.policyGate();
    const decision = await policyGate.evaluateToolCall({
      requestId: request.toolCallId,
      toolName: request.name,
      args: request.args,
      cwd: this.root,
      sessionMode: this.config.permissions.sessionMode ?? "ask",
      sessionId: request.sessionId,
      agentId: request.agentId ?? this.sessionId(),
      source: "tool",
    });
    return {
      decision: decision.decision,
      ...(decision.approvalId ? { approvalId: decision.approvalId } : {}),
      reason: decision.reason,
    };
  }

  /** One memoized PolicyGate per executor — shared by bound-tool and routed dispatch. */
  private policyGateInstance?: import("../../governance/policy/policy-gate.js").PolicyGate;

  private async policyGate(): Promise<import("../../governance/policy/policy-gate.js").PolicyGate> {
    if (!this.policyGateInstance) {
      const { PolicyGate } = await import("../../governance/policy/policy-gate.js");
      this.policyGateInstance = new PolicyGate(this.config, { eventLog: this.log, approvalStore: this.approvalStore });
    }
    return this.policyGateInstance;
  }

  /**
   * Evaluate only the MANDATORY denies for a shell command, without creating an
   * approval.
   *
   * The safe-shell bypass needs to know "is this denied outright?" before it can
   * skip authorization, and it must not run the full authorization path (that
   * would mint approvals from a path that is supposed to skip them).
   *
   * Returns the deny reason, or `null` when the command may proceed to the
   * normal path. Only POLICY denies are answered: `ask`, `allow`, and the
   * `approval-store-missing` outcome all return `null`, because that last one is
   * an absent dependency rather than a decision about the command — treating it
   * as a deny would turn "this executor has no store" into "this command is
   * forbidden", and the bypass must not widen its meaning. This can therefore
   * never widen authority; it only refuses.
   */
  private async mandatoryShellDeny(command: string): Promise<string | null> {
    const gate = await this.policyGate();
    const decision = await gate.evaluateToolCall({
      requestId: `safe-shell-probe-${Date.now()}`,
      toolName: "shell.run",
      capability: "shell.run",
      args: { command },
      // The CALLER's workspace, not the process cwd: protected-path and evasion
      // verdicts are cwd-relative, so probing from a different root could allow
      // a command the real evaluation denies.
      cwd: this.root,
      sessionMode: "ask",
      source: "tool",
      // Carry the declared scope so the probe sees the same channel denial the
      // real authorization would. Without this a scoped worker's mutating
      // "safe" command (e.g. `git branch -d x`) skipped the D2 check entirely.
      ...(this.ownedPaths?.length ? { ownedPaths: this.ownedPaths } : {}),
    });
    if (decision.decision !== "deny") return null;
    // A missing approval store is not a verdict on the command.
    if (decision.matchedRuleId === "approval-store-missing") return null;
    return decision.reason;
  }


  /**
   * Re-check only current mandatory policy denies for a continuation that
   * already has durable approval. `bypass` collapses normal ask/allow policy
   * without weakening hard denies, so this probe cannot mint a second approval
   * and cannot widen authority. A current deny always revokes execution.
   */
  private async mandatoryContinuationDeny(
    request: ToolCallRequest,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string | null> {
    const gate = await this.policyGate();
    const decision = await gate.evaluateToolCall({
      requestId: `continuation-deny-probe-${request.toolCallId}`,
      toolName,
      capability: inferCapability(toolName),
      args,
      cwd: this.root,
      sessionMode: "bypass",
      sessionId: this.sessionId(),
      agentId: request.agentId ?? "alix",
      source: "replay",
      ...((request.ownedPaths?.length ?? this.ownedPaths?.length)
        ? { ownedPaths: [...(request.ownedPaths?.length ? request.ownedPaths : this.ownedPaths ?? [])] }
        : {}),
    });
    return decision.decision === "deny" ? decision.reason : null;
  }

  private sessionId(): string {
    // Extract sessionId from EventLog sessionDir: .alix/sessions/<sessionId>
    return sessionIdFromDirectory(this.log.sessionDir);
  }

  private async logEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await emitToolTelemetry(this.log, this.sessionId(), type, payload);
  }

  /**
   * Execute a tool call, emitting exactly one terminal tool span per PHYSICAL
   * tool call when tracing is enabled and the request carries a runId that
   * resolves to an active run (R2, design §21, §22 exactly-once).
   *
   * The span is not begun until after dispatch confirms the tool actually ran:
   * `dispatch` can return an early, non-executing `denied` — most importantly
   * the approval-gated first attempt (`reason` starts with "Approval required")
   * that `handleToolCall` re-executes for real. Starting a span for that pause
   * would burn a spurious second terminal span (branded `error`) on a normal
   * approval wait. So we resolve the run up front (needed to end a span on the
   * throw path too), snapshot the pre-repair args + entry time, and only start
   * + end the span once dispatch has actually executed. Exactly one terminal
   * span across success / error-result / throw / timeout / cancellation; zero
   * span work when tracing is disabled, runId absent, or run unknown.
   */
  async execute(request: ToolCallRequest): Promise<ExecuteResult> {
    // Resolve the process TraceClient + parent run (fail-open: any tracing
    // problem degrades to "no span", never a throw into tool execution).
    let client: TraceClient | undefined;
    let run: TraceRun | null = null;
    const runId = request.runId;
    if (runId) {
      try {
        client = await getProcessTraceClient();
        run = client.getRun(runId);
      } catch {
        client = undefined;
        run = null;
      }
    }

    // Snapshot entry-time + PRE-repair args before dispatch. `dispatch` may
    // reassign `request.args` to the repaired object when it repairs a call,
    // so reading `request.args` here (after dispatch) would capture post-repair
    // args; the span intentionally records the args as the model issued them.
    const startedAt = Date.now();
    const argsSnapshot = request.args;
    try {
      const result = await this.dispatch(request);
      // A pre-approval denial is a pause, not an execution — skip the span so
      // the eventual real execute emits the single terminal span (see above).
      if (run && client && !isPreApprovalDenial(result)) {
        this.emitTerminalToolSpan(client, run, request, argsSnapshot, startedAt, result);
      }
      return result;
    } catch (err) {
      if (run && client) {
        this.emitTerminalToolSpan(
          client,
          run,
          request,
          argsSnapshot,
          startedAt,
          null,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      throw err;
    }
  }

  /**
   * Start + immediately end one tool span (startedAt/endedAt are explicit, so
   * duration is correct even though the span is begun after dispatch returns).
   * Fail-open: any tracing defect here never throws into tool execution.
   */
  private emitTerminalToolSpan(
    client: TraceClient,
    run: TraceRun,
    request: ToolCallRequest,
    args: Record<string, unknown>,
    startedAt: number,
    result: ExecuteResult | null,
    err?: Error,
  ): void {
    try {
      const span = client.startToolSpan(run, this.buildToolSpanInput(request, args, startedAt));
      const outcome = result !== null && result !== undefined
        ? this.buildSpanOutcome(result)
        : {
            status: err ? (isCancellationError(err) ? "cancelled" as const : "error" as const) : "error" as const,
            error: err ? (err.message || String(err)) : undefined,
          };
      outcome.endedAt = Date.now();
      this.endToolSpan(client, span, outcome);
    } catch {
      // Tracing must never throw into tool execution.
    }
  }

  /**
   * Build request-side ToolSpanInput at the seam; capture is the adapter's job.
   * `args` and `startedAt` are the PRE-repair snapshot taken at call entry —
   * dispatch may reassign `request.args` to the repaired object, so the span
   * intentionally records the args as the model issued them (pre-repair).
   */
  private buildToolSpanInput(
    request: ToolCallRequest,
    args: Record<string, unknown>,
    startedAt: number,
  ): ToolSpanInput {
    return {
      toolName: request.name,
      capability: inferCapability(request.name),
      toolCallId: request.toolCallId,
      invocationId: request.invocationId,
      executionId: request.executionId,
      args,
      startedAt,
    };
  }

  /** Terminal outcome for a resolved (non-thrown) tool result. */
  private buildSpanOutcome(result: ExecuteResult): SpanOutcome {
    if (result?.kind === "denied") {
      // Denials map to "error" (design status vocab), no output captured.
      return { status: "error" };
    }
    if (result?.kind !== "success") {
      // kind === "error" — a tool failure is still a terminal "error" span.
      return { status: "error", error: result.message };
    }
    let output: string | undefined;
    if (typeof result.output === "string") {
      output = result.output;
    } else if (typeof result.content === "string") {
      output = result.content;
    } else if (typeof result.value === "string") {
      output = result.value;
    }
    return { status: "success", output };
  }

  /** End a tool span exactly once; tracing failures never change tool results. */
  private endToolSpan(client: TraceClient, span: TraceSpan, outcome: SpanOutcome): void {
    try {
      client.endSpan(span, outcome);
    } catch {
      // Tracing must never throw into tool execution.
    }
  }

  private async dispatch(request: ToolCallRequest): Promise<ExecuteResult> {
    const startedAt = Date.now();
    const { toolCallId, name } = request;
    const agentPayload = request.agentId ? { agentId: request.agentId } : {};
    let args = request.args;
    const capability = inferCapability(name);
    const canonicalCapability = canonicalCapabilityOf(name);
    // Routers need the same owned-path authority policy uses: a write worker
    // rewriting its own declared output must be able to replace it.
    if (!request.ownedPaths?.length && this.ownedPaths?.length) {
      (request as { ownedPaths?: readonly string[] }).ownedPaths = this.ownedPaths;
    }

    // === TOOL REPAIR LAYER — runs before policy so hash and decision use repaired args ===
    let repairHint: string | undefined;
    if (this.repair && name !== "task.complete" && !name.startsWith("mcp.")) {
      const repairResult = this.repair.process(name, args);
      if (repairResult.repaired) {
        repairHint = repairResult.hint;
        args = repairResult.args;
        (request as Record<string, unknown>).args = args;
      }
    }
    // === END TOOL REPAIR ===

    const argumentHash = hashArgs(args);
    // Track the claim across execution so the crash-recovery state is honest:
    // a claimed approval that never reports an outcome stays `pending` and a
    // later replay classifies it `unverified` instead of reissuing authority.
    let claimedApprovalId: string | undefined;
    // T5 hierarchy: executionId → invocationId → toolCallId — typed via CorrelationContext, no loose Record
    // For T5 parallel path, correlation is required (asserted in tool-correlation); for serial/back-compat allow fallback to empty.
    const correlation: CorrelationContext = {
      executionId: request.executionId ?? "",
      invocationId: request.invocationId ?? "",
    };

    await this.logEvent(TOOL_EVENT_TYPES.REQUESTED, {
      toolCallId,
      toolName: name,
      capability,
      canonicalCapability,
      argumentHash,
      argsPreview: sanitizeArgs(args),
      executionId: correlation.executionId,
      invocationId: correlation.invocationId,
      ...agentPayload,
      ...(request.replayId ? { replayId: request.replayId } : {}),
    });

    if (request.allowedMutationPaths?.length) {
      const mutationPaths = extractMutationPaths(name, args);
      const allowed = new Set(request.allowedMutationPaths.map((path) => resolve(this.root, path)));
      const changedTarget = mutationPaths.find((path) => !allowed.has(resolve(this.root, path)));
      if (changedTarget) {
        const message = `Task constraint denied: ${changedTarget} is not the explicitly requested target`;
        await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
          toolCallId,
          toolName: name,
          error: message,
          durationMs: 0,
          canonicalCapability,
          argumentHash,
          executionId: correlation.executionId,
          invocationId: correlation.invocationId,
          ...agentPayload,
          ...(request.replayId ? { replayId: request.replayId } : {}),
        });
        return { kind: "error", message, retryable: false };
      }
    }

    // Continuation resumes bypass main policy gate — approval was already verified
    // by ContinuationManager. R1.5: the executor independently re-validates the
    // durable approval (present, still `approved`, not expired) — a caller-set
    // `source` string is not authorization. Missing/invalid evidence fails closed.
    if (request.source === "continuation-resume") {
      const approval = request.approvalId && this.approvalStore
        ? this.approvalStore.get?.(request.approvalId)
        : undefined;
      const stillAuthorized =
        !!approval &&
        approval.status === "approved" &&
        approvalExpiryState(approval.expiresAt) === "valid";
      if (!stillAuthorized) {
        return {
          kind: "denied",
          reason: request.approvalId
            ? `Continuation resume rejected: approval ${request.approvalId} missing, not approved, or expired`
            : "Continuation resume rejected: no durable approval backing this request",
        };
      }
      // Prior approval does not override CURRENT hard policy. Re-check only
      // mandatory denies without creating a second approval. This must happen
      // before ownership awaits, approval consumption, or adapter entry.
      const continuationDeny = await this.mandatoryContinuationDeny(request, name, args);
      if (continuationDeny) {
        await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
          toolCallId, toolName: name, error: continuationDeny, durationMs: 0,
          canonicalCapability, argumentHash, executionId: correlation.executionId,
          invocationId: correlation.invocationId, ...agentPayload,
        });
        return { kind: "denied", reason: continuationDeny };
      }
      // Ownership BEFORE the approval claim: a continuation resume is still a
      // write, and a write outside the declared scope is refused on its own
      // terms rather than incidentally by an invocation-binding mismatch. The
      // ordering also keeps this check reachable in tests — with the claim
      // first, every continuation resume failed on invocation identity and the
      // ownership call was never exercised (Gate E review, vacuous #10).
      const contGateResult = await this.checkOwnershipGate(request, name, args);
      if (contGateResult) return contGateResult;
      // Ownership/loading may have yielded after the host's cancellation check.
      // Do not consume authority for a resume already known to be cancelled.
      if (request.signal?.aborted) {
        throw new ExecutionCancelledError(signalReason(request.signal) ?? "continuation cancelled");
      }
      // R1.5: the continuation tombstone is NOT authorization — claim the
      // backing approval atomically so two parallel resumes cannot both run.
      if (request.approvalId) {
        const claimed = await this.claimApproval(request.approvalId, {
          ...this.invocationIdentity(capability, name, argumentHash, request.agentId),
          });
        if (claimed) return claimed;
        claimedApprovalId = request.approvalId;
      }
      await this.logEvent(TOOL_EVENT_TYPES.STARTED, {
        toolCallId,
        toolName: name,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      let resumed: ExecuteResult;
      try {
        // Claiming and telemetry both yield. No await may separate this check
        // from dispatch: even a router that ignores AbortSignal must not start.
        if (request.signal?.aborted) {
          throw new ExecutionCancelledError(signalReason(request.signal) ?? "continuation cancelled");
        }
        resumed = await executeWithEffectJournal(this.root, request, (boundRequest) => this.toolAwareRouter.downstream.execute(boundRequest));
      } catch (error) {
        if (claimedApprovalId) {
          // After downstream dispatch began, a thrown error cannot establish whether
          // an external effect happened. Keep the consumed claim pending for
          // fail-closed reconciliation; cancellation retains its own status.
          if (isCancellationError(error)) {
            await this.recordApprovalOutcome(claimedApprovalId, "cancelled");
          }
        }
        throw error;
      }
      if (claimedApprovalId) {
        // The ordinary path below already refuses to write a receipt for an
        // unknown outcome; the continuation branch must not be the loophole.
        // A resumed call whose adapter reported no provable terminal outcome
        // (`outcomeUnknown`) has unknown success, so recording `failed` would
        // be a fabricated verdict AND would permanently retire a
        // single-use approval that may in fact have applied its effect.
        // Leaving the claim `pending` keeps the fail-closed state: a replay
        // classifies it `unverified` and denies, and it is never reissued.
        const outcomeUnknown = resumed.kind === "error" && resumed.outcomeUnknown === true;
        if (!outcomeUnknown) {
          await this.recordApprovalOutcome(claimedApprovalId, resumed.kind === "success" ? "succeeded" : "failed");
        }
      }
      return resumed;
    }

    // Safe shell bypass for ask mode: read-only commands skip the approval gate.
    //
    // "Skip the approval gate" must NOT mean "skip policy". Mandatory denies are
    // still evaluated first: a deny is an absolute, and consulting it only after
    // a permissive branch makes the deny advisory. Before this check, a command
    // in `denyCommands` (or blocked/evaded) still executed here, because the
    // bypass returned before authorization. Independent Gate E review defect D1.
    //
    // This deliberately does not create approvals — `evaluateToolCall` would, and
    // an `ask` verdict here must fall through to the real authorization path so
    // the approval lifecycle stays in one place.
    const mode = this.config.permissions.sessionMode ?? "ask";
    if (mode === "ask" && name === "shell.run") {
      const command = typeof args?.command === "string" ? args.command : "";
      if (command && isSafeShellCommand(command)) {
        const mandatoryDeny = await this.mandatoryShellDeny(command);
        if (mandatoryDeny) {
          await this.logEvent(TOOL_EVENT_TYPES.STARTED, {
            toolCallId,
            toolName: name,
            argumentHash,
            executionId: correlation.executionId,
            invocationId: correlation.invocationId,
            ...agentPayload,
            ...(request.replayId ? { replayId: request.replayId } : {}),
          });
          return {
            kind: "error",
            message: `Command denied by policy: ${mandatoryDeny}`,
            retryable: false,
          };
        }
        // Skip the approval gate for a whitelisted read-only command, but do
        // not execute it here: the downstream ShellToolRouter owns workspace
        // path validation and command-failure classification.
        await this.logEvent(TOOL_EVENT_TYPES.STARTED, {
          toolCallId,
          toolName: name,
          argumentHash,
          executionId: correlation.executionId,
          invocationId: correlation.invocationId,
          ...agentPayload,
          ...(request.replayId ? { replayId: request.replayId } : {}),
        });
        return await this.toolAwareRouter.downstream.execute(request);
      }
    }

    // Unified authorization via ExecutionAuthorization — composes PolicyGate,
    // OwnershipGate, and audit/event emission into a single decision.
    const { ExecutionAuthorization } = await import("../../runtime-state/runtime/execution-authorization.js");
    const policyGate = await this.policyGate();
    const execAuth = new ExecutionAuthorization({
      policyGate,
      toolRegistry: this.toolRegistry,
      ownershipGateConfig: this.ownershipRegistry && this.workspacePathResolver
        ? { registry: this.ownershipRegistry, resolver: this.workspacePathResolver, autoAcquire: this.config.ownership?.autoAcquire ?? true }
        : undefined,
    });

    const decision = await execAuth.evaluate({
      requestId: toolCallId,
      capability,
      toolName: name,
      args,
      cwd: this.root,
      sessionMode: this.config.permissions.sessionMode ?? "ask",
      sessionId: this.sessionId(),
      agentId: request.agentId ?? "alix",
      source: "tool",
      ownedPaths: this.ownedPaths,
      coordination: this.coordinationContext,
    });

    // Denied — policy or ownership rejected this call
    if (decision.status === "denied") {
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
        toolCallId,
        toolName: name,
        error: decision.reason,
        durationMs: 0,
        canonicalCapability,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      return { kind: "denied", reason: decision.reason };
    }

    // Approval required — persist continuation for later approval resume
    if (decision.status === "approval_required") {
      try {
        const { ContinuationStore } = await import("../../runtime-state/runtime/continuation-store.js");
        const continuationStore = new ContinuationStore(this.root);
        await continuationStore.load();
        await continuationStore.persist({
          approvalId: decision.approvalId,
          kind: "tool",
          sessionId: this.sessionId(),
          cwd: this.root,
          toolCall: {
            toolCallId,
            name,
            capability,
            args,
            argsHash: argumentHash,
            agentId: request.agentId,
          },
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Failed to persist continuation:", err);
      }

      await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
        toolCallId,
        toolName: name,
        error: `Approval required: ${decision.approvalId}`,
        durationMs: 0,
        canonicalCapability,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      return {
        kind: "denied",
        reason: `Approval required (${decision.approvalId}): ${decision.reason}`,
        approvalRequired: true,
        approvalId: decision.approvalId,
      };
    }

    // Handle special case: the completion tool (not in router)
    if (name === "task.complete") {
      await this.logEvent(TOOL_EVENT_TYPES.STARTED, {
        toolCallId,
        toolName: name,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      const result: ToolResult = { kind: "success", output: "Task complete.", completed: true };
      const durationMs = Date.now() - startedAt;
      await this.logEvent(TOOL_EVENT_TYPES.OUTPUT, {
        toolCallId,
        outputPreview: "Task complete.",
        outputSize: 14,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, {
        toolCallId,
        toolName: name,
        status: "success",
        durationMs,
        canonicalCapability,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      return result;
    }

    // MCP availability check — policy said "ask" or "allow", but is the tool connected?
    if (name.startsWith("mcp.") && !this.mcpManager) {
      const msg = "MCP manager not initialized. No MCP servers are connected.";
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
        toolCallId,
        toolName: name,
        error: msg,
        durationMs: 0,
        canonicalCapability,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      return { kind: "denied", reason: msg };
    }

    // R1.5: an allowed decision that cites a durable approval must CLAIM it
    // before any router runs. This is the single seam both execution routes
    // pass through, so the claim happens exactly once per execution and a
    // concurrent or fresh-process replay loses the race and cannot execute.
    // The coordination exact-binding branch already consumed inside the gate
    // (`approvalConsumed`), so claiming again here would deny a legitimate
    // worker — skip it.
    if (decision.status === "allowed" && decision.approvalId) {
      if (!decision.approvalConsumed) {
        const claimed = await this.claimApproval(decision.approvalId, {
          ...this.invocationIdentity(capability, name, argumentHash, request.agentId),
        });
        if (claimed) return claimed;
      }
      // The exact-binding branch may have consumed this approval atomically
      // inside PolicyGate. Consumption is still single-use; carrying the id
      // forward is only for the terminal execution receipt below.
      claimedApprovalId = decision.approvalId;
    }

    await this.logEvent(TOOL_EVENT_TYPES.STARTED, {
      toolCallId,
      toolName: name,
      argumentHash,
      executionId: correlation.executionId,
      invocationId: correlation.invocationId,
      ...agentPayload,
      ...(request.replayId ? { replayId: request.replayId } : {}),
    });
    // Emit observability metric for tool call (via fail-open logEvent: a
    // contended append must not fail the tool).
    await this.logEvent("observability.metric", {
      name: "tool_calls_total", type: "counter", value: 1, labels: { tool: name }, timestamp: new Date().toISOString(), ...(request.replayId ? { replayId: request.replayId } : {}),
    });

    // Verify argument hash match before execution (M0.9 permissive placeholder)
    let result: ToolResult;
    try {
      result = await executeWithEffectJournal(this.root, request, (boundRequest) => this.router.execute(boundRequest));
    } catch (error) {
      if (isCancellationError(error)) {
        // Cancellation is a terminal outcome, never a tool failure. Keep the
        // original cancellation even if persistence of its telemetry fails.
        try {
          await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, {
            toolCallId,
            toolName: name,
            status: "cancelled",
            durationMs: Date.now() - startedAt,
            canonicalCapability,
            argumentHash,
            executionId: correlation.executionId,
            invocationId: correlation.invocationId,
            ...agentPayload,
            ...(request.replayId ? { replayId: request.replayId } : {}),
          });
        } catch {
          // Telemetry cannot reclassify an operator cancellation as failure.
        }
        if (claimedApprovalId) await this.recordApprovalOutcome(claimedApprovalId, "cancelled");
      }
      // A thrown router error cannot prove the effect was not applied.
      // Keep a consumed approval pending for reconciliation, not `failed`.
      throw error;
    }

    // Append repair hint to success output. Routed through `toolResultText`
    // rather than hand-picking `output`/`content`: those two are only two of
    // the success payload shapes. A `grep.search` carries `matches[]` and a
    // `file.exists` carries `exists`, so the old pair-of-branches form wrote
    // NO hint for either — and this module is the exact defect
    // `result-text.ts` exists to prevent, one layer up.
    if (repairHint && result.kind === "success") {
      const hintBlock = `\n\n[Tool Repair Hint] ${repairHint}`;
      const rendered = toolResultText(result);
      if (rendered.length > 0) {
        result.output = `${rendered}${hintBlock}`;
      } else if (result.output !== undefined) {
        result.output = `${result.output}${hintBlock}`;
      } else if (result.content !== undefined) {
        result.content = `${result.content}${hintBlock}`;
      } else if (result.value !== undefined) {
        result.value = `${result.value}${hintBlock}`;
      }
    }

    // Classify MCP errors with hints
    if (name.startsWith("mcp.") && result.kind === "error" && result.outcomeUnknown !== true && result.retryable === undefined) {
      result = classifyError(result);
    }

    const durationMs = Date.now() - startedAt;

    // The single renderer for a result's text — search tools answer with
    // `matches[]`, which a bare `output`/`content` read would count as zero.
    const rawOutput = toolResultText(result);

    // Handle large outputs by writing to file
    const outputSize = rawOutput.length;
    let outputRef: string | undefined;

    if (result.kind === "success" && outputSize > LARGE_OUTPUT_THRESHOLD) {
      outputRef = await writeOutputToFile(
        // Must be the rendered text: a search result carries `matches[]`, and
        // passing `output ?? content` (undefined) here crashed the run with
        // `The "data" argument must be of type string ... Received undefined`
        // the first time a large grep crossed the threshold.
        rawOutput,
        this.log.sessionDir,
        toolCallId,
        this.log,
        {
          coordinationRunId: request.coordinationRunId,
          agentId: request.agentId,
          taskId: request.taskId,
        },
      );
    }

    // Build an explicit preview (so the model always sees something)
    if (result.kind === "success") {
      // Normalize preview: explicit for empty/empty-array results so the model isn't left guessing.
      const preview = rawOutput === "" ? "[no output]" : truncateOutput(rawOutput);

      const outputPayload: ToolOutputPayload = {
        toolCallId,
        outputRef,
        outputPreview: preview,
        outputSize,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
        ...agentPayload,
      };
      await this.logEvent(TOOL_EVENT_TYPES.OUTPUT, {
        ...outputPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });

      // ── Loop detection & escalation ─────────────────────────────────
      // If the call returned no useful output repeatedly, emit a single escalation hint
      // so the model/operator can try a different tool (e.g., list the directory).
      const key = `${name}:${argumentHash}`;
      if (preview === "[no output]") {
        const count = (this.consecutiveEmptyOutputs.get(key) ?? 0) + 1;
        this.consecutiveEmptyOutputs.set(key, count);
        const ESCALATION_THRESHOLD = 3;
        if (count === ESCALATION_THRESHOLD) {
          // Emit a high-level agent hint / escalation event (non-fatal)
          await this.logEvent("agent.escalation", {
            message: `Repeated empty outputs for ${name} — consider running a listing or reading candidate files.`,
            suggestionTool: "alix_shell_run",
            suggestionArgs: { command: "ls -1 src/tools || echo '(no files)'" },
            toolName: name,
            argumentHash,
            toolCallId,
            ...(request.replayId ? { replayId: request.replayId } : {}),
          });
        }
      } else {
        // Reset counter on non-empty output
        this.consecutiveEmptyOutputs.delete(key);
      }
    }

    // Build and emit tool.completed or tool.failed event
    if (result.kind === "success") {
      const completedPayload: ToolCompletedPayload = {
        ...(typeof result.observedLineCount === "number" && Number.isSafeInteger(result.observedLineCount) && result.observedLineCount >= 0
          ? { observedLineCount: result.observedLineCount } : {}),
        toolCallId,
        toolName: name,
        status: "success",
        durationMs,
        canonicalCapability,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
      };
      await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, {
        ...completedPayload,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
    } else {
      const failedPayload: ToolFailedPayload = {
        toolCallId,
        toolName: name,
        error: result.message,
        durationMs,
        canonicalCapability,
        argumentHash,
        executionId: correlation.executionId,
        invocationId: correlation.invocationId,
      };
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
        ...failedPayload,
        ...agentPayload,
        ...(request.replayId ? { replayId: request.replayId } : {}),
      });
      // Emit observability metric for tool failure (fail-open via logEvent).
      await this.logEvent("observability.metric", {
        name: "tool_failures_total", type: "counter", value: 1, labels: { tool: name }, timestamp: new Date().toISOString(), ...(request.replayId ? { replayId: request.replayId } : {}),
      });
    }

    if (claimedApprovalId) {
      // A result that reached no provable terminal outcome must not write a
      // success OR failure receipt: the claimed authorization is real, but what
      // it produced is unknown. Leaving the claim `pending` is the fail-closed
      // state (a later replay classifies it `unverified` and denies), and is
      // what stops an incomplete coordination run from recording `succeeded`
      // (Gate 6 F3). A plain error still records `failed`.
      const outcomeUnknown = result.kind === "error" && result.outcomeUnknown === true;
      if (!outcomeUnknown) {
        await this.recordApprovalOutcome(
          claimedApprovalId,
          result.kind === "success" ? "succeeded" : "failed",
        );
      }
    }

    return result;
  }

  /**
   * Claim (consume) a durable approval for THIS exact invocation.
   *
   * Returns a denial result if the claim loses — the approval is already
   * consumed, expired, mismatched, or absent — so the caller never executes.
   * Returns null exactly once, when this caller won the atomic claim.
   */
/**
 * The invocation identity for a claim, derived in one place.
 *
 * Both claim sites (continuation resume and the policy-gate approval branch)
 * previously built this object literal verbatim; a change to what identifies an
 * invocation would have had to find both.
 */
  /** Host-only continuation operations; this module owns store construction. */
  async pendingContinuations(): Promise<import("../../runtime-state/runtime/continuation-store.js").PendingContinuation[]> {
    const { ContinuationStore } = await import("../../runtime-state/runtime/continuation-store.js");
    const store = new ContinuationStore(this.root);
    await store.load();
    return store.list();
  }

  async bindContinuationWorker(
    approvalId: string,
    worker: NonNullable<import("../../runtime-state/runtime/continuation-store.js").PendingContinuation["coordinationWorker"]>,
  ): Promise<boolean> {
    await this.approvalStore?.load?.();
    const approval = this.approvalStore?.get?.(approvalId);
    if (!approval || !["pending", "approved"].includes(approval.status)) return false;
    const { ContinuationStore } = await import("../../runtime-state/runtime/continuation-store.js");
    const store = new ContinuationStore(this.root);
    await store.load();
    const cont = store.findByApprovalId(approvalId);
    if (!cont) return false;
    // Attribution is a snapshot, never a way to transfer an existing grant to
    // a replacement assignment (or silently upgrade unverifiable legacy data).
    if (cont.coordinationWorker && JSON.stringify(cont.coordinationWorker) !== JSON.stringify(worker)) return false;
    await store.persist({ ...cont, coordinationWorker: worker });
    return true;
  }

  async resumeApprovedContinuation(approvalId: string, signal: AbortSignal): Promise<{ resumed: boolean; output?: string; error?: string }> {
    if (!this.approvalStore || signal.aborted) return { resumed: false, error: "Approval authority unavailable or cancelled" };
    await this.approvalStore.load();
    const { ContinuationStore } = await import("../../runtime-state/runtime/continuation-store.js");
    const { ContinuationManager } = await import("../../runtime-state/runtime/continuation-manager.js");
    const store = new ContinuationStore(this.root);
    await store.load();
    const manager = new ContinuationManager({ continuationStore: store, approvalStore: this.approvalStore,
      eventLog: this.log, executeTool: call => this.execute({ ...call, signal }) });
    return manager.resumeApproved(approvalId);
  }

  /** Identity of the exact invocation being authorised. */
  private invocationIdentity(
    capability: string,
    toolName: string,
    argsHash: string,
    agentId?: string,
  ): InvocationIdentity {
    return {
      capability,
      toolName,
      workspace: resolve(this.root),
      argsHash,
      sessionId: this.sessionId(),
      agentId: agentId ?? "alix",
    };
  }

  private async claimApproval(
    approvalId: string,
    // `InvocationIdentity` already owns this shape. Restating it inline had
    // already drifted from the copy in policy-gate.ts; one type means one rule.
    identity: InvocationIdentity,
  ): Promise<ExecuteResult | null> {
    const store = this.approvalStore;
    if (!store?.consumeApproved) {
      // A durable approval was cited but the store cannot atomically claim it.
      // Executing anyway would break single-use, so fail closed.
      return {
        kind: "denied",
        reason: `No approval store able to claim ${approvalId}; refusing to execute a single-use authorization`,
      };
    }
    try {
      const record = store.get?.(approvalId);
      if (!record?.bindingKey) {
        return { kind: "denied", reason: `Approval ${approvalId} not found; cannot authorize this execution` };
      }
      const result = await store.consumeApproved(approvalId, record.bindingKey, {}, { ...identity });
      if (!result?.consumed) {
        return {
          kind: "denied",
          reason: `Approval ${approvalId} could not be claimed (${result?.reason ?? "unknown"}); a fresh approval is required`,
        };
      }
      return null;
    } catch (err) {
      return {
        kind: "denied",
        reason: `Approval claim failed for ${approvalId}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Report the post-claim execution outcome. Best-effort by contract: a
   * persistence failure must never reclassify the tool result the model sees.
   * The store only accepts the transition from `pending`, so a duplicated
   * report cannot rewrite an already-resolved claim.
   */
  private async recordApprovalOutcome(
    approvalId: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): Promise<void> {
    try {
      await this.approvalStore?.recordExecutionOutcome?.(approvalId, outcome);
    } catch {
      // Observable via the durable `pending` state; never fatal to the call.
    }
  }

  // ─── Ownership Gate ───────────────────────────────────────────
  // Runs for every tool call including continuation-resume.
  // Only mutates=true tools require ownership checks.

  private async checkOwnershipGate(
    request: ToolCallRequest,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult | null> {
    // A declared owned scope is enforced HERE, not only in PolicyGate.
    //
    // The continuation-resume branch deliberately skips PolicyGate (approval was
    // already verified by ContinuationManager), so `ownedPaths` would go
    // unchecked on that path: the registry lease below runs with
    // `autoAcquire: true`, which GRANTS coverage rather than enforcing it. A
    // scoped worker resuming a continuation could therefore write outside its
    // declared scope.
    //
    // The CHANNEL rule comes from the shared module, not from a copy here: the
    // first version of this block handled only enumerable targets, so a shell or
    // delegate channel slipped through the same way it did in PolicyGate.
    const ownedPaths = request.ownedPaths?.length ? request.ownedPaths : this.ownedPaths;
    if (ownedPaths?.length) {
      const { unscopableChannelDenial } = await import("../../coordination/ownership/owned-scope-channels.js");
      const capabilityId = this.toolRegistry?.lookupByName(toolName)?.policyKey ?? toolName;
      const unscopable = unscopableChannelDenial({
        capability: capabilityId,
        toolName,
        ownedPaths,
      });
      if (unscopable) {
        return { kind: "error", message: unscopable, retryable: false };
      }
    }
    if (ownedPaths?.length && this.workspacePathResolver) {
      const { extractMutationTargets } = await import("../../coordination/ownership/mutation-targets.js");
      const extraction = extractMutationTargets(toolName, args, this.workspacePathResolver);
      if (extraction.classification === "unknown-write") {
        return {
          kind: "error",
          message:
            `Cannot determine mutation targets for ${toolName} — a declared owned scope cannot be verified. ` +
            `Acquire an explicit lease covering the expected paths and retry.`,
          retryable: false,
        };
      }
      if (extraction.classification === "known-write") {
        const { isWithinOwnedScope } = await import("../../coordination/ownership/path-scope.js");
        const outside = extraction.targets
          .map((target) => target.path)
          .filter((path) => !isWithinOwnedScope(path, ownedPaths, this.root));
        if (outside.length > 0) {
          return {
            kind: "error",
            message: `Ownership check failed: ${outside.join(", ")} outside owned paths`,
            retryable: false,
          };
        }
      }
    }

    // Skip if ownership is not wired
    if (!this.ownershipRegistry) return null;
    if (!this.workspacePathResolver) return null;

    const { checkOwnershipGate: gate } = await import("../../coordination/ownership/ownership-gate.js");
    const capability = this.toolRegistry?.lookupByName(toolName);
    const mutates = capability?.mutates ?? false;

    return await gate(
      {
        registry: this.ownershipRegistry,
        resolver: this.workspacePathResolver,
        autoAcquire: this.config.ownership?.autoAcquire ?? true,
      },
      request.agentId ?? "root",
      toolName,
      args,
      mutates,
    );
  }
}

type ErrorResult = { kind: "error"; message: string; retryable?: boolean; hint?: string };

export function classifyError(result: ErrorResult): ErrorResult {
  // An upstream boundary that explicitly marks an error non-retryable (for
  // example the D9 effect journal) is authoritative. Classification may add
  // retryability only when the caller has not already decided it.
  if (result.retryable === false) return result;
  const msg = result.message.toLowerCase();

  // Fatal — don't retry, model can't fix this
  if (msg.includes("unknown mcp tool") ||
      msg.includes("not initialized") ||
      msg.includes("authentication failed") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("invalid api key") ||
      msg.includes("permission denied") ||
      msg.includes("path is outside")) {
    return { ...result, retryable: false };
  }

  // Retryable — transient or server-side
  if (msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("connection") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("503") ||
      msg.includes("unavailable")) {
    return { ...result, retryable: true };
  }

  // Unknown/ambiguous — retry once, model decides
  return { ...result, retryable: true };
}

function truncateOutput(output: unknown, maxLen = 200): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

async function writeOutputToFile(
  output: unknown,
  sessionDir: string,
  toolCallId: string,
  log: EventLog,
  correlation: { coordinationRunId?: string; agentId?: string; taskId?: string } = {},
): Promise<string> {
  const { join } = await import("node:path");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const artifactsDir = join(sessionDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const artifactId = randomUUID();
  const filePath = join(artifactsDir, `tool-output-${artifactId}.json`);
  const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  await writeFile(filePath, content, "utf8");

  const mimeType = typeof output === "string" ? "text/plain" : "application/json";
  const size = Buffer.byteLength(content, "utf8");

  // Emit artifact.created event (best-effort via emitToolTelemetry: the
  // artifact file above is the authoritative record).
  const sessionId = sessionIdFromDirectory(sessionDir);
  await emitToolTelemetry(log, sessionId, ARTIFACT_EVENT_TYPES.CREATED, {
    artifactId,
    toolCallId,
    path: filePath,
    mimeType,
    size,
    retention: "session",
    ...(correlation.coordinationRunId ? { coordinationRunId: correlation.coordinationRunId } : {}),
    ...(correlation.agentId ? { agentId: correlation.agentId } : {}),
    ...(correlation.taskId ? { taskId: correlation.taskId } : {}),
  } satisfies ArtifactCreatedPayload);

  return filePath;
}
