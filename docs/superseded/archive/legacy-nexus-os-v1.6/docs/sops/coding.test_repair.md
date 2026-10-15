# SOP: coding.test_repair

### 33.3 coding.test_repair Acceptance Contract

**Required output artifacts:**

| Artifact | Required | Purpose |
|---|---|---|
| `failure_analysis.md` | Yes | Root cause of each failing test |
| `patch.diff` | Yes | Code change that repairs the failures |
| `test_results_before.json` | Yes | Test output before repair |
| `test_results_after.json` | Yes | Test output after repair |
| `repair_log.md` | Yes | Repair loop steps: iterations, intermediate states, dead ends |
| `run_manifest.json` | Yes | Graph, agents, models, tools, costs, timestamps |

**Acceptance criteria:**
- All tests that were failing before the patch must pass after the patch.
- No previously passing tests may be broken by the patch.
- The repair loop must not exceed `max_repair_attempts` (default: 3) without surfacing a `human_review_required` approval gate.
- The failure analysis must identify whether the failure is a test bug, an implementation bug, or an environment issue, and must note if a test fix was chosen over a code fix.
- The patch must be minimal; changes to files not involved in the failing tests require explicit justification in `repair_log.md`.

**Demo command:**
```
alix sop run coding.test_repair --suite <test-suite> --repo <path>
```

### 33.4 infra.docker_compose_audit Acceptance Contract

`infra.docker_compose_audit` is the secondary public showcase SOP and must be fully specified before M1.3 ships.

**Required output artifacts:**

| Artifact | Required | Purpose |
|---|---|---|
| `compose_inventory.json` | Yes | Services, images, ports, networks, volumes, secrets, health checks |
| `risk_report.md` | Yes | Severity-ranked findings with explanations |
| `suggested_patch.diff` | Yes | Optional patch suggestions; never auto-applied by default |
| `healthcheck_recommendations.md` | Yes | Missing or weak health check guidance |
| `network_volume_analysis.md` | Yes | Network exposure, bind mounts, named volumes, persistence risks |
| `secret_exposure_report.md` | Yes | Redacted secret and environment variable review |
| `rollback_plan.md` | Yes | Steps to revert suggested changes |
| `run_manifest.json` | Yes | Graph, agents, models, tools, costs, timestamps |

**Acceptance criteria:**

- No deployment occurs.
- No containers are stopped or restarted.
- Secrets are redacted in every artifact.
- Every high-risk finding has a remediation suggestion.
- Suggested patch must be optional and not auto-applied.
- The SOP must distinguish between confirmed risks, warnings, and recommendations.
- `infra.config_auditor` must complete before any suggested patch is produced.
- Any operation requiring `docker.exec`, `docker.deploy`, or `production.deploy` must be blocked by policy in audit mode.

**Demo command:**

```bash
alix sop run infra.docker_compose_audit --compose ./docker-compose.yml
```

---
