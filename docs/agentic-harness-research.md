# ALiX Agentic Harness Research Notes

> **Implementation Status: ✅ MVP Complete** — All 12 feature areas have been implemented.

Date: 2026-05-12
Updated: 2026-05-19

## Goal

Design ALiX, the Agentic Lifecycle & Intelligence eXchange: a new agentic coding harness inspired by Claude Code, OpenAI Codex CLI, Gemini CLI, OpenHands, OpenCode, Aider, and Goose.

The goal of ALiX is not to create a router or wrapper around those tools. The goal is to build a new framework/CLI and optional vanilla JavaScript frontend harness that combines the strongest architectural ideas from each.

## Implementation Specs

Focused specs created from this research:

- [MVP Product Spec](./mvp-product-spec.md)
- [Event Kernel Schema](./architecture/event-kernel-schema.md)
- [Patch Engine Protocol](./architecture/patch-engine-protocol.md)
- [Configuration Format](./architecture/config-format.md)
- [Provider Adapter Interface](./architecture/provider-adapter-interface.md)
- [RepoMapLite](./architecture/repomap-lite.md)
- [Frontend Transport Design](./architecture/frontend-transport.md)
- [Implementation Readiness](./architecture/implementation-readiness.md)

## Harnesses Discussed

Initial top harnesses:

1. Claude Code
2. OpenAI Codex CLI
3. Gemini CLI
4. OpenHands
5. OpenCode
6. Aider
7. Goose

## Product Direction

Use Claude Code as the product baseline, but not the codebase baseline.

Claude Code appears to be the current UX/control standard for coding agents: conversational CLI, file and shell tools, project memory, permissions, hooks, subagents, MCP, plugins, and skills. Since Claude Code is proprietary, the correct approach is clean-room reimplementation of the useful patterns.

The harness should be:

- CLI-first.
- Provider-neutral.
- Local-first.
- Patch-oriented.
- Observable.
- Extensible through tools, MCP, recipes, skills, and hooks.
- Usable without the frontend.
- Enhanced by a local vanilla JavaScript UI for review, approvals, timelines, diffs, logs, and terminal output.

## Core Architecture

```text
CLI/TUI + Vanilla JS UI
        |
        v
Session/Event Kernel
        |
        v
Planner -> Context Builder -> Agent Loop -> Tool Policy -> Tool Executor
        |
        v
Patch Engine / Shell / Git / Browser / MCP / LSP / Sandbox
        |
        v
Verifier -> Diff Review -> Session Memory
```

## Proposed CLI Shape

```bash
alix init
alix run "fix failing tests"
alix chat
alix plan
alix apply
alix review
alix serve
```

The CLI should expose the actual runtime. The frontend should connect to the CLI/local server rather than duplicating agent logic.

## Frontend Harness

Use vanilla JavaScript for a local inspector/control UI.

Core views:

- Session timeline.
- File diffs.
- Tool call log.
- Approval queue.
- Terminal output.
- Plan/status panel.
- Browser/app preview.
- File explorer.
- Run history.
- Token/context usage.
- Replayable event stream.

Possible transport:

- Server-Sent Events for event streaming.
- WebSockets if bidirectional UI controls need richer real-time interaction.

## Research Summary By Harness

| Harness | Implementation Pattern | What To Take | Gap | Proposed Solution |
|---|---|---|---|---|
| Claude Code | Built-in coding tools, project memory, skills, MCP, subagents, hooks, plugins, permission modes. | Use as UX/control reference. Copy the conceptual extension layering. | Proprietary, Anthropic-centered, internals opaque. | Clean-room implementation with provider abstraction and transparent event logs. |
| OpenAI Codex CLI | Local terminal coding agent with approvals, sandboxing, patch-oriented editing, MCP, subagents, local review, web search. | Strong sandbox/approval separation and structured patch flow. | Approval/sandbox combinations can be hard to reason about. | Build a unified `PolicyEngine` with simple presets and advanced per-tool rules. |
| Gemini CLI | CLI/core split, built-in file/shell/web/search/memory tools, MCP, extensions, large-context exploration. | Large-context repo exploration, extension packaging, search-grounded flows. | Editing reliability is not its strongest differentiator. | Use broad context for exploration; route edits through strict patch engine and verifier. |
| OpenHands | Docker/process/remote sandbox architecture, action executor, event stream, browser/runtime interactions. | Event-driven agent loop, sandbox providers, autonomous task runtime. | Heavyweight for quick local CLI work. | Support `process`, `docker`, and `remote` runtime providers. Default fast local, escalate to sandbox. |
| OpenCode | Terminal/desktop/IDE surfaces, built-in grep/glob/view/write/edit/patch/bash/fetch/diagnostics tools, MCP, LSP diagnostics, subagents. | Multi-surface architecture, LSP diagnostics, provider flexibility. | Tooling surface can sprawl. | Make a local server/event kernel the single source of truth for all clients. |
| Aider | Tree-sitter repo map, graph ranking, token-budgeted context, multiple edit formats, git-native workflow. | Best-in-class repo context layer and git checkpoint behavior. | Less of a broad autonomous runtime. | Use Aider-style repo map under a Claude/OpenHands-style loop. |
| Goose | Agent + interface + MCP extensions, desktop/CLI/API, ACP support, recipes, Code Mode meta-tools. | MCP-native extensions, recipes, ACP compatibility, lazy tool discovery. | Tool explosion and MCP security risks. | Use capability manifests, deny-by-default policy, lazy schema loading, provenance, and allowlists. |

## Ideas To Borrow

From Claude Code:

- Conversational CLI feel.
- Slash commands.
- Project memory file.
- Skills as reusable markdown workflows.
- Hooks on lifecycle/tool events.
- Subagents with isolated context.
- Permission modes.

From Codex CLI:

- Patch-first editing.
- Sandboxed command execution.
- Explicit approval modes.
- Local-first development loop.
- Review/verifier agent.

From Gemini CLI:

- Large-context exploration mode.
- Extension packaging.
- Web search/fetch tools.
- Memory tool.
- CLI/core split.

From OpenHands:

- Event stream as the system backbone.
- Runtime/sandbox providers.
- Browser interaction.
- Action/observation model.
- Long-running autonomous tasks.

From OpenCode:

- Multi-surface design: CLI, TUI, desktop, IDE.
- LSP diagnostics as an agent tool.
- Provider flexibility.
- Custom commands.
- Built-in code search/read/edit tools.

From Aider:

- Repo map using Tree-sitter.
- Graph/PageRank-style relevance ranking.
- Dynamic token budget for repository context.
- Git-native checkpoints and undo.
- Model-specific edit formats.

From Goose:

- MCP-first extension ecosystem.
- Recipes for repeatable tasks.
- ACP compatibility.
- Lazy tool discovery / meta-tool pattern.
- Local automation beyond coding.

## Key Gaps Design Spec

This section turns the research gaps into product and engineering requirements for the harness.

Each gap is specified with:

- Problem.
- Requirements.
- Components.
- Data model.
- MVP behavior.
- Acceptance tests.

### 1. Context Selection

Problem:
Agents fail less because they are incapable and more because they are looking at the wrong slice of the repo. Most harnesses rely on user-mentioned files, grep results, recently edited files, model-requested reads, repo summaries, or huge context dumps. The missing piece is a real context compiler.

Design goal:
Build a `ContextCompiler` that turns user intent into a ranked, typed bundle of repo context.

Requirements:

- Classify the user request into task type: bugfix, feature, refactor, explanation, test, docs, review, or unknown.
- Build a repo map using symbols, imports, exports, file paths, tests, and README/config files.
- Rank files and symbols by relevance to the request.
- Distinguish likely edit targets from supporting context.
- Respect a strict token budget.
- Allow the user and agent to pin files.
- Include recent git activity when useful.
- Track why each context item was included.

Components:

- `IntentClassifier`
- `RepoMapIndexer`
- `SymbolExtractor`
- `DependencyGraph`
- `SemanticSearchIndex`
- `GitActivityReader`
- `ContextRanker`
- `ContextBudgeter`
- `ContextBundleBuilder`

Data model:

```ts
type ContextBundle = {
  id: string;
  taskType: TaskType;
  budget: {
    maxTokens: number;
    usedTokens: number;
  };
  primaryFiles: ContextItem[];
  supportingFiles: ContextItem[];
  contracts: ContextItem[];
  tests: ContextItem[];
  history: ContextItem[];
  pinned: ContextItem[];
  omitted: OmittedContextItem[];
};

type ContextItem = {
  path: string;
  kind: "file" | "symbol" | "test" | "config" | "diff" | "doc";
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  score: number;
  tokenEstimate: number;
  reason: string;
};
```

MVP behavior:

- Use `rg`, file names, imports, package/config files, and simple symbol extraction.
- Produce `primaryFiles`, `supportingFiles`, and `tests`.
- Explain context selection in the event log.

Acceptance tests:

- Given a request mentioning a file, that file appears in `primaryFiles`.
- Given a request mentioning a function name, files containing that symbol rank above unrelated files.
- Given a token budget, the bundle never exceeds it.
- Given pinned files, they are included before optional context.
- Given a test file related by naming convention, it appears in `tests`.

### 2. Tool Security And Permissions

Problem:
Shell, MCP, browser, filesystem, network, and git tools can damage the workspace or leak secrets. Broad modes such as auto, ask, and bypass are useful but too coarse to be the underlying security model.

Design goal:
Create a deterministic `PolicyEngine` outside the model. The model may request actions, but policy decides whether to allow, ask, or deny.

Requirements:

- Evaluate every tool call before execution.
- Support capabilities such as `file.read`, `file.write`, `shell.readonly`, `shell.mutating`, `network.fetch`, `network.upload`, `git.diff`, `git.commit`, `git.push`, `secret.read`, `browser.open`, and `mcp.invoke`.
- Support policy rules by tool, path, command, network destination, environment variable, and session mode.
- Deny protected paths by default.
- Redact secrets from prompts, logs, tool results, and UI streams.
- Record every policy decision in the event log.
- Explain approval prompts in human terms.

Components:

- `PolicyEngine`
- `CapabilityRegistry`
- `CommandClassifier`
- `PathPolicyMatcher`
- `NetworkPolicyMatcher`
- `SecretScanner`
- `ApprovalQueue`
- `AuditLogWriter`

Data model:

```ts
type PolicyDecision = {
  toolCallId: string;
  capability: Capability;
  decision: "allow" | "ask" | "deny";
  reason: string;
  matchedRule?: string;
  redactions: Redaction[];
};

type PolicyRule = {
  id: string;
  capability: Capability | Capability[];
  effect: "allow" | "ask" | "deny";
  paths?: string[];
  commands?: string[];
  domains?: string[];
  sessionModes?: SessionMode[];
};
```

MVP behavior:

- Allow file reads inside the repo.
- Ask before file writes.
- Ask before shell commands.
- Deny writes to `.git`, `.env`, and configured secret paths.
- Deny unknown MCP tools until allowed.

Acceptance tests:

- A file read inside the repo is allowed and logged.
- A write to `.env` is denied before execution.
- `npm test` produces an approval request in ask mode.
- A policy decision includes a readable reason.
- Secret-looking values are redacted from displayed tool results.

### 3. Patch Reliability

Problem:
Models can produce malformed diffs, stale-context edits, ambiguous search/replace operations, or full-file rewrites that destroy unrelated changes.

Design goal:
All file changes go through a canonical `PatchEngine` with validation, rollback, diff review, and provider-aware edit format selection.

Requirements:

- Prefer structured patches with exact context.
- Support per-provider edit format preferences from day one.
- Validate the preimage before applying an edit.
- Detect stale context and conflicts.
- Support file-type-aware edits for JSON, YAML, Markdown, TypeScript, JavaScript, Python, and plain text.
- Create a checkpoint before applying changes.
- Generate a user-readable diff after every change.
- Preserve unrelated user changes.
- Support rollback to the latest checkpoint.

Components:

- `EditFormatSelector`
- `PatchParser`
- `PreimageValidator`
- `StructuredPatchApplier`
- `AstEditAdapter`
- `SearchReplaceAdapter`
- `FullFileRewriteGuard`
- `DiffRenderer`
- `CheckpointManager`
- `RollbackManager`

Data model:

```ts
type PatchProposal = {
  id: string;
  files: PatchFileChange[];
  format: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  provider: string;
  model: string;
  rationale: string;
  requiresApproval: boolean;
};

type PatchFileChange = {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  preimageHash?: string;
  hunks: PatchHunk[];
};

type PatchApplyResult = {
  proposalId: string;
  status: "applied" | "rejected" | "conflict" | "invalid";
  changedFiles: string[];
  diff: string;
  checkpointId?: string;
  errors: PatchError[];
};
```

Patch protocol:

Every patch follows the same lifecycle:

```text
select_edit_format
  -> generate_patch_proposal
  -> parse_patch
  -> policy_check
  -> create_checkpoint
  -> validate_preimage
  -> apply_patch
  -> render_diff
  -> verify_or_rollback
```

Edit formats:

- `structured_patch`: Harness-native patch format with explicit file operations, hunks, and preimage expectations. This is the preferred long-term format.
- `unified_diff`: Standard udiff format. Useful for models and tools that produce diffs reliably.
- `search_replace`: Exact search/replace blocks. Useful for providers that are less reliable at diffs but can target small edits.
- `full_file`: Full replacement. Allowed only for new files, generated files, tiny files, or explicit approval through `FullFileRewriteGuard`.

Provider edit format defaults:

```ts
type EditFormatPolicy = {
  provider: string;
  modelPattern?: string;
  preferred: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  allowed: Array<"structured_patch" | "unified_diff" | "search_replace" | "full_file">;
  fullFileRewrite: "deny" | "ask" | "allow_for_new_or_generated";
};
```

Initial policy:

- Claude-family models can prefer `structured_patch` or `unified_diff` if testing confirms reliability.
- Gemini defaults to `search_replace` even when large context is available.
- OpenAI/Codex-style providers can prefer `structured_patch`.
- Local models default to `search_replace` until model-specific reliability is proven.
- `full_file` is never the default for modifying existing human-authored files.

Safety invariants:

- Patch format selection never bypasses policy.
- Patch format selection never bypasses `PreimageValidator`.
- Large context windows do not weaken rewrite guards.
- A patch generated from stale file content is rejected.
- A failed patch application emits an event with enough detail for repair.
- Rollback must restore the last checkpoint even after partial patch failure.

MVP behavior:

- Implement structured patch application, exact search/replace, and guarded full-file creation.
- Read per-provider edit format preferences from config.
- Reject stale patches with a clear error.
- Create a git or internal checkpoint before edits.
- Show the diff in CLI and UI.

Acceptance tests:

- A valid patch applies and produces a diff.
- A patch with missing context is rejected.
- A patch touching a protected path is blocked by policy.
- A rollback restores the previous file content.
- A patch does not overwrite unrelated changes made after the file was read.
- Gemini defaults to `search_replace` and still runs preimage validation.
- A full-file rewrite to an existing source file requires explicit approval or is denied by policy.

### 4. Verification Quality

Problem:
Most agents run tests only when obvious. They often over-verify cheap changes or under-verify risky ones.

Design goal:
Build a `VerificationPlanner` that chooses the cheapest useful checks first and reports residual risk honestly.

Requirements:

- Classify the change type: code, test, docs, config, dependency, UI, schema, migration, or mixed.
- Discover project commands from package files, Makefiles, task runners, CI config, and repo docs.
- Map changed files to likely tests.
- Run cheap checks before expensive checks.
- Capture command output as structured events.
- Summarize what was verified and what was not.
- Avoid claiming success without evidence.

Components:

- `ChangeClassifier`
- `CommandDiscovery`
- `TestMapper`
- `VerificationPlanner`
- `CommandRunner`
- `VerificationReporter`

Data model:

```ts
type VerificationPlan = {
  id: string;
  changedFiles: string[];
  checks: VerificationCheck[];
  skipped: SkippedCheck[];
};

type VerificationCheck = {
  id: string;
  command: string;
  reason: string;
  cost: "cheap" | "medium" | "expensive";
  required: boolean;
};

type VerificationResult = {
  planId: string;
  status: "passed" | "failed" | "partial" | "not_run";
  results: CommandResult[];
  residualRisk: string[];
};
```

MVP behavior:

- Detect `npm test`, `npm run test`, `npm run typecheck`, `pytest`, `make test`, and common package-manager variants.
- Run checks only after approval when policy requires it.
- Report unverified areas in the final summary.

Acceptance tests:

- Changing a TypeScript file suggests typecheck when available.
- Changing a test file suggests the related test command.
- A failing command stops the success path and enters repair mode.
- The final report includes commands run and areas not verified.
- No final answer says tests passed unless a passing result exists.

### 5. Frontend Observability

Problem:
A CLI transcript is not enough for serious agent work. Users need to see the agent loop, not just the final answer.

Design goal:
Create a local vanilla JavaScript inspector UI powered by an event-sourced session stream.

Requirements:

- Stream structured events from the runtime.
- Show timeline, plans, tool calls, policy decisions, diffs, terminal output, approvals, token usage, and verification results.
- Allow replaying a session.
- Allow approving, denying, or editing queued actions.
- Keep CLI and UI views consistent by reading from the same event log.

Components:

- `EventBus`
- `SessionStore`
- `SseStreamer` or `WebSocketServer`
- `TimelineView`
- `DiffView`
- `TerminalView`
- `ApprovalPanel`
- `ContextView`
- `VerificationView`

Data model:

```ts
type HarnessEvent =
  | ThoughtSummaryEvent
  | ToolRequestEvent
  | PolicyDecisionEvent
  | ToolResultEvent
  | PatchProposalEvent
  | PatchAppliedEvent
  | VerificationStartedEvent
  | VerificationFinishedEvent
  | ApprovalRequestedEvent
  | CheckpointCreatedEvent;
```

MVP behavior:

- Serve a local UI with session timeline, diff viewer, terminal stream, and approval panel.
- Persist event logs as JSONL.
- Replay a previous session from disk.

Acceptance tests:

- Every tool call appears in the event log.
- A patch proposal appears in the UI before approval when policy requires it.
- Terminal output streams incrementally.
- Reloading the UI reconstructs the session timeline.
- CLI and UI show the same approval state.

### 6. Provider Neutrality

Problem:
The best UX patterns are concentrated in proprietary or provider-centered tools. A new harness should not depend on one model vendor.

Design goal:
Create a provider adapter layer that normalizes model capabilities without hiding important differences.

Requirements:

- Support text generation, tool calling, streaming, structured output, image input where available, and context-window metadata.
- Track provider-specific limits and costs.
- Allow model-specific prompting and edit formats.
- Support local and remote providers.
- Allow ACP-compatible agents as providers when useful.

Components:

- `ProviderRegistry`
- `ModelAdapter`
- `CapabilityNegotiator`
- `PromptCompiler`
- `ToolCallNormalizer`
- `CostTracker`

Data model:

```ts
type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  costProfile?: CostProfile;
};

type CostProfile = {
  currency: "USD";
  tiers: Array<{
    upToInputTokens?: number;
    inputPerMToken: number;
    outputPerMToken: number;
  }>;
};

type ModelAdapter = {
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
};
```

MVP behavior:

- Implement adapters for at least two providers.
- Detect unsupported features and degrade gracefully.
- Record selected provider and model in each session.

Acceptance tests:

- The same simple file-edit task can run against two providers.
- A provider without native tool calls can use text-mediated tool requests.
- Context budget changes according to model metadata.
- Cost tracking is recorded when provider pricing is configured.

#### Gemini Adapter Requirements

Gemini is the first concrete adapter worth specifying because it exercises the hardest parts of the provider abstraction: very large context, function-call parts, non-OpenAI streaming shape, top-level system instructions, multimodal input, structured output, and provider-specific edit discipline.

Verified current public API facts:

- `gemini-2.5-pro` has an input token limit of `1,048,576` and an output token limit of `65,536`.
- It supports function calling, structured outputs, image input, audio/video/PDF input, caching, code execution, search grounding, URL context, and thinking.
- Gemini system instructions are not normal chat turns; they are provided through top-level request config/system instruction fields.
- Gemini streaming returns incremental `GenerateContentResponse` chunks with `candidates[0].content.parts`, rather than OpenAI-style `delta.content` chunks.
- Google now recommends the `@google/genai` JavaScript/TypeScript SDK. The older `@google/generative-ai` package should not be used for new implementation.

Adapter capability shape:

```ts
const gemini25ProCapabilities: ModelCapabilities = {
  provider: "google",
  model: "gemini-2.5-pro",
  inputTokenLimit: 1_048_576,
  outputTokenLimit: 65_536,
  effectiveContextBudget: 800_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsStructuredOutput: true,
  supportsVision: true,
  costProfile: {
    currency: "USD",
    tiers: [
      {
        upToInputTokens: 200_000,
        inputPerMToken: 1.25,
        outputPerMToken: 10.0
      },
      {
        inputPerMToken: 2.5,
        outputPerMToken: 15.0
      }
    ]
  }
};

const geminiAdapterDefaults = {
  editFormatPreference: "search_replace",
  longContextStrategy: "expanded_context"
} satisfies Pick<ModelAdapter, "editFormatPreference" | "longContextStrategy">;
```

The `effectiveContextBudget` leaves headroom for tool responses, model output, retries, and verification summaries. It should be configurable because usable long-context behavior, latency, and cost are task-dependent.

Tool call normalization:

```ts
type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};
```

Gemini tool declarations are exposed as `functionDeclarations` in a `tools` array. Gemini responses can include text and tool calls together inside `content.parts`.

Normalizer requirements:

- Convert ALiX `NormalizedTool` schemas to Gemini `functionDeclarations`.
- Parse every returned part, not just the first part.
- Preserve mixed text plus function-call responses.
- Generate stable internal tool call IDs when Gemini does not provide one.
- Convert tool results back into Gemini-compatible function response parts.

Streaming requirements:

- Implement a Gemini-specific stream parser.
- Treat each stream item as a `GenerateContentResponse` chunk.
- Accumulate text parts by candidate and part order.
- Emit normalized stream events for text deltas, tool calls, usage updates, finish reasons, and errors.
- Do not assume an OpenAI-style delta string exists.

System prompt handling:

- `PromptCompiler` must separate system-level content from conversation turns.
- Project memory, tool instructions, policy summaries, and ALiX behavior rules should be compiled into `systemInstruction` or equivalent top-level config.
- User/assistant history should remain in `contents`.
- The adapter must reject malformed requests that try to smuggle system content into ordinary turns after compilation.

Edit format policy:

Gemini's large context window should expand reading, explanation, review, and screenshot/debug workflows. It must not weaken patch discipline.

Rules:

- Default Gemini to `search_replace` for code edits.
- Allow `structured_patch` when the model is reliably prompted for the ALiX patch protocol.
- Keep `full_file` behind `FullFileRewriteGuard` regardless of context size.
- Never bypass `PreimageValidator` because a provider can see the whole file.
- Never assume large context implies reliable large rewrites.

Capability negotiation:

When Gemini is active, `CapabilityNegotiator` should choose:

- `contextBudget`: up to the configured `effectiveContextBudget`, defaulting to `800_000`.
- `repoMapStrategy`: expanded symbol graph plus broader supporting files.
- `editFormat`: `search_replace` unless explicitly overridden by policy.
- `visionEnabled`: true for screenshot-based debugging and UI review tasks.
- `structuredOutputEnabled`: true for plans, verification reports, and machine-readable task summaries.

Forward-looking provider hints:

The architecture should leave room for task-type preferences without turning ALiX into a router for other harnesses.

```json
{
  "model": {
    "provider": "google",
    "name": "gemini-2.5-pro"
  },
  "providerHints": {
    "exploration": "google",
    "editing": "anthropic",
    "default": "anthropic"
  }
}
```

This is optional after MVP. It should be implemented as user-configured preference, not hidden automatic routing.

Gemini-specific acceptance tests:

- Given a mixed Gemini response with text and a `functionCall` part, `ToolCallNormalizer` returns both normalized text and a tool call.
- Given a Gemini stream of `GenerateContentResponse` chunks, the stream parser emits normalized text deltas in order.
- Given a request with system content, `PromptCompiler` places it in top-level system instruction config, not in a user turn.
- Given `gemini-2.5-pro`, `ContextBudgeter` can allocate a larger exploration budget while reserving output headroom.
- Given a code edit on Gemini, `PatchEngine` defaults to `search_replace` and still runs `PreimageValidator`.
- Given a full-file rewrite request from Gemini, `FullFileRewriteGuard` applies the same approval and safety rules as every other provider.

### 7. Autonomy Control

Problem:
Long-running agents can wander away from the user’s intent, expand scope silently, or keep retrying without making progress.

Design goal:
Use a task state machine with hard limits and explicit scope-change requests.

Requirements:

- Represent every task as a stateful run.
- Require planning before risky edits.
- Track current state: understand, plan, approve, execute, verify, repair, summarize.
- Enforce max steps, max cost, max file changes, max shell commands, max retries, and max runtime.
- Detect scope expansion and ask for confirmation.
- Stop when success criteria are met or limits are reached.

Components:

- `TaskStateMachine`
- `RunLimiter`
- `ScopeTracker`
- `ProgressEvaluator`
- `RepairLoopController`
- `StopConditionEvaluator`

Data model:

```ts
type AgentRun = {
  id: string;
  goal: string;
  state: "understand" | "plan" | "approve" | "execute" | "verify" | "repair" | "summarize" | "stopped";
  limits: RunLimits;
  counters: RunCounters;
  successCriteria: string[];
  scope: TaskScope;
};
```

MVP behavior:

- Use the state machine for every `alix run`.
- Ask before first edit unless in a mode that allows edits.
- Stop after configured retries or failed verification loops.

Acceptance tests:

- A run cannot execute edits before reaching the allowed state.
- A run stops when `max_steps` is reached.
- A run asks for approval when it discovers work outside the original goal.
- A failed verification enters repair mode only up to the retry limit.

### 8. Extension Model

Problem:
Skills, hooks, MCP servers, subagents, recipes, plugins, and commands solve different problems but are often blurred together.

Design goal:
Create a clear extension taxonomy with separate trust and packaging rules.

Requirements:

- Tools are callable capabilities.
- Skills are written procedures/instructions.
- Hooks are lifecycle automations.
- Recipes are reusable task templates.
- Subagents are isolated worker contexts.
- Plugins are installable bundles.
- MCP servers are external tool providers.
- Each extension declares capabilities and permissions.
- Extensions can be enabled per user, project, or session.

Components:

- `ExtensionRegistry`
- `PluginManifestLoader`
- `SkillLoader`
- `HookRunner`
- `RecipeRunner`
- `McpManager`
- `SubagentManager`

Data model:

```ts
type ExtensionManifest = {
  id: string;
  name: string;
  version: string;
  kind: "tool" | "skill" | "hook" | "recipe" | "subagent" | "plugin" | "mcp";
  entrypoint: string;
  capabilities: Capability[];
  permissions: PolicyRule[];
};
```

MVP behavior:

- Support project-local skills and commands.
- Support basic lifecycle hooks.
- Support MCP servers with explicit enablement.

Acceptance tests:

- A disabled extension cannot be invoked.
- Installing an extension does not grant permissions automatically.
- A hook failure is logged and handled according to hook policy.
- A skill can be selected and injected into a task prompt.

### 9. Tool Schema Explosion

Problem:
MCP-heavy setups can flood context with tool definitions. This wastes tokens and makes model behavior worse.

Design goal:
Load tools lazily and expose only task-relevant capabilities.

Requirements:

- Group tools by category.
- Discover tools without injecting every schema into the model prompt.
- Select tools per task.
- Cache discovered schemas.
- Track tool provenance.
- Support Goose-style meta-tools for discovery and invocation.

Components:

- `ToolCatalog`
- `ToolDiscovery`
- `ToolSelector`
- `SchemaCache`
- `MetaToolExecutor`
- `ToolProvenanceTracker`

Data model:

```ts
type ToolDescriptor = {
  id: string;
  provider: "builtin" | "mcp" | "plugin";
  category: string;
  capabilities: Capability[];
  schemaRef: string;
  trustLevel: "builtin" | "project" | "user" | "remote";
};
```

MVP behavior:

- Inject only built-in tools and selected project tools.
- Let the agent search the catalog for additional tools.
- Ask before enabling unknown MCP tools.

Acceptance tests:

- A session with 100 available MCP tools injects only selected tool schemas.
- The agent can discover a tool by category.
- Unknown remote tools require approval before invocation.
- Tool provenance appears in the event log.

### 10. Multi-Agent Coordination

Problem:
Subagents are useful, but spawning many agents without coordination creates duplicated work, conflicting edits, and confusing summaries.

Design goal:
Start with read-only subagents, then add controlled write-capable workers with explicit ownership.

Requirements:

- Subagents have isolated context and clear task contracts.
- Parent agent owns final decisions.
- Read-only roles are supported first: explorer, reviewer, test investigator, docs researcher.
- Write-capable roles require explicit file ownership.
- Overlapping write ownership is denied unless the parent resolves it.
- Subagent results are summarized into the parent event log.

Components:

- `SubagentManager`
- `TaskDelegator`
- `OwnershipRegistry`
- `SubagentEventBridge`
- `ResultContractValidator`
- `MergeCoordinator`

Data model:

```ts
type SubagentTask = {
  id: string;
  role: "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";
  prompt: string;
  mode: "read_only" | "write";
  ownedPaths: string[];
  expectedOutput: string;
};
```

MVP behavior:

- Support read-only subagents for exploration and review.
- Parent receives structured findings.
- No subagent writes files in the first implementation.

Acceptance tests:

- A read-only subagent cannot call write tools.
- Parent timeline includes subagent start, result, and errors.
- Two write-capable subagent tasks cannot own the same file path.
- Parent can reject a subagent result without changing files.

### 11. Memory

Problem:
Memory is often either too weak to help or too hidden to trust.

Design goal:
Split memory into explicit, inspectable layers.

Requirements:

- Project memory is checked into the repo and editable.
- User memory is optional and private.
- Session memory summarizes the current run.
- Tool memory caches command results and indexes.
- Repo memory stores generated indexes that can be rebuilt.
- Hidden memory must not affect behavior without being inspectable.

Components:

- `ProjectMemoryStore`
- `UserPreferenceStore`
- `SessionSummaryStore`
- `ToolCache`
- `RepoIndexStore`
- `MemoryInspector`

Data model:

```ts
type MemoryRecord = {
  id: string;
  scope: "project" | "user" | "session" | "tool" | "repo";
  content: string;
  source: string;
  createdAt: string;
  expiresAt?: string;
};
```

MVP behavior:

- Use a project memory file.
- Save session summaries.
- Cache repo indexes under a generated-data directory.
- Provide a CLI command to inspect memory.

Acceptance tests:

- Project memory can be read and shown to the user.
- Session memory is written at the end of a run.
- Repo indexes can be deleted and rebuilt.
- User memory is disabled unless explicitly configured.

### 12. Product Positioning Gap

Problem:
Existing tools tend to be polished but closed, flexible but rough, autonomous but heavy, CLI-first but opaque, or UI-first but less composable.

Design goal:
Build ALiX as an agent operating system for a repository.

Requirements:

- Claude-like CLI UX.
- Aider-quality context.
- Codex-style safety and patch discipline.
- OpenHands-style observability.
- OpenCode-style provider flexibility.
- Gemini-scale exploration.
- Goose-style extension ecosystem.
- Vanilla JavaScript inspector UI.
- Local-first operation.

MVP success criteria:

- A user can run one command, discuss a repo task, approve a plan, receive a patch, run verification, review the diff, and see the complete event trail.
- The same runtime works from CLI and UI.
- The system remains useful with only built-in tools and one provider.
- The architecture leaves room for MCP, subagents, browser automation, and remote sandboxes without requiring them on day one.

## Architecture Review Notes

### Event Kernel Is Load-Bearing

The event-sourced session kernel is the right architectural center. It should not be treated as a UI logging feature. It is the system backbone.

Once ALiX has an immutable append-only event log, the following become simpler:

- CLI and UI consistency.
- Session replay.
- Approval state recovery.
- Subagent event bridging.
- Debugging failed runs.
- Audit trails for file edits and shell commands.
- Future IDE and desktop surfaces.

The event log should record action and observation pairs, policy decisions, patch proposals, patch results, verifier results, approvals, checkpoints, rollbacks, and final summaries.

### Patch Engine Needs First-Class Protocol Spec

The patch engine deserves specification work before coding starts. "One canonical patch protocol" is the goal, but edit format selection is the hard part.

Aider's multiple edit formats exist because models vary in how reliably they produce whole-file rewrites, search/replace blocks, and diffs. ALiX needs per-provider edit format configuration from day one. Otherwise the first non-Claude or weaker local model integration can produce silent corruption.

The patch layer must be stricter than the model layer:

- Provider preference can choose the prompt format.
- `PatchEngine` still owns parsing, validation, checkpointing, applying, diffing, and rollback.
- `FullFileRewriteGuard` applies equally to every provider.
- Large context windows are useful for understanding, not a reason to loosen patch safety.

### Repo Map Should Enter MVP Earlier

The build order should include a minimal repo map earlier than the full context builder. Planning without repo context produces weak plans, so the MVP needs a small `RepoMapLite` before advanced Tree-sitter/PageRank work.

`RepoMapLite` should include:

- File tree.
- Package/config files.
- README and project memory files.
- Top-level symbols where cheap to extract.
- Test file naming relationships.
- Recent git status.

The advanced repo map can still come later with Tree-sitter, graph ranking, semantic search, LSP integration, and dependency-aware test mapping.

### Multi-Agent Remains Post-MVP

Subagents should stay out of the first milestone. A shaky single-agent loop does not become stronger by adding more agents.

The MVP should perfect one loop:

```text
chat -> repo map lite -> plan -> approve -> patch -> verify -> diff -> summarize
```

Read-only subagents can be introduced later once the event kernel, patch protocol, policy engine, and verifier are stable.

## Recommended MVP

Build one excellent Claude-like coding loop first:

```text
chat -> repo map lite -> plan -> approve -> edit via patch -> run verifier -> show diff -> summarize
```

MVP components:

1. CLI chat loop.
2. Model provider abstraction.
3. Event-sourced session kernel.
4. Minimal repo map: file tree, config files, top-level symbols, test relationships, git status.
5. File read/search tools.
6. Shell execution with approval gates.
7. Canonical patch engine with per-provider edit format policy.
8. Git checkpoint/diff/undo.
9. Basic verifier command runner.
10. Local vanilla JS UI for timeline, diffs, terminal, and approvals.

## Build Order

1. Event-sourced session kernel.
2. CLI chat interface.
3. Provider abstraction.
4. Repo map lite/context primer.
5. File/search/shell tools.
6. Policy/approval engine.
7. Patch protocol and per-provider edit format policy.
8. Git checkpointing.
9. Verifier loop.
10. Local web UI.
11. Full repo map/context builder.
12. MCP support.
13. Skills/recipes/custom commands.
14. Hooks.
15. Subagents.
16. Runtime providers: process, Docker, remote.
17. LSP diagnostics.
18. Browser automation.
19. ACP compatibility.

## Possible Config Shape

```json
{
  "model": {
    "provider": "openai",
    "name": "gpt-5.4"
  },
  "permissions": {
    "default": "ask",
    "tools": {
      "file.read": "allow",
      "file.write": "ask",
      "shell.run": "ask",
      "git.diff": "allow",
      "network.fetch": "ask"
    },
    "protectedPaths": [
      ".env",
      ".git",
      "secrets/**"
    ]
  },
  "context": {
    "repoMap": true,
    "maxRepoMapTokens": 2000,
    "semanticSearch": true
  },
  "runtime": {
    "provider": "process"
  },
  "ui": {
    "enabled": true,
    "port": 4137
  }
}
```

## Design Principle

ALiX should become an agent operating system for a repository:

```text
User Intent
   |
   v
Planner
   |
   v
Context Builder
   |
   v
Agent Loop
   |
   v
Tools: files, shell, git, browser, web, MCP, LSP
   |
   v
Patch/Command Results
   |
   v
Verifier
   |
   v
Human Approval / Final Output
```

## Strategic Bet

Build an event-sourced local agent kernel with a vanilla JavaScript inspector UI.

That gives:

- Claude Code-like UX.
- OpenHands-like observability.
- Aider-like context quality.
- Codex-like safety and patch discipline.
- OpenCode-like provider flexibility.
- Gemini-like broad exploration.
- Goose-like extension ecosystem.

The first milestone should avoid multi-agent complexity. Start with one excellent coding loop that can understand a repo, edit files safely, run tests, show diffs, and recover from failure.

---

## Implementation Status Summary

**All 12 feature areas have been implemented:**

| # | Feature | Status | Key Components |
|---|---------|--------|----------------|
| 1 | Context Selection | ✅ | `ContextBundleBuilder`, `ContextRanker`, `GitActivityReader`, `RepoMapLite`, `SymbolExtractor`, `DependencyGraph` |
| 2 | Tool Security | ✅ | `PolicyEngine`, `CapabilityRegistry`, `SecretScanner` |
| 3 | Patch Reliability | ✅ | `EditFormatSelector`, `PatchParser`, `StructuredPatchApplier`, `DiffRenderer`, `RollbackManager` |
| 4 | Verification Quality | ✅ | `CommandDiscovery`, `CommandRunner`, `VerificationReporter`, `VerificationPipeline`, `ChangeClassifier`, `TestMapper`, `VerificationPlanner` |
| 5 | Frontend Observability | ✅ | `EventLog`, `Replay`, `SessionReader`, `Projection`, UI (`app.js`, `index.html`) |
| 6 | Provider Neutrality | ✅ | 13 providers (Anthropic, OpenAI, Gemini, Groq, Deepseek, Ollama, etc.) |
| 7 | Autonomy Control | ✅ | `TaskStateMachine`, `RunLimiter`, `ScopeTracker`, `CheckpointManager` |
| 8 | Extension Model | ✅ | `ExtensionRegistry`, `SkillLoader`, `HookRunner`, `MCP Manager`, `Skills catalog` |
| 9 | Tool Schema Explosion | ✅ | `ToolCatalog`, `ToolDiscovery`, `ToolSelector`, `ToolCache`, `MetaTool` |
| 10 | Multi-Agent Coordination | ✅ | `SubagentManager`, `OwnershipRegistry`, `MergeCoordinator`, `ResultContractValidator` |
| 11 | Memory | ✅ | `RepoIndexStore`, `UserPreferenceStore`, `MemoryInspector`, `ToolCache` |
| 12 | Server/Transport | ✅ | `Server`, `SSE` transport |

**Remaining (deferred):**
- Semantic/symbolic search index
- Tree-sitter-based repo map
- LSP diagnostics
- Browser automation
- Docker/remote runtimes
- ACP compatibility

See `docs/architecture/implementation-readiness.md` for full source structure.
