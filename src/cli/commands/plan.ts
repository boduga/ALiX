import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../../config/loader.js";
import { createProvider } from "../../providers/registry.js";
import yaml from "yaml";

export interface PlanOptions {
  task: string;
  list?: boolean;
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
  if (opts.list) {
    await listPlans();
    return;
  }

  const planId = randomUUID();
  const planDir = join(process.cwd(), ".alix", "plans");
  await mkdir(planDir, { recursive: true });

  console.log("Generating plan...\n");

  const config = await loadConfig(process.cwd());
  const provider = await createProvider(config.model);

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
      intent: { summary: opts.task, type: "feature", acceptance_criteria: [] },
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
    } else if (parsed?.changes) {
      plan.plan.changes = parsed.changes;
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

export async function listPlans(): Promise<void> {
  const planDir = join(process.cwd(), ".alix", "plans");

  if (!existsSync(planDir)) {
    console.log("No plans found.");
    return;
  }

  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(planDir)).filter(f => f.endsWith(".yaml"));

  if (files.length === 0) {
    console.log("No plans found.");
    return;
  }

  console.log("Plans:\n");
  for (const file of files) {
    const content = await readFile(join(planDir, file), "utf8");
    try {
      const plan: YamlPlan = yaml.parse(content);
      const shortId = file.replace(".yaml", "").slice(0, 8);
      const status = (plan.plan.status || "pending").padEnd(8);
      console.log(`  ${shortId}  ${status}  ${plan.plan.task}`);
    } catch { /* skip invalid */ }
  }
}
