# `alix plan` / `alix review` / `alix apply` Design

**Status:** ✅ Completed (M0.7) — Design implemented and committed to main.

**Goal:** Multi-stage planning pipeline: generate plan → review diffs → apply patches. Enables iterative human-in-the-loop development.

**Architecture:** `alix plan` generates a machine-readable YAML plan. `alix review` shows affected files and risk. `alix apply` executes the planned patches.

---

## Command Flow

```
alix plan "<task>"     → Generate plan, save to .alix/plans/<id>.yaml
alix review <plan-id>   → Show diffs, affected files, risk assessment
alix apply <plan-id>    → Execute planned patches with approval
```

---

## Plan Format

**File:** `.alix/plans/<plan-id>.yaml`

```yaml
plan:
  id: "uuid"
  created: "2026-05-21T10:00:00Z"
  task: "add user authentication"
  status: "pending|approved|applied|rejected"

  intent:
    summary: "Add JWT-based authentication"
    type: "feature"
    acceptance_criteria:
      - "Users can register with email/password"
      - "Users can login and receive JWT token"
      - "Protected routes require valid JWT"

  changes:
    - file: "src/auth/login.ts"
      action: "create"
      description: "Login handler with JWT issuance"

    - file: "src/auth/middleware.ts"
      action: "create"
      description: "JWT verification middleware"

    - file: "src/app.ts"
      action: "modify"
      description: "Add auth routes and middleware"
      diff: |
        + import { authMiddleware } from "./auth/middleware";
        + app.use(authMiddleware);

    - file: "tests/auth.test.ts"
      action: "create"
      description: "Auth integration tests"

  risk:
    level: "medium"
    reasons:
      - "Modifies app entry point"
      - "Adds new auth infrastructure"
    affected_files: 4
    new_files: 3

  estimated_complexity: "moderate"
  estimated_tokens: 8000
```

---

## `alix plan` Implementation

**Purpose:** Generate a structured plan without executing.

```typescript
async function runPlan(task: string) {
  const planId = randomUUID();
  const planDir = join(".alix", "plans");
  await mkdir(planDir, { recursive: true });

  // Load context
  const config = await loadConfig(cwd);
  const provider = createProvider(config.model);

  // Generate plan using LLM
  const systemPrompt = buildPlanSystemPrompt();
  const response = await provider.complete({
    systemPrompt,
    messages: [
      { role: "user", content: `Task: ${task}\n\nGenerate a YAML plan for this task.` }
    ]
  });

  // Parse YAML plan
  const plan = parseYamlPlan(response.text);

  // Save plan
  const planPath = join(planDir, `${planId}.yaml`);
  await writeFile(planPath, yaml.stringify(plan));

  console.log(`Plan generated: ${planId}`);
  console.log(`  Changes: ${plan.changes.length} files`);
  console.log(`  Risk: ${plan.risk.level}`);
  console.log(`\nReview with: alix review ${planId}`);
  console.log(`Apply with: alix apply ${planId}`);
}
```

**System prompt for plan generation:**
```
You are a project planner. Generate a YAML plan for the given task.

The plan must include:
1. intent summary and type
2. acceptance criteria
3. list of changes (file, action, description)
4. risk assessment (level, reasons)
5. estimated complexity

Output ONLY valid YAML. No markdown code blocks.
```

---

## `alix review` Implementation

**Purpose:** Show what will change and allow human review before applying.

```bash
$ alix review <plan-id>

Plan: add user authentication
Status: pending
Risk: medium

Changes (4 files):

  CREATE src/auth/login.ts
    Login handler with JWT issuance

  CREATE src/auth/middleware.ts
    JWT verification middleware

  MODIFY src/app.ts
    + import { authMiddleware } from "./auth/middleware";
    + app.use(authMiddleware);

  CREATE tests/auth.test.ts
    Auth integration tests

Review diffs? [y/N]:
```

**Features:**
- List all changes with actions (create/modify/delete)
- Show inline diffs for modifications
- Display risk assessment
- Prompt for next action: review more, approve, reject

---

## `alix apply` Implementation

**Purpose:** Execute the planned patches with approval.

```typescript
async function runApply(planId: string) {
  const planPath = join(".alix", "plans", `${planId}.yaml`);

  // Load plan
  const planContent = await readFile(planPath, "utf8");
  const plan = parseYaml(planContent);

  if (plan.status === "applied") {
    console.error("Plan already applied.");
    process.exit(1);
  }

  // Show summary and prompt for confirmation
  console.log(`Applying plan ${planId}...`);
  console.log(`  ${plan.changes.length} changes`);

  const confirm = await prompt("Proceed? [y/N]: ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    process.exit(0);
  }

  // Execute each change
  for (const change of plan.changes) {
    switch (change.action) {
      case "create":
        await writeFile(change.file, change.content ?? "");
        console.log(`  Created: ${change.file}`);
        break;
      case "modify":
        // Apply patch
        await applyPatch(change.file, change.diff);
        console.log(`  Modified: ${change.file}`);
        break;
      case "delete":
        await rm(change.file);
        console.log(`  Deleted: ${change.file}`);
        break;
    }
  }

  // Update plan status
  plan.status = "applied";
  await writeFile(planPath, yaml.stringify(plan));

  console.log("\nPlan applied successfully.");
}
```

---

## Approval States

| State | Description |
|-------|-------------|
| `pending` | Plan generated, awaiting review |
| `approved` | User approved, ready to apply |
| `rejected` | User rejected the plan |
| `applied` | Patches executed |

---

## Integration with `alix run`

- `alix plan` uses same context loading as `alix run`
- Plan system can use orchestrator's auto-refine (Fabric patterns)
- Plan can be generated by a subagent and reviewed by another

---

## File Structure

```
.alix/
  plans/
    <uuid>.yaml    # Plan files
  sessions/
    <uuid>/
      messages.jsonl
```

---

## Error Handling

- Invalid plan file → show error, exit 1
- Plan already applied → show error, exit 1
- File conflicts → prompt user, may need to update plan
- Partial apply → save state, allow resume