# DOX — Tools

**Purpose:** The model-callable tool surface — how a tool call is authorized,
resolved to a router, executed, and turned into a `ToolResult` the loop can
reason about.

**Ownership:**
- `tool-registry.ts` — Capability cards for every tool: canonical name,
  capability id, policy key, risk, and whether it mutates.
- `tool-router.ts` — `FileToolRouter` (file/patch/schedule) and the other
  routers. Resolves an already-authorized call to a filesystem or store
  operation.
- `executor.ts` — `ToolExecutor`: composes `PolicyGate` + `ToolRouter`, runs
  the call, and owns the `boundTools` path that workers use.
- `safe-shell.ts` / `shell-tool.ts` / `shell-pool.ts` — Shell admission and
  execution, including the safe-shell grammar.
- `shell-network-policy.ts` — Network policy applied to shell clients, so
  `curl`/`wget` cannot bypass the `web_fetch` domain allowlist.
- `collaboration-tools.ts` — Bound collaboration tools a worker sees.
- `result-text.ts` — Renders a `ToolResult` into the text the model reads.
- `web-fetch.ts` / `web-search.ts` / `state-query.ts` / `monitor-tool.ts` /
  `claim-verification-tool.ts` / `state-proposal-tool.ts` / `misc-tools.ts` —
  Individual tool implementations.
- `capability-map.ts` — Tool name to capability id mapping.
- `ignore.ts` — Shared ignore rules for every workspace walk.

## Local Contracts

- **The policy gate runs first, and it is not optional.** `ToolExecutor`
  authorizes through `PolicyGate` before any router sees a call. A router's own
  checks are a SECOND, narrower safety net — never the authorization.
- **Owned-write authorization is not decided here.** `isOwnedWriteTarget` in
  `tool-router.ts` calls `isWithinOwnedScope`, the single matcher also used by
  the gate. Both points MUST call that one function; neither may re-normalize,
  because the gate running first means a divergence silently denies every owned
  write the router would have allowed. The contract is owned by
  `src/ownership/AGENTS.md` — read it there, not here.
- **Containment belongs to `WorkspacePathResolver`.** `execute()` runs
  `checkPath` for every path argument before dispatch, which resolves symlinks
  and canonicalizes. A second hand-rolled `relative`/`startsWith` check in a
  router case is a laxer copy of a rule already enforced — do not add one.
- `alix_collaboration_*` reach a worker only as bound tools, which bypass
  `filterTools` entirely. They are deliberately in neither the read nor the write
  policy set; see `src/agents/AGENTS.md`.
- Sensitive-path denials are hard, non-retryable, and are never escalated to an
  approval request — see the root `AGENTS.md`.

## Work Guidance

- Adding a tool means touching `tool-registry.ts`, `ALIX_BUILTIN_EXECUTORS`
  (`src/agents/tool-manifest.ts`), the policy sets in `src/agents/tool-policy.ts`,
  and the DOX above. They drift silently otherwise.
- Path-handling changes need `tests/tools/tool-router.test.ts`; an
  authorization change also needs `tests/policy/policy-gate.test.ts`, because a
  router-only test cannot reach the gate that runs first.

## Verification

- `tests/tools/tool-router.test.ts` — dispatch, owned writes, containment.
- `tests/unit/safe-shell.test.ts` — shell admission grammar.
- `tests/policy/policy-gate.test.ts` — the authorization decision that runs
  before any of this.

## Child DOX Index

This directory has no child `AGENTS.md` files. The rules it enforces are
documented at their owners: `src/ownership/AGENTS.md` (owned scopes) and
`src/policy/AGENTS.md` (the gate).
