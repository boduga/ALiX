# Schema Versioning

> Extracted from ALiX Nexus OS PRD v1.4 and converted into a supporting architecture specification.

## 38. Schema Versioning Strategy

All first-class manifests — Agent Cards, Tool Cards, and SOP Packs — carry a `version` field (semver) and a `schemaVersion` field (the version of the manifest schema itself).

### 38.1 Versioning Rules

| Change Type | Version Bump | Migration Required |
|---|---|---|
| Adding an optional field | Patch (`1.0.x`) | No |
| Adding a required field | Minor (`1.x.0`) | Yes — migration guide required |
| Renaming or removing a field | Major (`x.0.0`) | Yes — migration guide + deprecation window |
| Changing a field's type | Major (`x.0.0`) | Yes — migration guide + deprecation window |
| Changing a capability ID | Patch on capability; potential Major on manifest | Capability migration note required |

### 38.2 Compatibility Policy

- ALiX must be able to read manifests from the previous minor version without error.
- ALiX warns on manifests from two or more minor versions behind.
- ALiX rejects manifests from a different major version unless a migration command is run.

### 38.3 Migration Commands

```
alix migrate agent-cards --dry-run
alix migrate tool-cards --apply
alix migrate sop-packs --apply
alix schema validate --type agent-card --file my_agent.yaml
```

### 38.4 Schema Registry

The canonical schemas are stored in `schemas/`:

```
schemas/
  agent_card/v1.0.schema.json
  tool_card/v1.0.schema.json
  sop_pack/v1.0.schema.json
  event_envelope/v1.0.schema.json
  task_graph/v1.0.schema.json
  capability/v1.0.schema.json
```

---
