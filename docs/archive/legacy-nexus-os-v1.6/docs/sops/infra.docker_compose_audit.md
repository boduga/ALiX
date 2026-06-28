# SOP: infra.docker_compose_audit

## Purpose

Audit Docker Compose files for networking, secrets, health checks, volumes, restart policy, image pinning, exposed ports, service dependencies, and unsafe defaults.

## Required Output Artifacts

| Artifact | Required | Purpose |
|---|---|---|
| `compose_inventory.json` | Yes | Parsed services, networks, volumes, ports, images, environment variables |
| `risk_report.md` | Yes | Human-readable risk findings grouped by severity |
| `suggested_patch.diff` | Yes | Optional remediation patch; never auto-applied by default |
| `healthcheck_recommendations.md` | Yes | Health check gaps and recommended probes |
| `network_volume_analysis.md` | Yes | Network exposure and volume persistence analysis |
| `secret_exposure_report.md` | Yes | Potential secret leakage, redacted |
| `rollback_plan.md` | Yes | Safe rollback instructions if patch is applied later |
| `run_manifest.json` | Yes | Graph, agents, models, tools, costs, timestamps |

## Acceptance Criteria

- No deployment occurs.
- No containers are stopped, restarted, or modified.
- Secrets are redacted in every artifact.
- Every high-risk finding has a remediation suggestion.
- Suggested patch is optional and not auto-applied.
- Risk report separates critical, high, medium, low, and informational findings.
- The SOP must run without requiring Docker daemon write access.

## Demo Command

```bash
alix sop run infra.docker_compose_audit --file docker-compose.yml
```
