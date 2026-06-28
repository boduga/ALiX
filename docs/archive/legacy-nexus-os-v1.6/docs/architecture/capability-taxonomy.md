# Capability Taxonomy

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 21. Capability Taxonomy

The Capability Taxonomy is the canonical, versioned enumeration of all capability identifiers. It is the ground truth used by the policy engine to validate Tool Cards, Agent Cards, and SOP Packs. Every capability has an identifier, a human description, and a default risk tier.

### 21.1 Schema

```typescript
type Capability = {
  id: string;           // dot-namespaced, e.g. "filesystem.write"
  description: string;
  riskTier: 0 | 1 | 2 | 3 | 4 | 5;
  requiresSandbox: boolean;
  requiresApproval: boolean;  // at default risk tier
  sideEffects: string[];
  version: string;      // semver, updated when semantics change
};
```

### 21.2 Core Capability Set (v1.0)

| Capability ID | Description | Risk Tier |
|---|---|---|
| `memory.read` | Read from any memory store | 0 |
| `filesystem.read` | Read files within declared workspace | 0 |
| `repo.read` | Read repository files and metadata | 0 |
| `web.search` | Execute a read-only web search query | 0 |
| `memory.write.session` | Write episodic memory scoped to the current session | 1 |
| `memory.write.project` | Write project-scoped memory | 1 |
| `filesystem.write` | Create or modify files within declared workspace | 1 |
| `artifact.create` | Produce an artifact output | 1 |
| `shell.exec` | Execute a shell command in sandboxed workspace | 2 |
| `web.fetch` | Fetch full URL content | 2 |
| `package.install` | Install a package in a sandboxed environment | 2 |
| `process.spawn` | Spawn a child process | 2 |
| `memory.write.user` | Write user-scoped persistent memory | 2 |
| `memory.write.global` | Write global-scoped memory | 2 |
| `github.read` | Read from GitHub API | 2 |
| `github.write` | Write to GitHub (push, PR, comment) | 3 |
| `email.draft` | Create an email draft | 3 |
| `email.send` | Send an email | 3 |
| `calendar.write` | Create or modify calendar events | 3 |
| `docker.read` | Inspect Docker state | 2 |
| `docker.exec` | Execute inside a container | 3 |
| `docker.deploy` | Deploy or restart a container | 3 |
| `citation.verify` | Verify source credibility and claim grounding | 1 |
| `graph.mutate` | Modify a running TaskGraph | 2 |
| `agent.spawn` | Spawn a subagent | 2 |
| `agent.delegate` | Delegate a task to another agent | 2 |
| `memory.prune` | Delete or deprecate memory records | 2 |
| `secret.read` | Access a declared secret by name | 4 |
| `secret.write` | Write or rotate a secret | 4 |
| `firewall.modify` | Change network firewall rules | 4 |
| `payment.initiate` | Initiate a payment transaction | 4 |
| `filesystem.delete.bulk` | Delete many files or directories | 5 |
| `shell.sudo` | Execute with elevated privileges | 5 |
| `production.deploy` | Deploy to a production environment | 5 |

### 21.3 Taxonomy Rules

- All Tool Cards and Agent Cards must reference only IDs in the canonical taxonomy.
- Tool Cards that reference an undefined capability ID fail validation.
- New capabilities must be added to the taxonomy before being referenced.
- Capability IDs are stable; semantics changes bump the capability `version` and require a migration note.
- The taxonomy is exposed through `alix capability list` and `alix capability explain <id>`.

---

## 44. Capability Namespace and Extension Rules

The Capability Taxonomy must support controlled extension without allowing plugins to redefine core permissions.

### 44.1 Reserved Namespaces

| Namespace | Owner | Example |
|---|---|---|
| `core.*` | ALiX core | `core.inspect` |
| `filesystem.*` | ALiX core | `filesystem.write` |
| `memory.*` | ALiX core | `memory.write.project` |
| `repo.*` | ALiX core | `repo.read` |
| `web.*` | ALiX core | `web.search` |
| `shell.*` | ALiX core | `shell.exec` |
| `docker.*` | ALiX core | `docker.read` |
| `github.*` | ALiX core or official connector | `github.write` |
| `email.*` | ALiX core or official connector | `email.send` |
| `calendar.*` | ALiX core or official connector | `calendar.write` |
| `agent.*` | ALiX core | `agent.spawn` |
| `graph.*` | ALiX core | `graph.mutate` |
| `secret.*` | ALiX core | `secret.read` |
| `payment.*` | ALiX core or official connector | `payment.initiate` |
| `extension.<publisher>.*` | Extension publisher | `extension.acme.crm.read` |

### 44.2 Extension Rules

- Only ALiX core maintainers may add non-extension namespace capabilities.
- Third-party extensions must use `extension.<publisher>.*` unless a capability is formally promoted into core.
- Extension capabilities must declare risk tier, side effects, required sandbox, and approval defaults.
- Capability IDs are immutable once published.
- Capability deprecation requires a migration note and a compatibility window.
- A plugin cannot declare a capability that shadows or aliases a core capability.

---
