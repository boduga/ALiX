# Capabilities

## Overview

The capability subsystem is ALiX's model-facing surface and its runtime extension machinery: the canonical capability catalog and its lifecycle resolver, the agent/tool card registry, the `alix_*` tool catalog and executor, MCP client integration, skill discovery and sandboxing, filesystem extensions, and process-local self-extension. Every model-visible action passes through the tool executor, which composes authorization with dispatch.

## Subdirectories & Boundaries

- Capability: [./capability/README.md](./capability/README.md) - The canonical capability catalog, provider-executor registry, lifecycle-aware resolver, and invocation runtime behind `CapabilityService`.
- Extensions: [./extensions/README.md](./extensions/README.md) - Filesystem-backed `EXTENSION.yaml` manifests (skill, hook, MCP server, recipe, subagent), their install/uninstall flow, and grouped runtime loading.
- Integrations: [./integrations/README.md](./integrations/README.md) - Adapters binding concrete session implementations to `core.session.*` capability ids, kept outside the capability core to avoid domain dependencies.
- MCP: [./mcp/README.md](./mcp/README.md) - Client side of the Model Context Protocol: transports, server lifecycle, tool adaptation, schema caching, and ranked tool selection.
- Registry: [./registry/README.md](./registry/README.md) - Agent and tool cards, their validation, and the resolver that matches a task node's required capabilities.
- Self-Extend: [./self-extend/README.md](./self-extend/README.md) - In-process registration of skills and hooks for the current process only; nothing is persisted.
- Skills: [./skills/README.md](./skills/README.md) - `SKILL.md` discovery, install trust gating, package scanning, slash routing, sandboxed execution, and candidate promotion.
- Tools: [./tools/README.md](./tools/README.md) - The `alix_*` catalogue, `ToolExecutor`, family routers, and individual tool implementations.
