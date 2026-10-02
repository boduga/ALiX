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
  `extension.list`, and `extension.inspect`; the model-facing names are in
  `src/agents/tool-manifest.ts`. This is a recorded divergence from the
  `<domain>.<action>` executor shape used by the rest of the surface, so a
  future rename must move all four together.

## Local Contracts

- **The registry is the only list of tools.** 24 entries, each pairing an
  internal executor ID with its capability id, policy key, risk, and `mutates`
  flag. `ALIX_BUILTIN_EXECUTORS` (`src/agents/tool-manifest.ts`) is the
  model-facing surface and `ToolName`/`ToolNameSchema` derive from it, so a
  tool that is not in the manifest has no name the model can call and no type
  that admits it. A registry entry with no manifest counterpart is a defect —
  `dir.search` was exactly that, dispatchable with no name, and was deleted.
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

- `tests/tools/tool-router.test.ts` — dispatch, owned writes, containment.
- `tests/unit/safe-shell.test.ts` — shell admission grammar.
- `tests/policy/policy-gate.test.ts` — the authorization decision that runs
  before any of this.

## Child DOX Index

This directory has no child `AGENTS.md` files. The rules it enforces are
documented at their owners: `src/ownership/AGENTS.md` (owned scopes) and
`src/policy/AGENTS.md` (the gate).
