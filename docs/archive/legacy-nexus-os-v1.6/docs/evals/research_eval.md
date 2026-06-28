# Research Evaluation

Research evaluation is defined by the `research.deep_report` acceptance contract and the source-grounding eval cases.

## 33. SOP Acceptance Contracts

All P0 SOP Packs must have a full acceptance contract before being considered shippable. This section defines those contracts. P1+ SOPs require acceptance contracts before their milestone ships.

### 33.1 research.deep_report Acceptance Contract

`research.deep_report` is the primary public showcase SOP.

**Required output artifacts:**

| Artifact | Required | Purpose |
|---|---|---|
| `final_report.md` | Yes | Human-readable report |
| `sources.json` | Yes | Source inventory with URLs, titles, dates, credibility notes |
| `claims.json` | Yes | Major claim-to-source mapping |
| `contradictions.md` | Yes | Conflicting claims or unresolved uncertainties |
| `critic_review.md` | Yes | Critic agent assessment |
| `run_manifest.json` | Yes | Graph, agents, models, tools, costs, timestamps |

**Acceptance criteria:**
- The report must use at least five distinct sources for broad research tasks unless fewer credible sources exist.
- Every major factual claim must map to at least one source in `claims.json`.
- Conflicting evidence must be listed in `contradictions.md`.
- The report must separate facts, interpretations, and recommendations.
- The critic agent must check for unsupported claims, stale sources, source concentration, and missing uncertainty statements.
- The final report cannot be marked complete until the critic pass completes.
- All web/tool/model calls must appear in the event trace.

**Demo command:**
```
alix sop run research.deep_report --topic "best vector backend for a TypeScript local-first agent OS"
```

### 33.2 coding.issue_to_pr Acceptance Contract

**Required output artifacts:**

| Artifact | Required | Purpose |
|---|---|---|
| `issue_analysis.md` | Yes | Root cause analysis and scope assessment |
| `implementation_plan.md` | Yes | Proposed changes with file-level impact |
| `patch.diff` | Yes | The actual code change |
| `test_results.json` | Yes | Test run output before and after the patch |
| `pr_description.md` | Yes | Pull request body: summary, changes, test evidence |
| `run_manifest.json` | Yes | Graph, agents, models, tools, costs, timestamps |

**Acceptance criteria:**
- The patch must be syntactically valid and apply cleanly to the declared base branch.
- Test results must show no new test failures introduced by the patch.
- If the issue describes a regression, at least one test must directly cover the regressed behavior.
- The PR description must reference the issue ID and summarize the approach.
- The implementation plan must be reviewed by `coding.architect` before `coding.implementer` runs.
- The patch must pass `coding.tester` validation before the artifact is marked complete.
- No file outside the declared scope may be modified without a `graph.mutated` event showing scope expansion and approval.

**Demo command:**
```
alix sop run coding.issue_to_pr --issue-id <id> --repo <path>
```

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
