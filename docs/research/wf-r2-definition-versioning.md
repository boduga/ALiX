# Research: Definition versioning conventions in adjacent registries

**Source ticket:** wayfinder #474 — https://github.com/boduga/ALiX/issues/474
**Date:** 2026-08-10
**Feeds:** greenfield capability refactor — spec `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md` §8 (Capability Identity), §65 (Versioning), §66 (Historical Immutability).

## Headline finding

**Adjacent registries converge on a three-part model:** (1) a *definition* is versioned by an **immutable, unique, per-publication SemVer-style string** (MAJOR.MINOR.PATCH, prerelease allowed); (2) the registry **retains every published version** — overwrite-in-place is prohibited — and resolves "current" as the **highest/`latest` version** or an explicit alias, never by mutating an old version; (3) **governance/history references pin the exact `id@version`** and remain valid even when the catalog (the mutable "current state" view) moves on. Two adjacent ecosystems that ALiX already touches — Claude Code plugins and the MCP registry — reject short forms like `"1.0"` outright, which matters because ALiX's `Capability.version` is currently the string `"1.0"`.

---

## (a) Version semantics found (with sources)

| Ecosystem | Definition artifact | Version form | Enforcement |
|---|---|---|---|
| Claude Code plugin | `plugin.json` manifest | Full SemVer `MAJOR.MINOR.PATCH` (`"1.0.0"`), prerelease suffixes OK, optional w/ default `"0.1.0"` | Validated on load; `"1.0"` is an explicit **invalid** example |
| MCP Registry | `server.json` (published server) | SemVer **recommended**; any string allowed; **ranges prohibited** (`^1.2.3`, `1.x`, `||`); "semantic date" (`2025.11.25`) allowed | Unique per publication; **immutable after publish**; non-SemVer strings are forced to "latest" |
| VS Code extension | `package.json` `version` | SemVer-compatible per docs, but Marketplace enforces **numeric `#.#.#[.#]` only** (1–4 dotted ints, no prerelease/build metadata) | `vsce publish` rejects prerelease suffixes at upload |
| npm package | `package.json` `version` | SemVer; `package@version` name/version pair **immutable and never reusable** | Publish refuses overwrite; unpublish only within 72h (or narrow criteria); long-term remedy is `deprecate`, not delete |
| Anthropic Agent Skill | `SKILL.md` frontmatter `metadata.version` (per-skill) + `marketplace.json` `plugins[].version` + `metadata.version` (marketplace-level) | SemVer; MAJOR = contract break (name/description/allowed-tools/requires change), MINOR = additive, PATCH = prose | Version bump must ship in same commit as the skill change; git tag `plugins/{name}/v{X.Y.Z}` |
| Content-addressed registries (OCI/IPFS, sema spec) | the artifact itself | **Content hash (CID / `sha256:`)** — the hash IS the immutable version; human-readable handle is a mutable pointer | New content → new hash; old hash resolves forever; supersession via metadata (`_meta.supersedes`), a *claim*, not enforcement |

Key nuance surfaced repeatedly: **definition/artifact versioning ≠ dependency versioning.** The *artifact* version is an immutable, publish-time stamp; the *dependency* range (`^1.2.3`, `>=`) is a separate, resolver-side concept. MCP explicitly bans ranges *as version strings* precisely to keep these layers distinct, and VS Code uses `engines.vscode` (ranges) alongside the artifact `version` (exact).

Sources:
- [Anthropic plugin manifest reference](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/plugin-structure/references/manifest-reference.md) — SemVer, `"1.0"` invalid, default `0.1.0`
- [MCP Registry — Versioning Published MCP Servers](https://modelcontextprotocol.io/registry/versioning) — unique/immutable version per publication, ranges prohibited, non-SemVer → "latest"
- [MCP server versioning RFC/discussion #727](https://github.com/orgs/modelcontextprotocol/discussions/727) — "version blindness" problem; `server/discover` capability advertisement
- [VS Code extension manifest](https://code.visualstudio.com/api/references/extension-manifest) + [vsmarketplace #50 "SemVer not actually supported"](https://github.com/microsoft/vsmarketplace/issues/50) — numeric `#.#.#.#` only
- [npm Unpublish Policy](https://docs.npmjs.com/policies/unpublish) — immutable publish, no overwrite, deprecate preferred
- [anthropics/skills marketplace & plugin system](https://deepwiki.com/anthropics/skills/2.3-marketplace-and-plugin-system) + [skills PR #208](https://github.com/anthropics/skills/pull/208) — `metadata.version` vs `plugins[].version`; git tag convention
- [sema specification /versioning.md](https://github.com/emergent-wisdom/sema/blob/main/docs/specification/versioning.md) — hash immutable, handle mutable, `_meta.supersedes`

---

## (b) Historical retention + active-version resolution patterns

**Historical retention — every adjacent registry retains all versions and forbids overwrite:**
- npm: "once published, a package cannot change"; a `package@version` is never reusable; unpublish is a narrow 72h escape hatch, deprecation is the long-term remedy (historical versions stay downloadable with a warning).
- MCP Registry: each publication's version string + metadata is **immutable**; a new publication means a new version.
- Anthropic skills: version bump must be a new commit/tag (`plugins/{name}/v{X.Y.Z}`); old tags/versions remain in the repo/marketplace cache.
- Content-addressed: old hash resolves forever by construction.

**Active-version resolution — "current" is computed, never stored as a mutation:**
- **Highest SemVer wins** (npm, MCP). MCP aggregator ordering: explicit `latest` flag → SemVer compare → publish timestamp → non-SemVer loses.
- **Explicit `latest` tag/flag** (npm `dist-tags`, MCP `latest` marker). npm `dist-tags` is the canonical "alias" mechanism — `npm dist-tag add pkg@1.2.3 latest`, plus arbitrary tags.
- **Alias/`default` pointer** (sema: mutable "handle" → immutable hash; VS Code marketplace: extension "latest version" computed from numeric sort).
- **Pin vs latest** is a *consumer* choice: exact `package@version` (immutable, reproducible) vs `latest` (rolling). Reproducibility is why lockfiles/`package-lock.json` record exact versions.
- MCP note that bites: a non-SemVer version is forced to `latest`, so a typo'd version silently becomes "current". Date versions (`2025.11.25`) are allowed but recommended against.

---

## (c) Governance/history version-reference patterns

- **History pins `id@version`, and that reference stays valid forever** even after the "current" version moves. MCP's "immutable after publish" is what makes audit references meaningful; npm's "never reuse a version" guarantees a historical pin is unambiguous.
- **Immutability of historical artifacts:** in the content-addressed model, old hash resolves forever; supersession (`_meta.supersedes`) is a *metadata claim*, not a deletion — an audit trail can re-fetch the exact artifact.
- **Corrections create new artifacts** (new version), they never edit the old one — this is the governing pattern for any append-only ledger referencing definitions.
- **Version stamping at write time:** governance records should snapshot the version that was *affected* (the `id@version` present when the decision was recorded), because the catalog/capability table is a mutable "current state" projection. This is exactly the greenfield spec §66 requirement: "historical artifacts MUST continue referring to the exact affected version/state."
- **Drift hazard:** VS Code marketplace case — CI rewrites the manifest version only inside the build runner, causing committed `package.json` to drift from what was published. Audit integrity depends on the published artifact version being the one stamped into history, not a reconstructed one.

---

## (d) ALiX's own versioning precedents (file:line)

| Precedent | Form | Location |
|---|---|---|
| `package.json` (npm package `alix`) | SemVer-ish `"0.5.0"` | `/home/babasola/Projects/Monolith/package.json` (name `alix`, `"version": "0.5.0"`) |
| `Capability.version` | **plain string, currently `"1.0"`** — not full SemVer | `/home/babasola/Projects/Monolith/src/capability/types.ts:6` (`version: string;`); `/home/babasola/Projects/Monolith/src/capability/initial-capabilities.ts:12,25,34,44` (all `version: "1.0"`) |
| `CapabilityManifest` schema version | monotonic integer literal `version: 1` (serialization format version, distinct from definition version) | `/home/babasola/Projects/Monolith/src/capability/registry.ts:16-20,133-135` (`export(): CapabilityManifest` returns `{ version: 1, ... }`) |
| Agent/tool cards (registry) | full SemVer `"1.0.0"` | `/home/babasola/Projects/Monolith/src/registry/card-loader.ts:18-21` (agent cards) and tool-card entries (`version: "1.0.0"`) |
| MCP client identity | `serverInfo.version` string, `clientVersion = "1.0"` default | `/home/babasola/Projects/Monolith/src/mcp/client.ts:32,50` |
| Capability projection store | integer schema version guard (`'capability projection state: invalid or unsupported version'`) | `/home/babasola/Projects/Monolith/src/tui/runtime/capability-projection.ts:185` |
| Governance history | append-only JSONL stores keyed by id + timestamp (e.g. `execution-attempts`, evidence), `id:`/timestamps, no `id@version` pins today | `/home/babasola/Projects/Monolith/src/governance/audit-store.ts`, `src/governance/execution-store.ts`, `src/adaptation/*-store.ts`, `src/security/evidence/evidence-store.ts` |
| Lifecycle overlay (A7) | runtime projection keyed by capabilityId only — **no version component** | `/home/babasola/Projects/Monolith/src/capability/registry.ts:100-122` (`applyLifecycleTransition`/`listLifecycleStates`); `LifecycleState` in `src/adaptation/capability-evolution-types.ts:15-21` |

Pre-existing precedent to note: ALiX already distinguishes **definition `version`** (per-capability string) from **schema `version`** (integer manifest/projection format). The greenfield spec §8 codifies the `id@version` split (`tool.file.read@1.0`, logical identity `tool.file.read`).

---

## (e) Directly adoptable for the ALiX definition-versioning decision

The greenfield spec §65/§66 leaves the version *semantics* open ("The system MUST define whether a version change represents compatible evolution / incompatible evolution / replacement"). Evidence supports the following adoption:

1. **Upgrade `Capability.version` from `"1.0"` to full SemVer `"1.0.0"`** — the two closest adjacent registries (Claude Code plugins, MCP registry) reject short `MAJOR.MINOR`. Keep it a plain string (matches Claude/MCP), but validate `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$` at registration, like Claude's manifest validator. Note ALiX's agent/tool cards already use `"1.0.0"`, so full SemVer is the in-repo norm; the capability layer is the outlier.
2. **Immutable, unique-per-publication versions; never overwrite a `id@version`.** Adopt npm/MCP semantics: a registered `id@1.0.0` is final; changes create `1.0.1`/`1.1.0`/`2.0.0`. The current `register()` (registry.ts:40-50) throws on duplicate `id` — extend the invariant to duplicate `id@version` (or make re-registration at the same version a no-op/error).
3. **Retain historical definitions; resolve active version by highest SemVer (with explicit-pin option).** Matches spec §65 ("The catalog can retain historical definitions. The runtime resolves the active version."). `CapabilityManifest.version: 1` (schema version) stays distinct from definition version — keep that separation.
4. **Version semantics map to SemVer's documented contract:** MAJOR = incompatible (schema/requiredPermissions/execution strategy change), MINOR = backward-compatible addition, PATCH = non-functional metadata. This directly answers the spec §8 open question (compatible/incompatible/replacement ↔ MINOR/MAJOR/MAJOR-with-new-id).
5. **Governance history pins `id@version` at write time; keep the lifecycle ledger keyed by `id@version`-bearing records.** Spec §66 requires historical artifacts to reference the exact affected version. Today the A7 lifecycle overlay is keyed by capabilityId only (registry.ts:100-122) and governance stores don't record version pins — greenfield should stamp the resolved `id@version` into lifecycle transitions and governance records.
6. **Do NOT adopt ranges as version strings** (MCP prohibition) — if ALiX ever needs dependency ranges, keep them in `Capability.dependencies` (separate field, `CapabilityId[]`, types.ts:23) as *dependency* references, distinct from the definition `version`.
7. **Content-addressing is optional/harmonizing, not required:** for a local/registry capability catalog, a SemVer `id@version` pin plus retained artifacts already gives immutable historical reference. A content hash is only worth adding if ALiX ships distributed catalogs or needs cryptographic reproducibility; if added, keep it as a *computed* artifact fingerprint, with the SemVer version as the human-facing pin (sema's hash-immutable/handle-mutable split).

**Bottom line for the decision:** adopt **unique, immutable, full-SemVer per-definition versions** with **historical retention + highest-version-as-active resolution (explicit pin for reproducibility)**, and make **governance history reference the exact `id@version`** — this is the unanimous convention across npm, MCP, Claude Code plugins, VS Code, and Anthropic skills, and it is what the greenfield spec §65/§66 already lean toward.
