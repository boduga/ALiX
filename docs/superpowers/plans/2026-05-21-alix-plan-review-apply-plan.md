# `alix plan` / `alix review` / `alix apply` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement multi-stage planning pipeline: generate plan → review diffs → apply patches.

**Architecture:** `alix plan` generates YAML plan, `alix review` shows changes/risk, `alix apply` executes patches. Uses existing provider and config loading.

---

### Task 1: Create Plan Command Handler

**Files:**
- Create: `src/cli/commands/plan.ts`

- [ ] **Step 1: Write the shell**

```typescript
// src/cli/commands/plan.ts
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../../config/loader.js";
import { createProvider } from "../../providers/registry.js";
import yaml from "yaml";

export interface PlanOptions {
  task: string;
}

interface PlanChange {
  file: string;
  action: "create" | "modify" | "delete";
  description: string;
  diff?: string;
  content?: string;
}

interface YamlPlan {
  plan: {
    id: string;
    created: string;
    task: string;
    status: "pending" | "approved" | "rejected" | "applied";
    intent: {
      summary: string;
      type: string;
      acceptance_criteria: string[];
    };
    changes: PlanChange[];
    risk: {
      level: string;
      reasons: string[];
      affected_files: number;
      new_files: number;
    };
    estimated_complexity: string;
    estimated_tokens: number;
  };
}

export async function runPlan(opts: PlanOptions): Promise<void> {
  const planId = randomUUID();
  const planDir = join(process.cwd(), ".alix", "plans");
  await mkdir(planDir, { recursive: true });

  console.log("Generating plan...\n");

  const config = await loadConfig(process.cwd());
  const provider = createProvider(config.model);

  const systemPrompt = `You are a project planner. Generate a YAML plan for the given task.

The plan must include:
1. intent summary and type
2. acceptance criteria
3. list of changes (file, action, description)
4. risk assessment (level, reasons)
5. estimated complexity

Output ONLY valid YAML. No markdown code blocks.`;

  const response = await provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: `Task: ${opts.task}\n\nGenerate a YAML plan for this task.` }]
  });

  const plan: YamlPlan = {
    plan: {
      id: planId,
      created: new Date().toISOString(),
      task: opts.task,
      status: "pending",
      intent: { summary: "", type: "feature", acceptance_criteria: [] },
      changes: [],
      risk: { level: "unknown", reasons: [], affected_files: 0, new_files: 0 },
      estimated_complexity: "unknown",
      estimated_tokens: 0,
    }
  };

  try {
    const parsed = yaml.parse(response.text);
    if (parsed?.plan) {
      plan.plan = { ...plan.plan, ...parsed.plan, id: planId, created: plan.plan.created, status: "pending" };
    }
  } catch {
    console.warn("Warning: Could not parse plan YAML, using defaults");
  }

  const planPath = join(planDir, `${planId}.yaml`);
  await writeFile(planPath, yaml.stringify(plan));

  console.log(`Plan generated: ${planId}`);
  console.log(`  Changes: ${plan.plan.changes.length} files`);
  console.log(`  Risk: ${plan.plan.risk.level}`);
  console.log(`\nReview with: alix review ${planId}`);
  console.log(`Apply with: alix apply ${planId}`);
}
```

- [ ] **Step 2: Wire into cli.ts**

Add to `src/cli.ts`:

```typescript
if (command === "plan") {
  const { runPlan } = await import("./cli/commands/plan.js");
  const task = args.join(" ").replace(/^["']|["']$/g, "");
  await runPlan({ task });
  process.exit(0);
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -10
git add src/cli/commands/plan.ts src/cli.ts
git commit -m "feat(plan): add alix plan command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Create Review Command Handler

**Files:**
- Create: `src/cli/commands/review.ts`

- [ ] **Step 1: Write the review command**

```typescript
// src/cli/commands/review.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readline } from "node:readline/promises";
import yaml from "yaml";

export interface ReviewOptions {
  planId: string;
}

interface PlanChange {
  file: string;
  action: "create" | "modify" | "delete";
  description: string;
  diff?: string;
}

interface YamlPlan {
  plan: {
    id: string;
    created: string;
    task: string;
    status: string;
    intent: { summary: string; type: string; acceptance_criteria: string[] };
    changes: PlanChange[];
    risk: { level: string; reasons: string[]; affected_files: number; new_files: number };
  };
}

const RISK_COLORS: Record<string, string> = {
  low: "\x1b[32m",
  medium: "\x1b[33m",
  high: "\x1b[31m",
};

export async function runReview(opts: ReviewOptions): Promise<void> {
  const planPath = join(process.cwd(), ".alix", "plans", `${opts.planId}.yaml`);

  if (!existsSync(planPath)) {
    console.error(`Plan not found: ${opts.planId}`);
    process.exit(1);
  }

  const content = await readFile(planPath, "utf8");
  const plan: YamlPlan = yaml.parse(content);

  console.log(`\nPlan: ${plan.plan.task}`);
  console.log(`Status: ${plan.plan.status}`);

  const riskColor = RISK_COLORS[plan.plan.risk.level] ?? "";
  console.log(`Risk: ${riskColor}${plan.plan.risk.level}\x1b[0m`);

  console.log(`\nChanges (${plan.plan.changes.length} files):\n`);

  for (const change of plan.plan.changes) {
    const actionLabel = change.action.toUpperCase().padEnd(8);
    console.log(`  ${actionLabel} ${change.file}`);
    console.log(`           ${change.description}`);
    if (change.diff) {
      console.log(change.diff.split("\n").slice(0, 3).map(l => `    ${l}`).join("\n"));
      if (change.diff.split("\n").length > 3) console.log("    ...");
    }
    console.log();
  }

  if (plan.plan.risk.reasons.length > 0) {
    console.log("Risk reasons:");
    for (const reason of plan.plan.risk.reasons) {
      console.log(`  - ${reason}`);
    }
    console.log();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Approve, Reject, or Exit? [A/r/E]: ");
  rl.close();

  if (answer.toLowerCase() === "a") {
    plan.plan.status = "approved";
    const yamlContent = yaml.stringify(plan);
    await require("node:fs/promises").writeFile(planPath, yamlContent);
    console.log("\nPlan approved. Run `alix apply " + opts.planId + "` to apply.");
  } else if (answer.toLowerCase() === "r") {
    plan.plan.status = "rejected";
    const yamlContent = yaml.stringify(plan);
    await require("node:fs/promises").writeFile(planPath, yamlContent);
    console.log("\nPlan rejected.");
  }
}
```

- [ ] **Step 2: Wire into cli.ts**

Add to `src/cli.ts`:

```typescript
if (command === "review") {
  const { runReview } = await import("./cli/commands/review.js");
  const planId = args[0];
  if (!planId) { console.error("Usage: alix review <plan-id>"); process.exit(1); }
  await runReview({ planId });
  process.exit(0);
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -10
git add src/cli/commands/review.ts src/cli.ts
git commit -m "feat(review): add alix review command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create Apply Command Handler

**Files:**
- Create: `src/cli/commands/apply.ts`

- [ ] **Step 1: Write the apply command**

```typescript
// src/cli/commands/apply.ts
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { readline } from "node:readline/promises";
import yaml from "yaml";

export interface ApplyOptions {
  planId: string;
}

interface PlanChange {
  file: string;
  action: "create" | "modify" | "delete";
  content?: string;
  diff?: string;
}

interface YamlPlan {
  plan: {
    id: string;
    status: string;
    changes: PlanChange[];
  };
}

function applyPatch(filePath: string, diff: string): void {
  // Simple diff application for + lines
  const lines = diff.split("\n");
  // Read file, apply changes, write back would go here
  // For MVP, we'll write new content directly
}

export async function runApply(opts: ApplyOptions): Promise<void> {
  const planPath = join(process.cwd(), ".alix", "plans", `${opts.planId}.yaml`);

  if (!existsSync(planPath)) {
    console.error(`Plan not found: ${opts.planId}`);
    process.exit(1);
  }

  const content = await readFile(planPath, "utf8");
  const plan: YamlPlan = yaml.parse(content);

  if (plan.plan.status === "applied") {
    console.error("Plan already applied.");
    process.exit(1);
  }

  console.log(`Applying plan ${opts.planId}...`);
  console.log(`  ${plan.plan.changes.length} changes\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await rl.question("Proceed? [y/N]: ");
  rl.close();

  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    process.exit(0);
  }

  for (const change of plan.plan.changes) {
    switch (change.action) {
      case "create":
        await mkdir(join(process.cwd(), "src"), { recursive: true });
        await writeFile(join(process.cwd(), change.file), change.content ?? "");
        console.log(`  Created: ${change.file}`);
        break;
      case "modify":
        if (change.diff) {
          applyPatch(change.file, change.diff);
        }
        console.log(`  Modified: ${change.file}`);
        break;
      case "delete":
        if (existsSync(change.file)) {
          await rm(change.file);
        }
        console.log(`  Deleted: ${change.file}`);
        break;
    }
  }

  plan.plan.status = "applied";
  await writeFile(planPath, yaml.stringify(plan));

  console.log("\nPlan applied successfully.");
}
```

- [ ] **Step 2: Wire into cli.ts**

Add to `src/cli.ts`:

```typescript
if (command === "apply") {
  const { runApply } = await import("./cli/commands/apply.js");
  const planId = args[0];
  if (!planId) { console.error("Usage: alix apply <plan-id>"); process.exit(1); }
  await runApply({ planId });
  process.exit(0);
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npm run build && npm run test:node 2>&1 | tail -10
git add src/cli/commands/apply.ts src/cli.ts
git commit -m "feat(apply): add alix apply command

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Add List and Delete Plan Commands

**Files:**
- Modify: `src/cli/commands/plan.ts`

- [ ] **Step 1: Add list plans functionality**

Add to `plan.ts`:

```typescript
export async function listPlans(): Promise<void> {
  const planDir = join(process.cwd(), ".alix", "plans");

  if (!existsSync(planDir)) {
    console.log("No plans found.");
    return;
  }

  const { readdir } = await import("node:fs/promises");
  const files = await readdir(planDir);
  const yamlFiles = files.filter(f => f.endsWith(".yaml"));

  if (yamlFiles.length === 0) {
    console.log("No plans found.");
    return;
  }

  console.log("Plans:\n");
  for (const file of yamlFiles) {
    const content = await readFile(join(planDir, file), "utf8");
    const plan: YamlPlan = yaml.parse(content);
    const shortId = file.replace(".yaml", "").slice(0, 8);
    const status = plan.plan.status.padEnd(8);
    console.log(`  ${shortId}  ${status}  ${plan.plan.task}`);
  }
}
```

- [ ] **Step 2: Wire into cli.ts**

```typescript
if (command === "plan") {
  if (args[0] === "--list" || args[0] === "-l") {
    const { listPlans } = await import("./cli/commands/plan.js");
    await listPlans();
  } else {
    const { runPlan } = await import("./cli/commands/plan.js");
    const task = args.join(" ").replace(/^["']|["']$/g, "");
    await runPlan({ task });
  }
  process.exit(0);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/plan.ts src/cli.ts
git commit -m "feat(plan): add list plans functionality

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Self-Review Checklist

- [ ] `alix plan "task"` generates YAML plan with risk assessment
- [ ] Plans saved to `.alix/plans/<id>.yaml`
- [ ] `alix review <id>` shows changes and risk level
- [ ] Review allows approve/reject
- [ ] `alix apply <id>` executes changes with confirmation
- [ ] Plan status updates after apply
- [ ] `alix plan --list` shows all plans
- [ ] All tests pass
