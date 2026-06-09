# SOP Packs

SOPs (Standard Operating Procedures) are repeatable, multi-node workflows. Unlike `alix run` which creates a single-node graph from a prompt, an SOP defines a structured graph with multiple nodes, each with a focused goal.

## Built-in SOPs

| ID | Nodes | Tags | Description |
|----|-------|------|-------------|
| `research.deep_report` | 6 | research, report, web | Deep research with scope → search → claims → synthesize → critic → write |
| `infra.docker_compose_audit` | 1 | infra, docker, security, audit | Audit a docker-compose.yml for security and best-practice issues |

## Manifest

Each SOP has a manifest:

```typescript
{
  author: "ALiX",
  version: "1.0.0",
  tags: ["research", "report", "web"],
  nodeCount: 6,
  requiredCapabilities: ["web.search", "web.fetch", "filesystem.write"]
}
```

## Running SOPs

```bash
# SOPs that take a topic
alix sop run research.deep_report --topic "serverless databases"

# SOPs that take a file path
alix sop run infra.docker_compose_audit --path docker-compose.yml

# Generic input
alix sop run <id> --input key=value --input key2=value2

# Plan only (dry-run)
alix sop run research.deep_report --topic "test" --plan-only
```

## Creating a New SOP

1. Create a file in `src/sop/<domain>-<name>.ts`
2. Export a function that returns a `SopDefinition` with:
   - `id` — unique identifier (e.g. `infra.docker_compose_audit`)
   - `name` — human-readable name
   - `description` — one-line summary
   - `manifest` — author, version, tags, nodeCount, requiredCapabilities
   - `buildGraph` — function that returns a `TaskGraph` + `reportDir`
3. Register it in `src/sop/sop-registry.ts`

## Validation

```bash
alix sop doctor
```

Validates all registered SOPs: manifest presence, version, and nodeCount accuracy.
