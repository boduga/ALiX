# DOX — Tools

## Purpose

The model-callable tool surface — how a tool call is authorized,
resolved to a router, executed, and turned into a `ToolResult` the loop can
reason about.

## Ownership

- `tool-registry.ts` — Capability cards for every tool: canonical name,
  capability id, policy key, risk, and whether it mutates.
- `tool-router.ts` — `FileToolRouter` (file/patch/schedule) and the other
  routers. Resolves an already-authorized call to a filesystem or store
  operation.
- `executor.ts` — `ToolExecutor`: composes `PolicyGate` + `ToolRouter`, runs
  the call, and owns the `boundTools` path that workers use.
- `effect-replay-guard.ts` — durable unresolved-effect claims for high-impact routed tools.
- `shell-execution-directory.ts` — shared canonical execution-directory identity for the shell router and replay guard.
- `safe-shell.ts` / `shell-tool.ts` / `shell-pool.ts` — Shell admission and
  execution, including the safe-shell grammar.
- `shell-network-policy.ts` — Network policy applied to shell clients, so
  `curl`/`wget` cannot bypass the `alix_web_fetch` domain allowlist.
- `collaboration-tools.ts` — Bound collaboration tools a worker sees.
- `result-text.ts` — Renders a `ToolResult` into the text the model reads.
- `web-fetch.ts` / `web-search.ts` / `state-query.ts` / `monitor-tool.ts` /
  `claim-verification-tool.ts` / `state-proposal-tool.ts` / `misc-tools.ts` —
  Individual tool implementations.
- `capability-map.ts` — Tool name to capability id mapping.
- `ignore.ts` — Shared ignore rules for every workspace walk.
- `self-extend/` — hook and skill authoring plus extension inspection, routed by
  `SelfExtendToolRouter`. The executor ids are `hook.create`, `skill.create`,
  `extension.list`, and `extension.inspect`; model-facing names are in
  `src/agents/tool-manifest.ts`. Change the mappings together when renaming.

## Local Contracts

- **Ambiguous high-impact routed effects are quarantined before automatic replay.** `executeWithEffectReplayGuard` wraps ordinary dispatch, continuation resume and safe-shell dispatch after authorization. Registry-marked high/critical mutating tools (including dynamic MCP) require an exclusive, fsynced claim under `.alix/effect-replay/v1` before adapter entry; only conservatively classified safe-shell read commands are exempt. `rg` is never exempt: executable preprocessing flags such as `--pre` can be admitted by the shell grammar even when quoted. Identity is canonical workspace, routed tool and stable repaired arguments, independent of call/session/agent/approval identities. Shell identity uses command and execution cwd, excluding timeout and pool controls. The shared shell execution-directory resolver canonicalizes existing cwd aliases and resolves relative cwd from the workspace. Safe-shell execution always fingerprints and executes at the canonical router root because that branch ignores request cwd; both non-persistent and persistent non-safe-shell execution use the resolved directory. Cwd-only variations cannot bypass a retained safe-shell claim. Normal success releases the claim; every returned error is conservatively uncertain/non-retryable, and throws, cancellation and crashes retain it. Existing, malformed or unwritable claims fail closed. No TTL, PID reclaim, model flag, bypass mode or fresh approval clears a claim. Human reconciliation must establish the external outcome before any manual state recovery; no model-facing clearing tool exists. This is bounded admission control, not global exactly-once: changed commands/arguments, other workspaces, adapter-internal retries, direct provider/extension effects and old executions without claims remain outside this identity boundary. Approval receipts retain their separate authority.

- **Persistent shell execution directory is fixed.** The router rejects a canonical cwd different from an existing pool’s initial cwd. Routed pool commands use isolated subshells pinned to that cwd; command-driven directory and environment changes do not survive into later commands. Direct ShellPool users retain legacy state persistence unless they select fixed cwd. A busy pool rejects concurrent entry; timeout, cancellation, transport error or exit before its unique completion marker permanently closes the pool. Nonzero command status is an error, retaining the replay claim. Neither timeout nor a new invocation recreates that router’s pool. Non-persistent requests may use genuinely different directories; they cannot silently execute in an earlier pool directory.

- `sessionIdFromDirectory` in `executor.ts` extracts session identity using either directory separator; approvals, continuations, and tool artifacts use the same identity on every supported host.

- **The registry owns routed tool metadata.** Each entry pairs an internal
  executor ID with its capability id, policy key, risk, and `mutates` flag. `ALIX_BUILTIN_EXECUTORS` (`src/agents/tool-manifest.ts`) is the
  model-facing surface and `ToolName`/`ToolNameSchema` derive from it, so a
  tool that is not in the manifest has no name the model can call and no type
  that admits it. Every registry entry must have a manifest counterpart.
- **One tool/capability catalogue (R5.3).** `tool-registry.ts` is the single catalogue and implements the `ToolCapabilityRegistry` R1 port via `createToolCapabilityRegistry()` (`resolve`/`list`). Display layers (`card-registry.ts` / card loader) derive from it, and the agent-manifest adapters conform to it: `capability-map.ts` resolves through the port (dynamic `mcp.*` included) and `tool-name-resolver.ts` rejects routable executors absent from the catalogue. Intentional exceptions: interception-before-routing (`alix_execution_state_propose`) and bound collaboration tools, which never route. The freeze rule allows each cataloged definition only in its home module.
- **`ToolExecutor` has one construction seam (R5.3b).** `executor.ts` is value-imported only by `tool-executor-factory.ts` (`createToolExecutor`); every composition site constructs through the factory. The pure `hashArgs` helper lives in `hash-args.ts`, not the executor. `direct-tool-dispatch` allows the factory as the single sanctioned importer.
- Full file reads measure LF-delimited lines from actual returned content before telemetry truncation. Empty content reports zero; a trailing LF terminates its line without adding an empty line. Successful completion events forward only nonnegative safe-integer measurements supplied by tools. Missing measurements stay absent; request ranges and output previews never establish counts.
- Router cancellation emits a best-effort correlated cancelled completion event, then rethrows the original cancellation. Telemetry failure must not replace cancellation with failure; cancelled calls emit neither successful output nor failed-tool events.
- **The policy gate runs first, and it is not optional.** `ToolExecutor`
  authorizes through `PolicyGate` before any router sees a call. A router's own
  checks are a SECOND, narrower safety net — never the authorization.
- **Approval-required dispatch is a nonterminal pause.** Persist the
  continuation and return the structured approval id without emitting
  `tool.failed`; `handleToolCall` waits up to five minutes for the durable
  decision and re-dispatches the same tool call after approval. Only a real
  denial, expiry, cancellation, or execution error terminalizes the tool card.
- **Tool telemetry is fail-open (P0).** All EventLog writes on the tool path go
  through `telemetry.ts:emitToolTelemetry` (`ToolExecutor.logEvent`, the
  artifact-created notification, the `observability.metric` emissions, and the
  file/patch/MCP router writes) or an equivalent local try/catch
  (`measurePhase`, subagent lifecycle). Under cross-process lock contention an
  append can throw at the 5s acquisition deadline — that must never turn a
  successful tool into a failure. ToolResults (and artifact files) are
  authoritative; events are best-effort. Pinned by
  `tests/tools/executor-events.test.ts` ("tool execution survives EventLog
  append failure").
- **Owned-write authorization is not decided here.** `isOwnedWriteTarget` in
  `tool-router.ts` calls `isWithinOwnedScope`, the single matcher also used by
  the gate. Both points MUST call that one function; neither may re-normalize,
  because the gate runs first. The contract is owned by
  `src/coordination/ownership/AGENTS.md` — read it there, not here. The
  backstop covers `file.create` for NEW files as well as overwrites and
  `file.delete`: a new file outside the declared owned scope used to be created
  with no denial, because only the overwrite branch consulted the scope.
- **Containment belongs to `WorkspacePathResolver`.** `execute()` runs
  `checkPath` for every path argument before dispatch, which resolves symlinks
  and canonicalizes. A second hand-rolled `relative`/`startsWith` check in a
  router case is a laxer copy of a rule already enforced — do not add one.
- `alix_collaboration_*` reach a worker only as bound tools, which bypass
  `filterTools` entirely. They are deliberately in neither the read nor the
  write policy set; see `src/agents/AGENTS.md`. **R1.5:** bound tools are
  still authorized — `handleToolCall` calls `ToolExecutor.authorizeBoundTool`
  (same PolicyGate pipeline as dispatch) before the handler runs: `allow` →
  run, `ask` → durable approval wait, `deny`/unbacked-ask → `Access denied`.
  The handler never runs ungoverned.
- **A cited approval is claimed exactly once, in `dispatch`, before any router runs.** `ToolExecutor.dispatch` calls `claimApproval` on an allowed decision that cites a durable approval (`decision.approvalId && !decision.approvalConsumed`) and on the continuation branch after the ownership gate. That claim is the single consumed-once seam for both execution routes: a concurrent or fresh-process replay loses the race and is denied, never executed. `claimApproval` fails closed when no store can atomically consume, and the post-claim outcome (`succeeded`/`failed`/`cancelled`) is reported so a crash between claim and execution stays `pending` and is later classified `unverified` rather than reissued. The coordination exact-binding branch already consumed in-gate and reports `approvalConsumed: true`, so dispatch skips its claim. Owner: `src/governance/approvals/AGENTS.md`.
- **Continuation storage stays behind its existing executor seam.** `pendingContinuations`, `bindContinuationWorker` and `resumeApprovedContinuation` are host APIs, not model-facing tools. They retain store construction inside the existing authorized importer, bind only still-pending/approved records, refuse replacement of an existing differing worker-attribution snapshot, and resume through `ContinuationManager` plus the executor's normal ownership/invocation/single-use claim checks. No raw approval decision method is exposed. Hosts must supply trusted scope and consumer context before invoking resumption.
- **Continuation resumes re-validate authorization (R1.5).** A request with
  `source: "continuation-resume"` must carry `approvalId`, and the executor
  independently checks the durable record (present, `approved`, not expired)
  before dispatch. Caller-set `source` alone is never authorization; missing
  or invalid evidence returns `denied`.
- Continuation resumes check `AbortSignal` after ownership validation before claiming approval, and again immediately before downstream dispatch after claim/telemetry awaits. An observed abort throws `ExecutionCancelledError` without dispatching; cancellation after a successful claim records `cancelled` and never restores approval authority. Cancellation before claim leaves the approval untouched.
- **An unknown outcome writes no receipt on EITHER dispatch route.** A result flagged `outcomeUnknown` proves neither success nor failure, so `dispatch` records no execution receipt and the claim stays `pending` (later classified `unverified`, fail-closed, never reissued) instead of being promoted to `succeeded` or retired as `failed`. The ordinary path and the continuation branch share that rule; the continuation branch previously returned before reaching it, so an unknown resumed result was recorded `failed` and permanently retired a single-use approval that may have applied its effect. **Thrown router exceptions are also uncertain:** once the router is entered, the executor cannot establish whether a side effect occurred before the exception, so a consumed claim remains `pending` rather than fabricating a `failed` receipt. Explicit cancellation retains `cancelled`. Adapters should still return `{ kind: "error", outcomeUnknown: true }` when they can report an indeterminate outcome without throwing. This is conservative, not proof of exactly-once external effects. Pinned by `tests/security/continuation-unknown-outcome.vitest.ts` (ordinary and resumed × success/error/unknown parity).
- **`alix_file_delete` shares the owned-write second net.** When the request
  declares `ownedPaths`, the router runs the same `isOwnedWriteTarget` /
  `isWithinOwnedScope` check `alix_file_create` uses for overwrites — a worker
  may only delete inside its own scope. Requests with no declared ownership
  (operator context) are unchanged and governed by the gate.
- Sensitive-path denials are hard, non-retryable, and are never escalated to an
  approval request — see the root `AGENTS.md`.
- **`alix_web_fetch` recovers JSON-LD article content before stripping scripts.** Many
  article/list pages serve their body as `application/ld+json` (schema.org
  `Article`/`NewsArticle`), so removing every `<script>` deleted the real content
  and returned only navigation chrome — an external fetch of a presidents page
  yielded 423 bytes of nav and none of the list (session `1791833097742`).
  `extractJsonLdText` lifts the descriptive fields (`headline`, `name`,
  `description`, `articleBody`, `text`, `abstract`, including `@graph` documents)
  out first, tolerates malformed blocks, and deduplicates across blocks. Only
  those fields are read and the payload stays untrusted fetched DATA — never
  instructions. Executable scripts must still be stripped: a `<script>` whose
  body is never `application/ld+json` must not reach the model.
- **Web search degrades, then falls back.** `web-search.ts` uses the configured
  `search.provider`. A SearXNG run that is unconfigured, unreachable, errored,
  or returned no results with `unresponsive_engines` (e.g. `duckduckgo (CAPTCHA)`)
  is a DEGRADED backend, not a no-match: it returns `ok:false` and the tool
  falls back to Brave when the Brave key is configured, then surfaces both
  failures if neither works. A responsive SearXNG with a genuine empty result
  is returned as-is (no fallback).

## Work Guidance

- Adding a tool means touching `tool-registry.ts`, `ALIX_BUILTIN_EXECUTORS`
  (`src/agents/tool-manifest.ts`), the policy sets in `src/agents/tool-policy.ts`,
  and the DOX above. They drift silently otherwise. `tests/tools/tool-contract.vitest.ts`
  pins the registry shape and the derived views; it fails on a count change, so
  update it deliberately rather than to silence it.
- Path-handling changes need `tests/tools/tool-router.test.ts`; an
  authorization change also needs `tests/policy/policy-gate.test.ts`, because a
  router-only test cannot reach the gate that runs first.
- Adding or REMOVING a tool changes what the model may call, which is an
  authorization surface: `tests/tools/tool-authorization-parity.test.ts` pins
  the full offered/allowed/routable set in both directions so a removal cannot
  silently shrink it. A spot check proves the new cases work and says nothing
  about what stopped working.

## Verification

- `tests/security/persistent-shell-cwd.vitest.ts` — production ShellPool/executor timeout-after-effect replay, changed-cwd rejection, relative/absolute/symlink aliases, safe-shell/non-persistent directory parity, cd isolation, busy/closed/cancelled transport and nonzero exit coverage.
- `tests/security/effect-replay-guard.test.ts` — effect parity, concurrent claims, fresh-process SIGKILL recovery, shell transport changes, real partial shell failures and fresh approvals across dispatch/resume modes.
- `tests/security/effect-replay-boundary.vitest.ts` — executor boundary coverage for unknown/error/throw/success, fresh identities, continuation approvals, MCP, read-only/idempotent controls, real rg preprocessing counters across ask/auto/bypass, safe-shell cwd-only replay denial, distinct non-safe-shell working directories and claim storage failures.
- `tests/tools/tool-router.test.ts` — dispatch, owned writes, containment.
- `tests/unit/safe-shell.test.ts` — shell admission grammar.
- `tests/policy/policy-gate.test.ts` — the authorization decision that runs
  before any of this.
- `tests/security/legacy-approval-single-use.test.ts` — the dispatch claim on
  the ordinary retry and continuation routes (one real effect, replay denied).
- `tests/security/approval-crash-recovery.test.ts` — post-claim outcome
  reporting and crash classification.
- `tests/security/continuation-cancellation.vitest.ts` — aborted resumes before claim and after claim/telemetry, unchanged pre-claim authority, cancelled receipts, no filesystem effects, and active/legacy controls.
- `tests/security/continuation-unknown-outcome.vitest.ts` — the `outcomeUnknown` receipt rule across ordinary dispatch and continuation resume (success/error/unknown parity), plus unknown-outcome replay denial with the claim left `pending`.

## Child DOX Index

This directory has no child `AGENTS.md` files. The rules it enforces are
documented at their owners: `src/coordination/ownership/AGENTS.md` (owned scopes) and
`src/governance/policy/AGENTS.md` (the gate).
