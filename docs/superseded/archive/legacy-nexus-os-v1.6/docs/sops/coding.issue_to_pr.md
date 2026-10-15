# SOP: coding.issue_to_pr

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
